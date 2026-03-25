# SKILL: Chrome Extension for Google Ads Data Interception

## Overview

This extension runs inside anti-detect browser profiles (AdsPower, Dolphin Anty, Octo, etc.) and silently intercepts data that Google Ads sends to the browser's frontend. It does NOT parse DOM — it intercepts XHR/fetch API responses.

## Why XHR/Fetch Interception (not DOM parsing)

Google frequently changes their UI (CSS classes, layout, component structure). DOM parsing breaks on every update. But Google CANNOT stop sending data to the browser — the frontend needs it to render. Internal API endpoints change rarely, and when they do, only the URL pattern or JSON structure needs updating.

## Interception Pattern

### Content Script Injection

The content script runs in the page context of `ads.google.com`. It must monkey-patch `window.fetch` and `XMLHttpRequest` BEFORE Google's code loads.

```typescript
// Inject into page context via script element (content scripts run in isolated world)
const script = document.createElement('script');
script.src = chrome.runtime.getURL('interceptor.js');
(document.head || document.documentElement).appendChild(script);
```

### Fetch Interception

```typescript
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  
  if (typeof url === 'string' && isGoogleAdsEndpoint(url)) {
    const clone = response.clone();
    try {
      const data = await clone.json();
      window.postMessage({
        type: 'CTS_INTERCEPT',
        source: 'fetch',
        url,
        data,
        timestamp: Date.now()
      }, '*');
    } catch {}
  }
  
  return response;
};
```

### XMLHttpRequest Interception

```typescript
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this._ctsUrl = url;
  return originalXHROpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function(...args) {
  this.addEventListener('load', function() {
    if (typeof this._ctsUrl === 'string' && isGoogleAdsEndpoint(this._ctsUrl)) {
      try {
        const data = JSON.parse(this.responseText);
        window.postMessage({
          type: 'CTS_INTERCEPT',
          source: 'xhr',
          url: this._ctsUrl,
          data,
          timestamp: Date.now()
        }, '*');
      } catch {}
    }
  });
  return originalXHRSend.call(this, ...args);
};
```

### URL Pattern Matching

Google Ads internal endpoints follow patterns. Start broad, narrow as we learn:

```typescript
function isGoogleAdsEndpoint(url: string): boolean {
  const patterns = [
    '/aw/',           // Main Google Ads API prefix
    '/aw-overview/',  // Dashboard overview data
    '/aw-campaigns/', // Campaign data
    '/payment/',      // Billing data
    'googleads.g.doubleclick.net', // Some reporting endpoints
  ];
  return patterns.some(p => url.includes(p));
}
```

## Message Flow

```
Page Context (interceptor.js)
  │ window.postMessage({ type: 'CTS_INTERCEPT', ... })
  ▼
Content Script (content.ts)
  │ window.addEventListener('message', handler)
  │ chrome.runtime.sendMessage({ type: 'DATA_CAPTURED', ... })
  ▼
Background Service Worker (background.ts)
  │ Buffer data in memory
  │ Flush every 30 seconds OR on specific triggers
  │ chrome.storage.local for persistence across restarts
  ▼
Backend Server
  │ POST /api/v1/collect
  ▼
PostgreSQL
```

## Data Extraction Strategy

Google Ads JSON responses are complex and undocumented. Strategy:

1. **Phase 1 (MVP):** Store ALL intercepted responses as raw JSONB. Don't try to parse everything immediately.
2. **Phase 2:** Analyze stored raw data to understand JSON structures. Build specific extractors for each data type.
3. **Phase 3:** Mature extractors that handle schema changes gracefully (fallback to raw storage on parse error).

### Known Data Structures to Extract (Phase 1 targets)

- **Account status:** Look for fields containing account state, suspension info, policy violations
- **Campaign list:** Array of campaigns with id, name, type, status, budget
- **Performance metrics:** Impressions, clicks, CTR, CPC, conversions, cost in responses
- **Billing info:** Payment methods, transactions, spend data

### Resilience Patterns

- NEVER throw errors that could break the original page behavior
- Wrap everything in try/catch — silent failure is better than breaking Google Ads
- If response parsing fails, store raw payload anyway
- Log errors to extension's own storage for debugging (NOT to console in production)

## Batching & Transport

```typescript
class DataBuffer {
  private buffer: InterceptedPayload[] = [];
  private readonly FLUSH_INTERVAL = 30_000; // 30 seconds
  private readonly MAX_BUFFER_SIZE = 50;    // Force flush at 50 items
  
  add(payload: InterceptedPayload) {
    this.buffer.push(payload);
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.flush();
    }
  }
  
  async flush() {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer = [];
    
    try {
      await sendToServer(batch);
    } catch {
      // Failed — save to chrome.storage.local for retry
      await queueForRetry(batch);
    }
  }
}
```

## Manifest V3 Specifics

- Use `service_worker` (not `background.page`)
- Service workers can be terminated — persist state in `chrome.storage.local`
- Use `chrome.alarms` for periodic tasks (not `setInterval` — doesn't survive worker termination)
- Content scripts: use `"world": "MAIN"` where supported, or inject via script element for page context access

## Anti-Detection Considerations

- Extension must NOT make any external requests that Google could detect (no analytics, no external CDNs)
- All communication goes ONLY to the user's configured server URL
- Extension ID should not be hardcoded or detectable
- No visible UI changes on Google Ads pages
- No DOM modifications
- No additional network requests visible in DevTools Network tab (beyond the POST to our server)
