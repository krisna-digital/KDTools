// Membuat assets/js/default-configs.js dari file JSON di assets/templates/*/.
// Jalankan ulang setelah mengganti *-config.json:  node tools/build-defaults.js
// (File JSON tetap menjadi sumber; file .js dibuat agar aplikasi juga jalan saat dibuka dari file://.)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'assets', 'templates');
const out = {};
for (const id of fs.readdirSync(root)) {
  const dir = path.join(root, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  out[id] = {};
  for (const side of ['front', 'back']) {
    const f = path.join(dir, side + '-config.json');
    if (fs.existsSync(f)) out[id][side] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
}
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'js', 'default-configs.js'),
  '/* DIHASILKAN oleh tools/build-defaults.js — jangan diedit manual. */\nwindow.IDS_DEFAULTS = ' + JSON.stringify(out, null, 2) + ';\n');
console.log('default-configs.js dibuat untuk:', Object.keys(out).join(', '));
