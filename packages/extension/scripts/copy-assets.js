const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../src');
const distDir = path.resolve(__dirname, '../dist');

// Copy manifest.json
fs.copyFileSync(
  path.join(srcDir, 'manifest.json'),
  path.join(distDir, 'manifest.json')
);

// Copy popup HTML and CSS
const popupSrc = path.join(srcDir, 'popup');
const popupDist = path.join(distDir, 'popup');

if (!fs.existsSync(popupDist)) {
  fs.mkdirSync(popupDist, { recursive: true });
}

for (const file of ['popup.html', 'popup.css']) {
  const src = path.join(popupSrc, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(popupDist, file));
  }
}

// Copy injected script (needs to be loaded as a plain JS file in page context)
const interceptorsDir = path.join(distDir, 'interceptors');
if (!fs.existsSync(interceptorsDir)) {
  fs.mkdirSync(interceptorsDir, { recursive: true });
}

console.log('Assets copied to dist/');
