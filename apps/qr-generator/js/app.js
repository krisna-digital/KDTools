(() => {
  const $ = id => document.getElementById(id);
  const FRAME_DIR = 'assets/frames/';
  const DEFAULT_URL = 'https://contoh.com';

  // Frame bawaan (digambar lewat canvas)
  const builtin = [
    { id: 'none', name: 'Tanpa frame', type: 'none', icon: '▢' },
    { id: 'outline', name: 'Garis tepi', type: 'outline', icon: '◻' },
    { id: 'banner', name: 'Banner bawah', type: 'banner', icon: '▭' }
  ];
  let frames = [...builtin];
  let current = builtin[0];
  const placement = {}; // override posisi per frame gambar: {x,y,size} (0-1)
  let logoURL = null;
  let timer = null;

  const canvas = $('out');
  const ctx = canvas.getContext('2d');

  function loadImg(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
  }

  async function makeQR(px) {
    const data = $('data').value.trim() || DEFAULT_URL;
    const fg = $('fg').value;
    const qr = new QRCodeStyling({
      width: px, height: px, type: 'canvas', data,
      margin: Math.round(px * 0.04),
      qrOptions: { errorCorrectionLevel: $('ec').value },
      dotsOptions: { color: fg, type: $('dots').value },
      cornersSquareOptions: { color: fg, type: $('corner').value },
      cornersDotOptions: { color: fg },
      backgroundOptions: { color: $('bg').value },
      image: logoURL || undefined,
      imageOptions: { crossOrigin: 'anonymous', margin: 4, imageSize: 0.3 }
    });
    const blob = await qr.getRawData('png');
    return loadImg(URL.createObjectURL(blob));
  }

  function rr(x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  async function render() {
    const f = current;
    if (f.type === 'image') {
      const img = f.img;
      const p = getPlacement(f);
      const size = Math.round(p.size * img.naturalWidth);
      const qrImg = await makeQR(Math.max(size, 64));
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.drawImage(qrImg, Math.round(p.x * canvas.width - size / 2), Math.round(p.y * canvas.height - size / 2), size, size);
      return;
    }

    const S = 1000;
    const qrImg = await makeQR(S);
    const color = $('frameColor').value;
    if (f.type === 'none') {
      canvas.width = S; canvas.height = S;
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(qrImg, 0, 0, S, S);
    } else if (f.type === 'outline') {
      const pad = 60;
      canvas.width = S + pad * 2; canvas.height = S + pad * 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rr(0, 0, canvas.width, canvas.height, 60, color);
      rr(24, 24, canvas.width - 48, canvas.height - 48, 40, $('bg').value);
      ctx.drawImage(qrImg, pad, pad, S, S);
    } else if (f.type === 'banner') {
      const pad = 60, bar = 220;
      canvas.width = S + pad * 2; canvas.height = S + pad * 2 + bar;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rr(0, 0, canvas.width, canvas.height, 60, color);
      rr(24, 24, canvas.width - 48, S + pad * 2 - 24, 40, $('bg').value);
      ctx.drawImage(qrImg, pad, pad, S, S);
      ctx.fillStyle = $('frameTextColor').value;
      ctx.font = '700 96px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText($('frameText').value, canvas.width / 2, S + pad * 2 + bar / 2 - 8, canvas.width - 120);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => render().catch(console.error), 120);
  }

  function getPlacement(f) {
    return placement[f.id] || (placement[f.id] = { x: 0.5, y: 0.5, size: 0.5, ...(f.qr || {}) });
  }

  function syncSliders() {
    const p = getPlacement(current);
    $('posX').value = p.x * 100;
    $('posY').value = p.y * 100;
    $('posS').value = p.size * 100;
    $('oX').textContent = (p.x * 100).toFixed(1) + '%';
    $('oY').textContent = (p.y * 100).toFixed(1) + '%';
    $('oS').textContent = (p.size * 100).toFixed(1) + '%';
  }

  function selectFrame(f) {
    current = f;
    document.querySelectorAll('.frame-item').forEach(b => b.classList.toggle('active', b.dataset.id === f.id));
    $('textBox').classList.toggle('hidden', !(f.type === 'banner' || f.type === 'outline'));
    $('frameText').parentElement.classList.toggle('hidden', f.type !== 'banner');
    $('frameTextColor').parentElement.classList.toggle('hidden', f.type !== 'banner');
    $('placeBox').classList.toggle('hidden', f.type !== 'image');
    if (f.type === 'image') syncSliders();
    schedule();
  }

  function buildList() {
    const list = $('frameList');
    list.innerHTML = '';
    frames.forEach(f => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'frame-item';
      b.dataset.id = f.id;
      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      if (f.type === 'image') {
        const im = document.createElement('img');
        im.src = f.src; im.alt = f.name;
        thumb.appendChild(im);
      } else {
        thumb.innerHTML = '<span class="ico">' + f.icon + '</span>';
      }
      const label = document.createElement('span');
      label.textContent = f.name;
      b.append(thumb, label);
      b.addEventListener('click', () => selectFrame(f));
      list.appendChild(b);
    });
  }

  async function loadManifest() {
    try {
      const res = await fetch(FRAME_DIR + 'frames.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      for (const item of json.frames || []) {
        try {
          const src = FRAME_DIR + item.file;
          const img = await loadImg(src);
          frames.push({
            id: item.id || item.file,
            name: item.name || item.file,
            type: 'image', src, img, qr: item.qr
          });
        } catch (e) {
          console.warn('Frame gagal dimuat:', item.file);
        }
      }
      const n = frames.length - builtin.length;
      $('frameNote').textContent = n
        ? ''
        : '';
    } catch (e) {
      $('frameNote').textContent = ' ';
    }
  }

  // Event
  ['data', 'fg', 'bg', 'dots', 'corner', 'ec', 'frameText', 'frameColor', 'frameTextColor']
    .forEach(id => $(id).addEventListener('input', schedule));

  ['posX', 'posY', 'posS'].forEach(id => $(id).addEventListener('input', () => {
    const p = getPlacement(current);
    p.x = $('posX').value / 100;
    p.y = $('posY').value / 100;
    p.size = $('posS').value / 100;
    syncSliders();
    schedule();
  }));

  $('copyPos').addEventListener('click', async () => {
    const p = getPlacement(current);
    const txt = JSON.stringify({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), size: +p.size.toFixed(3) });
    try { await navigator.clipboard.writeText(txt); $('copyPos').textContent = 'Tersalin: ' + txt; }
    catch { prompt('Salin nilai ini:', txt); }
  });

  $('logo').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      logoURL = r.result;
      $('clearLogo').classList.remove('hidden');
      if ($('ec').value !== 'H') $('ec').value = 'H';
      schedule();
    };
    r.readAsDataURL(file);
  });
  $('clearLogo').addEventListener('click', () => {
    logoURL = null;
    $('logo').value = '';
    $('clearLogo').classList.add('hidden');
    schedule();
  });

  $('download').addEventListener('click', () => {
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qr-code.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });

  (async function init() {
    await loadManifest();
    buildList();
    selectFrame(current);
  })();
})();
