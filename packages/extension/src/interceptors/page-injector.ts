// This script runs in the MAIN world (page context) via manifest content_scripts.
// It uses Proxy to intercept fetch and XMLHttpRequest responses without breaking
// toString() detection — window.fetch.toString() still returns "[native code]".
//
// Wrapped in IIFE to prevent any global variable/function leaks.
// Uses WeakMap for XHR metadata to avoid adding detectable properties on instances.
//
// NO `export` statements — this runs as a plain script in page context, not a module.

(() => {
  const PAGE_MESSAGE_SOURCE = 'cts-antifraud-injected';

  // Noise URL patterns — high-frequency endpoints that waste storage.
  const NOISE_PATTERNS: string[] = [
    '/_/logging',
    '/aw/heartbeat',
    '/aw/ipl_status',
    'model.json',
    'group1-shard',
  ];

  // Domains we intercept, with optional domain-specific path filters.
  // null = intercept everything (minus noise) — used for ads.google.com
  const INTERCEPTED_HOSTS: Record<string, ((pathname: string) => boolean) | null> = {
    'ads.google.com': null,
    'pay.google.com': (p) =>
      p.includes('/gp/') ||
      p.includes('/payments/') ||
      p.includes('/_/Pay') ||
      p.includes('/rpc/'),
    'payments.google.com': (p) =>
      p.includes('/payments/') ||
      p.includes('/manage/') ||
      p.includes('/_/Payments') ||
      p.includes('/rpc/'),
    'myaccount.google.com': (p) =>
      p.includes('/security') ||
      p.includes('/signinoptions') ||
      p.includes('/device-activity') ||
      p.includes('/_/MyAccount') ||
      p.includes('/rpc/'),
    'accounts.google.com': (p) =>
      p.includes('/ListSessions') ||
      p.includes('/GetCheckupInfo') ||
      p.includes('/signin/') ||
      p.includes('/security') ||
      p.includes('/_/AccountsSignIn') ||
      p.includes('/rpc/'),
  };

  function shouldIntercept(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.origin);
      const hostFilter = INTERCEPTED_HOSTS[parsed.hostname];

      // Unknown host — not in our intercept list
      if (hostFilter === undefined) return false;

      // Skip known noise endpoints
      for (const pattern of NOISE_PATTERNS) {
        if (url.includes(pattern)) return false;
      }

      // null filter = intercept all (ads.google.com)
      if (hostFilter === null) return true;

      // Domain-specific path filter
      return hostFilter(parsed.pathname + parsed.search);
    } catch {
      return false;
    }
  }

  // NOTE: Antidetect browser detection was moved to service-worker.ts.
  // document.title in MAIN world returns the page's own title ("Google Ads - ..."),
  // NOT the browser-level title the user sees in the tab bar ("ATVanya333 - Octium").
  // Detection now uses chrome.tabs.get(tabId).title in the service worker.

  /**
   * Extract Google Ads Customer ID from the current page URL.
   *
   * Google Ads URL params when accessed via MCC (manager account):
   *   ?ocid=812465993&__u=327338679&...
   *   ocid = MCC manager account ID (same for all managed accounts)
   *   __u  = advertising account ID (the one we need)
   *   __c  = alternative customer ID param
   *
   * Priority: __u (ad account) → __c → ocid (fallback to manager if no __u).
   * This ensures we track the actual advertising account, not the MCC.
   *
   * Sources:
   *  1. URL query params
   *  2. URL hash params (SPA routing)
   *  3. Cached CID from previous extraction on this page
   */
  let cachedCid: string | null = null;
  const VALID_CID_RE = /^\d{7,10}$/;

  function extractCidFromParams(params: URLSearchParams): string | null {
    // __u = advertising account (priority), __c = customer ID, ocid = manager fallback
    const cid = params.get('__u') ?? params.get('__c') ?? params.get('ocid') ?? null;
    return cid && VALID_CID_RE.test(cid) ? cid : null;
  }

  function extractGoogleCid(): string | null {
    try {
      // 1. Query params (most reliable)
      const fromParams = extractCidFromParams(new URLSearchParams(window.location.search));
      if (fromParams) {
        cachedCid = fromParams;
        return fromParams;
      }

      // 2. Hash params (SPA routing — Google Ads uses hash-based navigation)
      const hash = window.location.hash;
      if (hash) {
        const hashSearch = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
        if (hashSearch) {
          const fromHash = extractCidFromParams(new URLSearchParams(hashSearch));
          if (fromHash) {
            cachedCid = fromHash;
            return fromHash;
          }
        }
      }

      // 3. Cached CID from previous extraction (inherits reliability from 1-2)
      return cachedCid;
    } catch {
      return cachedCid;
    }
  }

  function sendToContentScript(url: string, method: string, status: number, body: string, requestBody?: string | null): void {
    const googleCid = extractGoogleCid();
    window.postMessage(
      {
        source: PAGE_MESSAGE_SOURCE,
        payload: {
          url,
          method,
          status,
          body,
          timestamp: new Date().toISOString(),
          ...(googleCid ? { googleCid } : {}),
          ...(requestBody ? { requestBody } : {}),
        },
      },
      '*',
    );
  }

  // ─── Proxy fetch ────────────────────────────────────────────────────────────
  //
  // Proxy preserves the native toString() — window.fetch.toString() returns
  // "function fetch() { [native code] }" instead of exposing patched source.
  // The get trap caches a bound toString so identity checks (===) are stable.

  const origFetch = window.fetch;
  const fetchToString = Function.prototype.toString.bind(origFetch);

  window.fetch = new Proxy(origFetch, {
    apply(target, thisArg, argsList: unknown[]) {
      const result = Reflect.apply(target, thisArg, argsList) as Promise<Response>;

      const input = argsList[0];
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
      const init = argsList[1] as RequestInit | undefined;
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

      if (shouldIntercept(url)) {
        // Capture POST body for payment-related URLs (batchexecute RPCs + fix_instrument form)
        let reqBody: string | null = null;
        try {
          if (method === 'POST' && (url.includes('batchexecute') || url.includes('fix_instrument'))) {
            if (typeof init?.body === 'string') {
              reqBody = init.body;
            } else if (init?.body instanceof URLSearchParams) {
              reqBody = init.body.toString();
            } else if (input instanceof Request) {
              // fetch(new Request(url, { body })) — body is on Request as ReadableStream
              // Clone and read async; send as separate message to avoid race with response
              (input as Request).clone().text().then(t => {
                if (t) sendToContentScript(url, method, 0, '', t);
              }).catch(() => {});
            }
          }
        } catch { /* silent */ }

        result
          .then((response) => {
            try {
              const cloned = response.clone();
              cloned
                .text()
                .then((body) => {
                  sendToContentScript(url, method, response.status, body, reqBody);
                })
                .catch(() => {});
            } catch {
              // Silently fail — don't break the page
            }
          })
          .catch(() => {});
      }

      return result;
    },
    get(target, prop, receiver) {
      if (prop === 'toString') return fetchToString;
      return Reflect.get(target, prop, receiver);
    },
  });

  // ─── Proxy XMLHttpRequest ───────────────────────────────────────────────────
  //
  // WeakMap stores method/url per XHR instance — no expando properties like
  // _ctsMethod/_ctsUrl that could be detected by Object.keys(xhr) or similar.

  const xhrMeta = new WeakMap<XMLHttpRequest, { method: string; url: string; requestBody?: string | null }>();

  const origOpen = XMLHttpRequest.prototype.open;
  const openToString = Function.prototype.toString.bind(origOpen);

  XMLHttpRequest.prototype.open = new Proxy(origOpen, {
    apply(target, thisArg: XMLHttpRequest, argsList: unknown[]) {
      const method = argsList[0] as string;
      const rawUrl = argsList[1];
      const resolvedUrl = typeof rawUrl === 'string' ? rawUrl : (rawUrl as URL).href;
      xhrMeta.set(thisArg, { method, url: resolvedUrl });
      return Reflect.apply(target, thisArg, argsList);
    },
    get(target, prop, receiver) {
      if (prop === 'toString') return openToString;
      return Reflect.get(target, prop, receiver);
    },
  });

  const origSend = XMLHttpRequest.prototype.send;
  const sendToString = Function.prototype.toString.bind(origSend);

  XMLHttpRequest.prototype.send = new Proxy(origSend, {
    apply(target, thisArg: XMLHttpRequest, argsList: unknown[]) {
      const meta = xhrMeta.get(thisArg);

      if (meta && shouldIntercept(meta.url)) {
        // Capture POST body for payment-related URLs
        try {
          if ((meta.url.includes('batchexecute') || meta.url.includes('fix_instrument')) && typeof argsList[0] === 'string') {
            meta.requestBody = argsList[0];
          }
        } catch { /* silent */ }

        thisArg.addEventListener('load', () => {
          try {
            sendToContentScript(meta.url, meta.method, thisArg.status, thisArg.responseText, meta.requestBody);
          } catch {
            // Silently fail
          }
        });
      }

      return Reflect.apply(target, thisArg, argsList);
    },
    get(target, prop, receiver) {
      if (prop === 'toString') return sendToString;
      return Reflect.get(target, prop, receiver);
    },
  });
})();
