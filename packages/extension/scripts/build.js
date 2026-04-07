const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../src');
const distDir = path.resolve(__dirname, '../dist');

// Build-time config — replaced in all entry points via esbuild `define`.
// SERVER_URL uses a placeholder so the download handler can swap it at runtime
// with the server's EXT_SERVER_URL env var (same pattern as API key).
const SERVER_URL_PLACEHOLDER = '__CTS_SERVER_URL_PLACEHOLDER__';
const serverUrl = process.env.EXT_SERVER_URL || SERVER_URL_PLACEHOLDER;

// API key uses a placeholder — replaced at download time with the user's personal key.
// The server reads dist/ as a template and swaps the placeholder before zipping.
const API_KEY_PLACEHOLDER = '__CTS_API_KEY_PLACEHOLDER__';
const apiKey = process.env.EXT_API_KEY || API_KEY_PLACEHOLDER;

// AdsPower local API key — replaced at download time from ADSPOWER_API_KEY env var
const ADSPOWER_KEY_PLACEHOLDER = '__CTS_ADSPOWER_KEY_PLACEHOLDER__';
const adspowerKey = process.env.ADSPOWER_API_KEY || ADSPOWER_KEY_PLACEHOLDER;

const ADSPOWER_URL_PLACEHOLDER = '__CTS_ADSPOWER_URL_PLACEHOLDER__';
const adspowerUrl = process.env.ADSPOWER_API_URL || ADSPOWER_URL_PLACEHOLDER;

const buildDefine = {
  '__SERVER_URL__': JSON.stringify(serverUrl),
  '__API_KEY__': JSON.stringify(apiKey),
  '__ADSPOWER_API_KEY__': JSON.stringify(adspowerKey),
  '__ADSPOWER_API_URL__': JSON.stringify(adspowerUrl),
};

async function build() {
  // Clean dist completely
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }

  // Create all output directories upfront
  for (const sub of ['background', 'content', 'interceptors', 'popup']) {
    fs.mkdirSync(path.join(distDir, sub), { recursive: true });
  }

  // Build each entry point individually so failures are explicit
  const entries = [
    { src: 'background/service-worker.ts', out: 'background/service-worker.js' },
    { src: 'content/content-script.ts', out: 'content/content-script.js' },
    { src: 'interceptors/page-injector.ts', out: 'interceptors/page-injector.js' },
    { src: 'popup/popup.ts', out: 'popup/popup.js' },
  ];

  for (const entry of entries) {
    const inPath = path.join(srcDir, entry.src);
    const outPath = path.join(distDir, entry.out);

    await esbuild.build({
      entryPoints: [inPath],
      outfile: outPath,
      bundle: true,
      format: 'iife',
      target: 'chrome120',
      logLevel: 'info',
      define: buildDefine,
    });

    // Verify file was actually written
    if (!fs.existsSync(outPath)) {
      console.error('ERROR: esbuild did not produce ' + entry.out);
      process.exit(1);
    }

    // Verify no module syntax
    const content = fs.readFileSync(outPath, 'utf8');
    if (/\bexport\s|import\s.*from\s/.test(content)) {
      console.error('ERROR: ' + entry.out + ' contains module syntax');
      process.exit(1);
    }

    console.log('  OK: ' + entry.out + ' (' + content.length + ' bytes)');
  }

  // Copy static assets
  fs.copyFileSync(
    path.join(srcDir, 'manifest.json'),
    path.join(distDir, 'manifest.json'),
  );
  fs.copyFileSync(
    path.join(srcDir, 'popup', 'popup.html'),
    path.join(distDir, 'popup', 'popup.html'),
  );
  fs.copyFileSync(
    path.join(srcDir, 'popup', 'popup.css'),
    path.join(distDir, 'popup', 'popup.css'),
  );

  // Final check: every JS file in manifest must exist
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
  const refs = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((cs) => cs.js),
  ];
  for (const ref of refs) {
    if (!fs.existsSync(path.join(distDir, ref))) {
      console.error('ERROR: manifest references "' + ref + '" but file missing');
      process.exit(1);
    }
  }

  console.log('\nBuild OK — all entry points bundled as IIFE.');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
