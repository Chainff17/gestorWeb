const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const pngSize = file => {
  const bytes = fs.readFileSync(path.join(root, file));
  assert.strictEqual(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file + ' debe ser PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
};
for (const [size, purpose] of [['192x192','any'], ['512x512','any'], ['512x512','maskable']]) {
  const icon = manifest.icons.find(i => i.sizes === size && i.purpose === purpose);
  assert(icon, `Falta icono ${size} ${purpose}`);
  assert.strictEqual(icon.type, 'image/png');
  assert.strictEqual(pngSize(icon.src), size);
  assert(sw.includes(`'./${icon.src}'`), `No precacheado: ${icon.src}`);
}
assert(html.includes('rel="apple-touch-icon" href="icon-apple-180.png"'));
assert.strictEqual(pngSize('icon-apple-180.png'), '180x180');
assert(sw.includes("'./icon-apple-180.png'"));
assert(html.includes('href="manifest.json?v=4"') && sw.includes("'./manifest.json?v=4'"));
console.log('✅ Íconos de instalación y caché verificados');
