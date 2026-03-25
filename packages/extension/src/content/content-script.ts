// Content script (ISOLATED world) — bridges between the page context
// (page-injector.js in MAIN world) and the background service worker.
//
// The page-injector is loaded by manifest.json with world: "MAIN",
// so no manual script injection is needed here.

const CTS_PAGE_SOURCE = 'cts-antifraud-injected';

let forwardedCount = 0;

// Listen for messages from the MAIN world interceptor
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== CTS_PAGE_SOURCE) return;

  forwardedCount++;
  const url = event.data.payload?.url ?? '(unknown)';
  console.log(`[CTS content] Received #${forwardedCount} from page-injector: ${url.substring(0, 100)}`);

  // Forward to background service worker
  chrome.runtime.sendMessage({
    type: 'intercepted_response',
    payload: event.data.payload,
  }).then((response) => {
    console.log(`[CTS content] Service worker ACK #${forwardedCount}:`, response);
  }).catch((err) => {
    console.error(`[CTS content] sendMessage FAILED #${forwardedCount}:`, err);
  });
});

// Respond to ping from background service worker (polling health check)
chrome.runtime.onMessage.addListener(
  (message: { type?: string }, _sender, sendResponse: (response: unknown) => void) => {
    if (message.type === 'cts_ping') {
      sendResponse({ type: 'cts_pong', forwardedCount });
      return true;
    }
    return false;
  },
);

console.log('[CTS content] Content script bridge loaded on', window.location.href);
