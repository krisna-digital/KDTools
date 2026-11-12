"""Verifies the files produced by tests/e2e.mjs by opening them with independent tools."""
import json, os, subprocess, sys, zipfile, io
from PIL import Image
OUT = os.path.join(os.path.dirname(__file__), 'out')
res = {r['name']: r for r in json.load(open(f'{OUT}/results.json'))}
ok_all = True
def check(name, cond, msg=''):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + name + (' – ' + msg if msg else ''))
    ok_all &= bool(cond)
def p(*a): return os.path.join(OUT, *a)
def img(n, f): return Image.open(p(n, f))
def pdftext(path): return subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
def pdfinfo(path): return subprocess.run(['pdfinfo', path], capture_output=True, text=True).stdout
import re
def pages(path): return int(re.search(r'Pages:\s+(\d+)', pdfinfo(path)).group(1))

# --- images
i = img('jpg-png', 'photo.png'); check('jpg-png', i.format == 'PNG' and i.size == (400, 300))
i = img('png-jpg', 'alpha.jpg'); check('png-jpg', i.format == 'JPEG' and i.convert('RGB').getpixel((5, 5))[0] > 240, 'transparent corner became white: %s' % (i.convert('RGB').getpixel((5, 5)),))
i = img('png-webp', 'alpha.webp'); check('png-webp keeps alpha', i.format == 'WEBP' and i.mode in ('RGBA', 'LA') and i.getpixel((5, 5))[3] == 0)
i = img('webp-png', 'pic.png'); check('webp-png', i.format == 'PNG')
i = img('webp-jpg', 'pic.jpg'); check('webp-jpg', i.format == 'JPEG')
i = img('jpg-webp', 'photo.webp'); check('jpg-webp', i.format == 'WEBP')
i = img('svg-png', 'vec.png'); check('svg-png', i.format == 'PNG' and i.size[0] == 1536 and i.size[1] == 768 and i.convert('RGB').getpixel((i.size[0]//2, i.size[1]//2))[2] > 150, f'{i.size}')
i = img('svg-jpg', 'vec.jpg'); check('svg-jpg', i.format == 'JPEG')
i = img('bmp-png', 'pic.png'); check('bmp-png', i.format == 'PNG' and i.size == (400, 300))
i = img('gif-png', 'pic.png'); check('gif-png', i.format == 'PNG')
a, b = img('image-compress', 'photo.jpg'), img('image-compress', 'alpha.png')
check('image-compress sizes', os.path.getsize(p('image-compress', 'photo.jpg')) < os.path.getsize('tests/fixtures/photo.jpg') and a.format == 'JPEG' and b.format == 'PNG')
# --- pdf render
i = img('pdf-jpg', 'doc.jpg'); check('pdf-jpg', i.format == 'JPEG' and abs(i.size[0] - 8.5 * 150) < 5, str(i.size))
i = img('pdf-png', 'doc.png'); check('pdf-png', i.format == 'PNG')
# --- to pdf
for n, f in [('jpg-pdf', 'photo.pdf'), ('png-pdf', 'alpha.pdf')]:
    check(n, pages(p(n, f)) == 1)
t = pdftext(p('txt-pdf', 'notes.pdf')); check('txt-pdf text', 'Hello world' in t and 'Third paragraph' in t and 'caf' in t, t[:60].replace('\n', ' '))
t = pdftext(p('html-pdf', 'page.pdf')); check('html-pdf text', 'Title' in t and 'bold' in t and 'One' in t and 'alert' not in t and 'A' in t, t[:100].replace('\n', ' '))
t = pdftext(p('docx-pdf', 'doc.pdf')); check('docx-pdf text', 'Report Title' in t and 'Item one' in t and 'R2C2' in t, t[:100].replace('\n', ' '))
check('docx-pdf has image', 'jpeg' in subprocess.run(['pdfimages', '-list', p('docx-pdf', 'doc.pdf')], capture_output=True, text=True).stdout.lower() or 'image' in subprocess.run(['pdfimages', '-list', p('docx-pdf', 'doc.pdf')], capture_output=True, text=True).stdout.lower())
t = pdftext(p('xlsx-pdf', 'book.pdf')); check('xlsx-pdf text', 'Item 3' in t and 'Sales' in t and '2024-01-03' in t or 'Jan' in t, t[:150].replace('\n', ' '))
t = pdftext(p('pptx-pdf', 'deck.pdf')); check('pptx-pdf text', 'Slide Title' in t and 'Body bullet' in t and 'Second slide' in t, t[:100].replace('\n', ' '))
check('pptx-pdf pages', pages(p('pptx-pdf', 'deck.pdf')) == 2)
t = pdftext(p('merge', 'images.pdf')); check('merge 2 images → 1 pdf with 2 pages', pages(p('merge', 'images.pdf')) == 2)
# --- spreadsheets
import openpyxl
wb = openpyxl.load_workbook(p('csv-xlsx', 'data.xlsx')); ws = wb.active
rows = [[c.value for c in r] for r in ws.iter_rows()]
check('csv-xlsx', rows[0] == ['id', 'name', 'amount', 'note'] and rows[1][0] == '007' and rows[1][3] == 'has;semi' and rows[3][3] == 'multi\nline', str(rows))
c1 = open(p('xlsx-csv', 'book-Sales.csv'), encoding='utf-8').read().splitlines(); check('xlsx-csv', c1[0] == 'Item,Qty,Price,Date' and c1[1].startswith('Item 1,3,1.25,2024-01-01'), c1[1])
c2 = open(p('xlsx-csv', 'book-Second.csv'), encoding='utf-8').read(); check('xlsx-csv utf8', 'é' in c2)
# --- pdf -> office
import docx as pydocx
d = pydocx.Document(p('pdf-docx', 'doc.docx')); txt = '\n'.join(x.text for x in d.paragraphs)
check('pdf-docx text', 'Report Title' in txt and 'Item one' in txt and 'with bold' in txt, txt[:80].replace('\n', ' '))
check('pdf-docx table', len(d.tables) >= 1 or 'R0C0' in txt, f'tables={len(d.tables)}')
wb = openpyxl.load_workbook(p('pdf-xlsx', 'table.xlsx')); ws = wb.worksheets[0]; rr = [[c.value for c in r] for r in ws.iter_rows()]
check('pdf-xlsx', rr[0][:4] == ['Item', 'Qty', 'Price', 'Date'] and rr[1][0] == 'Item 1' and rr[1][1] == 3 and rr[1][2] == 1.25, str(rr[:3]))
from pptx import Presentation
pr = Presentation(p('pdf-pptx', 'doc.pptx')); alltext = ' '.join(sh.text_frame.text for s in pr.slides for sh in s.shapes if sh.has_text_frame)
check('pdf-pptx text', 'Report Title' in alltext and len(pr.slides) >= 1, alltext[:80])
# --- zip
z = sorted(os.listdir(p('zip-extract'))); check('zip-extract', z == ['a.txt', 'b.txt', 'c.csv', 'evil.txt'] and open(p('zip-extract', 'a.txt')).read() == 'alpha', str(z))
zz = zipfile.ZipFile(p('zip-create', 'archive.zip')); check('zip-create', sorted(zz.namelist()) == ['notes.txt', 'photo.jpg'] and zz.testzip() is None)
# --- error handling
b = res['batch-mixed']; st = {s['name']: s['status'] for s in b['statuses']}
check('batch: good file done, bad ones rejected', st == {'photo.jpg': 'Done', 'alpha.png': 'Invalid', 'fake.png': 'Invalid', 'empty.txt': 'Invalid'}, str(st))
b = res['fake-content']; check('fake png rejected, real converted', {s['name']: s['status'] for s in b['statuses']} == {'alpha.png': 'Done', 'fake.png': 'Invalid'} and 'renaming' in b['errors'][0])
b = res['scanned-no-ocr']; check('scanned pdf gives honest error', b['statuses'][0]['status'] == 'Failed' and 'no selectable text' in b['errors'][0].lower())
for n in ('heic-unavailable', 'ffmpeg-unavailable'):
    b = res[n]; check(n + ' flagged unavailable & Convert disabled', bool(b['banner'] and 'Not available' in b['banner'][0]) and b.get('convertDisabled'))
bad = {n: r['console'] for n, r in res.items() if r['console']}
check('no console errors', not bad, str(bad)[:200])
sys.exit(0 if ok_all else 1)
