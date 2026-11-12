# Uji end-to-end (opsional). Jalankan server:  python3 -m http.server 8765   lalu:  python3 tests/e2e-playwright.py
from playwright.sync_api import sync_playwright
URL = 'http://localhost:8765/index.html'
def check(name, ok):
    print(('  ok  ' if ok else 'FAIL  ') + name); 
    if not ok: raise SystemExit(1)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])  # jika Chromium Playwright belum terpasang: launch(executable_path='/path/chrome', ...)
    ctx = b.new_context(viewport={'width': 1300, 'height': 900}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(URL + '#/designer'); pg.wait_for_timeout(700)
    pg.click('.d-item:has-text("nama_depan")')
    x0 = float(pg.input_value('[data-k=x]'))
    box = pg.locator('.fbox[data-id=nama_depan]').bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); pg.mouse.down(); pg.mouse.move(box['x'] + box['width'] / 2 + 20, box['y'] + box['height'] / 2 + 10, steps=5); pg.mouse.up()
    x1 = float(pg.input_value('[data-k=x]')); check('drag menggeser X', x1 > x0)
    pg.click('#d-undo'); check('undo mengembalikan X', abs(float(pg.input_value('[data-k=x]')) - x0) < 0.01)
    pg.click('#d-redo'); check('redo menerapkan lagi', abs(float(pg.input_value('[data-k=x]')) - x1) < 0.01)
    pg.fill('[data-k=y]', '71.3'); pg.dispatch_event('[data-k=y]', 'change')
    pg.click('#d-approve'); pg.wait_for_timeout(200)
    pg.reload(); pg.wait_for_timeout(700); pg.click('.d-item:has-text("nama_depan")')
    check('konfigurasi bertahan setelah refresh', abs(float(pg.input_value('[data-k=y]')) - 71.3) < 0.01)
    check('status disetujui', 'disetujui' in pg.inner_text('#d-status'))
    pg.goto(URL + '#/generator'); pg.wait_for_timeout(500)
    pg.fill('[data-key=nama]', 'A' * 90); pg.wait_for_timeout(300)
    check('peringatan teks terlalu panjang tampil', 'terlalu panjang' in pg.inner_text('#pv-warn').lower())
    pg.fill('[data-key=nama]', 'BAIQ'); pg.fill('[data-key=jabatan]', 'Guru')
    check('nama tersinkron ke form belakang', pg.input_value('[data-sync=nama]') == 'BAIQ')
    m = b.new_context(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True).new_page(); m.on('pageerror', lambda e: errs.append(str(e)))
    for r in ['dashboard', 'generator', 'designer', 'settings']: m.goto(URL + '#/' + r); m.wait_for_timeout(500)
    check('tidak ada error JS (desktop & mobile)', not errs); b.close()
