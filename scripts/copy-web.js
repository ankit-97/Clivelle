const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'www');
const files = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'service-worker.js',
  'pwa.js',
  'clivelle-icon.svg',
  'clivelle-home-icon-v9.png',
  'clivelle-logo.svg',
  'hero-editorial.svg',
  'story-editorial.svg',
  'cloud-scrunchie.svg',
  'marigold-barrette.svg',
  'mauve-claw.svg',
  'pearl-headband.svg',
  'petal-clip.svg',
  'ribbon-scrunchie.svg',
  'rosewood-claw.svg',
  'sunday-headband.svg'
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) {
    throw new Error(`Required Clivelle web asset is missing: ${file}`);
  }
  fs.copyFileSync(source, path.join(output, file));
}

console.log(`Copied ${files.length} Clivelle web assets to www/.`);
