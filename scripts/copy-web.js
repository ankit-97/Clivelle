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
  'clivelle-photo-grid.jpg',
  'clivelle-hero-launch.jpg',
  'hero-editorial.jpg',
  'story-editorial.jpg',
  'cloud-scrunchie.jpg',
  'marigold-barrette.jpg',
  'mauve-claw.jpg',
  'pearl-headband.jpg',
  'petal-clip.jpg',
  'ribbon-scrunchie.jpg',
  'rosewood-claw.jpg',
  'sunday-headband.jpg'
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
