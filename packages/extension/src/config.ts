/**
 * Build-time configuration constants.
 *
 * Placeholders are replaced by esbuild `define` at build time.
 * See scripts/build.js for the replacement logic.
 *
 * At runtime these are inlined string literals — no env vars needed.
 */

declare const __SERVER_URL__: string;
declare const __API_KEY__: string;
declare const __ANTIDETECT_BROWSER__: string;

export const BUILD_CONFIG = {
  SERVER_URL: __SERVER_URL__,
  API_KEY: __API_KEY__,
  ANTIDETECT_BROWSER: __ANTIDETECT_BROWSER__,
} as const;
