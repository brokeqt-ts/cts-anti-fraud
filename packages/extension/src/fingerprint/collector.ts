// Browser fingerprint collection for anti-detect profile tracking.
// Captures the SPOOFED fingerprint (not the real one) to track profile consistency.
// Zero external dependencies — uses only Web APIs + crypto.subtle.

const FINGERPRINT_STORAGE_KEY = 'cts_fingerprint';
const FINGERPRINT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface FingerprintData {
  screen_width: number;
  screen_height: number;
  device_pixel_ratio: number;
  color_depth: number;
  user_agent: string;
  language: string;
  languages: string[];
  platform: string;
  hardware_concurrency: number;
  device_memory: number | null;
  webgl_vendor: string;
  webgl_renderer: string;
  timezone: string;
  timezone_offset: number;
  canvas_hash: string;
  detected_font_count: number;
}

/**
 * Compute a SHA-256 hash of normalized fingerprint data.
 */
export async function computeFingerprintHash(data: FingerprintData): Promise<string> {
  const normalized = JSON.stringify(data, Object.keys(data).sort());
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Collect fingerprint data from browser environment.
 * Must run in a page context or have access to window/navigator/document.
 */
export function collectFingerprintData(): FingerprintData {
  const nav = navigator;

  // WebGL renderer info
  let webglVendor = '';
  let webglRenderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    if (gl && gl instanceof WebGLRenderingContext) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string ?? '';
        webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string ?? '';
      }
    }
  } catch {
    // WebGL not available
  }

  // Canvas fingerprint hash
  let canvasHash = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 200, 50);
      ctx.fillStyle = '#069';
      ctx.fillText('CTS-fingerprint-test', 2, 15);
      ctx.fillStyle = 'rgba(102,204,0,0.7)';
      ctx.fillText('CTS-fingerprint-test', 4, 17);
      canvasHash = canvas.toDataURL().slice(-32); // Last 32 chars as quick hash
    }
  } catch {
    // Canvas not available
  }

  // Font detection via measurement
  let detectedFontCount = 0;
  try {
    const testFonts = [
      'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
      'Trebuchet MS', 'Comic Sans MS', 'Impact', 'Lucida Console',
      'Tahoma', 'Palatino Linotype', 'Segoe UI', 'Calibri',
      'Cambria', 'Consolas', 'Monaco', 'Helvetica Neue',
    ];
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const testString = 'mmmmmmmmmmlli';
    const testSize = '72px';
    const span = document.createElement('span');
    span.style.position = 'absolute';
    span.style.left = '-9999px';
    span.style.fontSize = testSize;
    span.textContent = testString;
    document.body.appendChild(span);

    const baseWidths: Record<string, number> = {};
    for (const base of baseFonts) {
      span.style.fontFamily = base;
      baseWidths[base] = span.offsetWidth;
    }

    for (const font of testFonts) {
      let detected = false;
      for (const base of baseFonts) {
        span.style.fontFamily = `'${font}', ${base}`;
        if (span.offsetWidth !== baseWidths[base]) {
          detected = true;
          break;
        }
      }
      if (detected) detectedFontCount++;
    }

    document.body.removeChild(span);
  } catch {
    // Font detection failed
  }

  return {
    screen_width: screen.width,
    screen_height: screen.height,
    device_pixel_ratio: window.devicePixelRatio,
    color_depth: screen.colorDepth,
    user_agent: nav.userAgent,
    language: nav.language,
    languages: Array.from(nav.languages ?? [nav.language]),
    platform: nav.platform,
    hardware_concurrency: nav.hardwareConcurrency ?? 0,
    device_memory: (nav as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    webgl_vendor: webglVendor,
    webgl_renderer: webglRenderer,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezone_offset: new Date().getTimezoneOffset(),
    canvas_hash: canvasHash,
    detected_font_count: detectedFontCount,
  };
}

/**
 * Store fingerprint data with TTL in chrome.storage.local.
 */
export async function storeFingerprintLocally(data: FingerprintData, hash: string): Promise<void> {
  await chrome.storage.local.set({
    [FINGERPRINT_STORAGE_KEY]: {
      data,
      hash,
      collected_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + FINGERPRINT_TTL_MS).toISOString(),
    },
  });
}

/**
 * Get cached fingerprint hash, or null if expired/missing.
 */
export async function getCachedFingerprintHash(): Promise<string | null> {
  const stored = await chrome.storage.local.get(FINGERPRINT_STORAGE_KEY);
  const entry = stored[FINGERPRINT_STORAGE_KEY] as {
    hash: string;
    expires_at: string;
  } | undefined;

  if (!entry) return null;
  if (new Date(entry.expires_at) < new Date()) {
    await chrome.storage.local.remove(FINGERPRINT_STORAGE_KEY);
    return null;
  }
  return entry.hash;
}
