import { CanvasEngine } from './canvas-engine.js';
import { Gallery } from './gallery.js';

class App {
  constructor() {
    this.config = null;
    this.engine = null;
    this.gallery = null;
    this.soundEnabled = true;
    this.audioCtx = null;
    this.toastContainer = null;
    this._fillActive = false;
    this._currentColor = '#ff6b6b';
    this._fillSettings = { tol: 45, lineThr: 100, seam: 1 };
  }

  async boot() {
    try {
      const resp = await fetch('js/config.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.config = await resp.json();
    } catch (err) {
      console.error('Config konnte nicht geladen werden:', err);
      this._createToastContainer();
      this.showToast('❌ Konfiguration konnte nicht geladen werden!');
      return;
    }
    this._createToastContainer();

    const canvasEl  = document.getElementById('draw-canvas');
    const overlayEl = document.getElementById('overlay-img');
    if (!canvasEl || !overlayEl) {
      this.showToast('❌ Malfläche nicht gefunden – index.html prüfen!');
      return;
    }

    this.engine = new CanvasEngine(canvasEl, overlayEl, this.config);
    this.engine.enableHiDPI();

    this.gallery = new Gallery(this.config);
    this.gallery.onLoadImage = (dataUrl) => this._loadGalleryImage(dataUrl);

    this.soundEnabled = this.config.sounds.enabled !== false;
    this._syncSoundButton();
    this._currentColor = this.config.colors?.[0]?.hex || '#ff6b6b';
    this._setupBlankTemplate();

    this._wireTools();
    this._wireFill();
    this._wireMirror();
    this._wireColors();
    this._wireSizes();
    this._wireActions();
    this._wireSave();
    this._wireTemplate();
    this._wireOverlayOpacity();
    this._wireFillTuning();
    this._wireGallery();
    this._wireSound();
    this._wireShortcuts();
    this._wireOverlayControls();
    this._wireDarkMode();
    this._wireStageHint(canvasEl);

    this.showToast('🎨 Artify-Kids ist bereit – los geht\u2019s!');
  }

  /* ═══════════════ TEMPLATE ═══════════════ */
  _getBlankTemplate() {
    const w = this.config.canvas.width, h = this.config.canvas.height;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
                `<rect width="100%" height="100%" fill="#FFFFFF"/></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  _setupBlankTemplate() {
    const blend = this.config.overlay?.blendMode || 'multiply';
    this.engine.overlay.style.mixBlendMode = blend;
    this._setOverlayOpacity(this.config.overlay?.opacity ?? 0.9);
    this.engine.setOverlay(this._getBlankTemplate());
  }

  /* ═══════════════ TOAST ═══════════════ */
  _createToastContainer() {
    if (this.toastContainer) return;
    this.toastContainer = document.createElement('div');
    this.toastContainer.className = 'toast-container';
    document.body.appendChild(this.toastContainer);
  }
  showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    this.toastContainer.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
  }

  /* ═══════════════ WERKZEUGE ═══════════════ */
  _wireTools() {
    const toolMap = { 'btn-brush':'brush', 'btn-rainbow':'rainbow', 'btn-spray':'spray', 'btn-eraser':'eraser' };
    for (const [id, tool] of Object.entries(toolMap)) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      btn.addEventListener('click', () => this._activateTool(id, tool));
    }
  }
  _activateTool(btnId, toolName) {
    this._fillActive = false;
    this._restoreCursor();
    this.engine.setTool(toolName);
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
    this._playClickSound();
  }

  /* ═══════════════ FILL TOOL ═══════════════ */
  _wireFill() {
    const fillBtn = document.getElementById('btn-fill');
    const canvas  = document.getElementById('draw-canvas');
    if (!fillBtn || !canvas) return;

    fillBtn.addEventListener('click', () => {
      this._fillActive = true;
      this.engine.setTool('__fill__');
      document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
      fillBtn.classList.add('active');
      canvas.style.cursor = 'crosshair';
      this._playClickSound();
      this.showToast('🪣 Ausmalen aktiv – klick auf eine Fläche!');
    });

    const wrapper = canvas.parentElement;
    wrapper.addEventListener('pointerdown', (e) => {
      if (!this._fillActive) return;
      e.preventDefault();
      e.stopPropagation();
      const rect   = canvas.getBoundingClientRect();
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top)  * scaleY);
      const filled = this._floodFillAuto(x, y, this._currentColor);
      if (filled) {
        this.engine.saveSnapshot();
        this._hideStageHint();
        this._playClickSound();
      }
    }, true);
  }
  _restoreCursor() {
    const canvas = document.getElementById('draw-canvas');
    if (canvas) canvas.style.cursor = '';
  }

  /* ── Overlay contain-korrekt auf einen Context malen ── */
  _drawOverlayContain(ctx, W, H) {
    const ov = this.engine.overlay;
    const iw = ov.naturalWidth, ih = ov.naturalHeight;
    if (!iw || !ih) return;
    const cR = W / H, iR = iw / ih;
    let dw, dh, dx, dy;
    if (iR > cR) { dw = W; dh = W / iR; dx = 0;        dy = (H - dh) / 2; }
    else         { dh = H; dw = H * iR; dx = (W - dw) / 2; dy = 0; }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ov, dx, dy, dw, dh);
    ctx.restore();
  }

  /* ── Vorlage in die Leinwand einbrennen (löst weiße Geister-Linien) ── */
  _bakeOverlay() {
    const ov = this.engine.overlay;
    if (!ov || !ov.naturalWidth) { this.showToast('⚠️ Keine Vorlage zum Übernehmen!'); return; }
    const W = this.engine.width || this.engine.ctx.canvas.width;
    const H = this.engine.height || this.engine.ctx.canvas.height;
    this._drawOverlayContain(this.engine.ctx, W, H);
    ov.classList.add('hidden');
    ov.removeAttribute('src');
    const controls = document.getElementById('overlay-controls');
    if (controls) controls.classList.add('hidden');
    this.engine.saveSnapshot();
    this._hideStageHint();
    this._playClickSound();
    this.showToast('🖼️ Linien liegen auf der Leinwand – jetzt 🪣 nutzen!');
  }

  /* ── Boundary-Map (contain-korrekt + Lücken schließen) ── */
  _buildBoundary(w, h) {
    const ov = this.engine.overlay;
    if (!ov || !ov.src || !ov.naturalWidth || ov.classList.contains('hidden')) return null;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    const iw = ov.naturalWidth, ih = ov.naturalHeight;
    const cR = w / h, iR = iw / ih;
    let dw, dh, dx, dy;
    if (iR > cR) { dw = w; dh = w / iR; dx = 0;        dy = (h - dh) / 2; }
    else         { dh = h; dw = h * iR; dx = (w - dw) / 2; dy = 0; }
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(ov, dx, dy, dw, dh);
    const m = tctx.getImageData(0, 0, w, h).data;
    const thr = this._fillSettings.lineThr;
    let b = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const mi = i * 4;
      if (m[mi + 3] < 80) continue;
      if ((m[mi] + m[mi + 1] + m[mi + 2]) / 3 < thr) b[i] = 1;
    }
    // Closing (dilate→erode) schließt Lücken in dünnen Linien
    b = this._dilate(b, w, h);
    b = this._erode(b, w, h);
    return b;
  }
  _dilate(src, w, h) {
    const out = new Uint8Array(src);
    for (let y = 1; y < h - 1; y++) {
      const r = y * w;
      for (let x = 1; x < w - 1; x++) {
        if (src[r + x]) { out[r - w + x] = 1; out[r + w + x] = 1; out[r + x - 1] = 1; out[r + x + 1] = 1; }
      }
    }
    return out;
  }
  _erode(src, w, h) {
    const out = new Uint8Array(src);
    for (let y = 1; y < h - 1; y++) {
      const r = y * w;
      for (let x = 1; x < w - 1; x++) {
        if (src[r + x] && !(src[r - w + x] && src[r + w + x] && src[r + x - 1] && src[r + x + 1])) out[r + x] = 0;
      }
    }
    return out;
  }

  /* ── Flood Fill + Naht-Verschmelzung (für manuelle Nutzung mit Boundary) ── */
  _floodFill(startX, startY, fillHex) {
    const canvas = document.getElementById('draw-canvas');
    const ctx = this.engine.ctx;
    const w = canvas.width, h = canvas.height;
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return false;

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const boundary = this._buildBoundary(w, h);

    const startPi = startY * w + startX;
    if (boundary && boundary[startPi]) return false;

    const si = startPi * 4;
    const tR = d[si], tG = d[si + 1], tB = d[si + 2], tA = d[si + 3];
    const [fR, fG, fB] = this._hexToRgb(fillHex);
    if (tR === fR && tG === fG && tB === fB && tA === 255) return false;

    const tol = this._fillSettings.tol;
    const visited = new Uint8Array(w * h);
    const stack = [startX, startY];
    let filled = 0;
    let minX = startX, maxX = startX, minY = startY, maxY = startY;

    while (stack.length > 0) {
      const y = stack.pop(), x = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const pi = y * w + x;
      if (visited[pi]) continue;
      if (boundary && boundary[pi]) continue;
      const i = pi * 4;
      if (Math.abs(d[i] - tR) > tol || Math.abs(d[i + 1] - tG) > tol ||
          Math.abs(d[i + 2] - tB) > tol || Math.abs(d[i + 3] - tA) > tol) continue;
      visited[pi] = 1;
      d[i] = fR; d[i + 1] = fG; d[i + 2] = fB; d[i + 3] = 255;
      filled++;
      if (x < minX) minX = x; else if (x > maxX) maxX = x;
      if (y < minY) minY = y; else if (y > maxY) maxY = y;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    if (filled === 0) return false;

    // Naht-Verschmelzung: helle Gräben zwischen Füllung und Linie schließen
    const seam = this._fillSettings.seam | 0;
    if (seam > 0) this._mergeSeams(d, w, h, fR, fG, fB, minX, maxX, minY, maxY, seam);

    ctx.putImageData(imageData, 0, 0);
    return true;
  }

  /* ── Auto Flood Fill OHNE Boundary-Map – funktioniert immer & überall ── */
  _floodFillAuto(startX, startY, fillHex) {
    const canvas = document.getElementById('draw-canvas');
    const ctx = this.engine.ctx;
    const w = canvas.width, h = canvas.height;
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return false;

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    const startPi = startY * w + startX;
    const si = startPi * 4;
    const tR = d[si], tG = d[si + 1], tB = d[si + 2], tA = d[si + 3];
    const [fR, fG, fB] = this._hexToRgb(fillHex);
    
    // Nicht füllen wenn bereits dieselbe Farbe
    if (tR === fR && tG === fG && tB === fB && tA === 255) return false;

    // Auto-Toleranz: je nach Helligkeit anpassen
    const brightness = (tR + tG + tB) / 3;
    let autoTol = 35;
    if (brightness > 200) autoTol = 50;       // Sehr helle Flächen → höhere Toleranz
    else if (brightness < 50) autoTol = 25;   // Sehr dunkle Flächen → niedrigere Toleranz
    
    const visited = new Uint8Array(w * h);
    const stack = [[startX, startY]];
    let filled = 0;
    let minX = startX, maxX = startX, minY = startY, maxY = startY;

    while (stack.length > 0) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const pi = y * w + x;
      if (visited[pi]) continue;
      
      const i = pi * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      
      // Euklidische Distanz für präzisere Farberkennung
      const dist = Math.sqrt(
        Math.pow(r - tR, 2) + 
        Math.pow(g - tG, 2) + 
        Math.pow(b - tB, 2)
      );
      if (dist > autoTol) continue;
      
      visited[pi] = 1;
      d[i] = fR; d[i + 1] = fG; d[i + 2] = fB; d[i + 3] = 255;
      filled++;
      
      if (x < minX) minX = x; else if (x > maxX) maxX = x;
      if (y < minY) minY = y; else if (y > maxY) maxY = y;
      
      // 4-directional flood fill
      stack.push([x + 1, y]);
      stack.push([x - 1, y]);
      stack.push([x, y + 1]);
      stack.push([x, y - 1]);
    }
    
    if (filled === 0) return false;

    // Naht-Verschmelzung für saubere Kanten
    const seam = 2;
    this._mergeSeams(d, w, h, fR, fG, fB, minX, maxX, minY, maxY, seam);

    ctx.putImageData(imageData, 0, 0);
    return true;
  }

  /* Füllt nur helle Pixel, die zwischen Füllfarbe UND Linie eingeklemmt sind.
     Große weiße Flächen (Augen) bleiben, weil dort kein Füll-Nachbar direkt anliegt. */
  _mergeSeams(d, w, h, fR, fG, fB, minX, maxX, minY, maxY, passes) {
    const x0 = Math.max(0, minX - 3), x1 = Math.min(w - 1, maxX + 3);
    const y0 = Math.max(0, minY - 3), y1 = Math.min(h - 1, maxY + 3);
    const isFill = (i) => Math.abs(d[i] - fR) <= 2 && Math.abs(d[i + 1] - fG) <= 2 && Math.abs(d[i + 2] - fB) <= 2 && d[i + 3] > 200;
    const isLine = (i) => d[i + 3] > 80 && (d[i] + d[i + 1] + d[i + 2]) / 3 < 110;

    for (let p = 0; p < passes; p++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * w + x) * 4;
          if (d[i + 3] < 200) continue;
          const bright = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (bright <= 200) continue;                 // nur helle/unfüllte Kandidaten
          let hasFill = false;
          if (x > 0 && isFill(i - 4)) hasFill = true;
          else if (x < w - 1 && isFill(i + 4)) hasFill = true;
          else if (y > 0 && isFill(i - w * 4)) hasFill = true;
          else if (y < h - 1 && isFill(i + w * 4)) hasFill = true;
          if (!hasFill) continue;
          let hasLine = false;
          outer:
          for (let dy = -2; dy <= 2; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= w) continue;
              if (isLine((ny * w + nx) * 4)) { hasLine = true; break outer; }
            }
          }
          if (!hasLine) continue;
          d[i] = fR; d[i + 1] = fG; d[i + 2] = fB; d[i + 3] = 255;
        }
      }
    }
  }

  _hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ═══════════════ FEINJUSTAGE-REGLER ═══════════════ */
  _wireFillTuning() {
    const bind = (id, valId, key) => {
      const el = document.getElementById(id), lab = document.getElementById(valId);
      if (!el) return;
      el.addEventListener('input', () => {
        this._fillSettings[key] = parseInt(el.value, 10);
        if (lab) lab.textContent = el.value;
      });
    };
    bind('fill-tol',  'val-tol',  'tol');
    bind('fill-line', 'val-line', 'lineThr');
    bind('fill-seam', 'val-seam', 'seam');
  }

  /* ═══════════════ VORLAGE-DECKKRAFT ═══════════════ */
  _setOverlayOpacity(val) {
    this.engine.overlay.style.setProperty('--overlay-opacity', val);
    const slider = document.getElementById('overlay-opacity');
    const label  = document.getElementById('opacity-value');
    if (slider) { slider.value = Math.round(val * 100); slider.style.setProperty('--fill', slider.value + '%'); }
    if (label) label.textContent = Math.round(val * 100) + '%';
  }
  _wireOverlayOpacity() {
    const slider = document.getElementById('overlay-opacity');
    if (!slider) return;
    slider.style.setProperty('--fill', slider.value + '%');
    slider.addEventListener('input', (e) => this._setOverlayOpacity(e.target.value / 100));
  }

  /* ═══════════════ SPIEGEL ═══════════════ */
  _wireMirror() {
    document.querySelectorAll('.btn-mirror').forEach(btn => {
      btn.addEventListener('click', () => {
        this.engine.setMirror(btn.dataset.mirror);
        document.querySelectorAll('.btn-mirror').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._playClickSound();
        const label = { 0:'🪄 Spiegel aus', 2:'🪄 2× Spiegel!', 4:'🪄 4× Spiegel!', 8:'✨ 8× Spiegel-Magie!' };
        this.showToast(label[btn.dataset.mirror] || '🪄 Spiegel!');
      });
    });
  }

  /* ═══════════════ FARBEN ═══════════════ */
  _wireColors() {
    const paletteEl = document.getElementById('color-palette');
    if (!paletteEl) return;
    for (const colorDef of this.config.colors) {
      const swatch = document.createElement('button');
      swatch.className = 'color-swatch';
      swatch.style.background = colorDef.hex;
      swatch.setAttribute('aria-label', colorDef.name);
      swatch.setAttribute('title', colorDef.name);
      if (colorDef.hex === this.config.colors[0].hex) swatch.classList.add('active');
      swatch.addEventListener('click', () => {
        this.engine.setColor(colorDef.hex);
        this._currentColor = colorDef.hex;
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        const picker = document.getElementById('color-picker');
        if (picker && /^#[0-9a-fA-F]{6}$/.test(colorDef.hex)) picker.value = colorDef.hex;
        this.engine.updateCursor();
        this._playClickSound();
      });
      paletteEl.appendChild(swatch);
    }
    const picker = document.getElementById('color-picker');
    if (picker) {
      picker.addEventListener('input', (e) => {
        this.engine.setColor(e.target.value);
        this._currentColor = e.target.value;
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        this.engine.updateCursor();
      });
    }
  }

  /* ═══════════════ GRÖSSEN ═══════════════ */
  _wireSizes() {
    const sizeEl = document.getElementById('size-picker');
    if (!sizeEl) return;
    for (const sizeDef of this.config.brushSizes) {
      const dot = document.createElement('button');
      dot.className = 'size-dot';
      dot.style.width  = sizeDef.dotSize + 'px';
      dot.style.height = sizeDef.dotSize + 'px';
      dot.setAttribute('aria-label', sizeDef.label);
      dot.setAttribute('title', sizeDef.label);
      if (sizeDef.size === this.engine.brushSize) dot.classList.add('active');
      dot.addEventListener('click', () => {
        this.engine.setBrushSize(sizeDef.size);
        document.querySelectorAll('.size-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this._playClickSound();
      });
      sizeEl.appendChild(dot);
    }
  }

  /* ═══════════════ AKTIONEN ═══════════════ */
  _wireActions() {
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => {
      if (!this.engine.undo()) this.showToast('🤷 Nichts zum Rückgängigmachen!');
      this._playUndoSound();
    });
    const redoBtn = document.getElementById('btn-redo');
    if (redoBtn) redoBtn.addEventListener('click', () => {
      if (!this.engine.redo()) this.showToast('🤷 Nichts zum Wiederholen!');
      this._playUndoSound();
    });
    const clearBtn = document.getElementById('btn-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      this.engine.clearCanvas();
      this.showToast('🗑️ Leinwand geleert – Undo bringt es zurück!');
      this._playClickSound();
    });
  }

  /* ═══════════════ SPEICHERN ═══════════════ */
  _wireSave() {
    const saveBtn = document.getElementById('btn-save');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const dataUrl = this.engine.getImageData();
        const resp = await fetch(this.config.save.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl })
        });
        if (!resp.ok) { this.showToast('😢 Speichern hat nicht geklappt!'); return; }
        this.showToast('💾 Super! Kunstwerk gespeichert! 🎉');
        this._playSaveSound();
        this._launchConfetti();
        if (this.config.gallery.refreshAfterSave) this.gallery.refresh();
      } catch (err) {
        console.error('Speicher-Fehler:', err);
        this.showToast('😢 Fehler beim Speichern!');
      } finally { saveBtn.disabled = false; }
    });
  }

  /* ═══════════════ VORLAGE ═══════════════ */
  _wireTemplate() {
    const input = document.getElementById('btn-template');
    if (!input) return;
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!this.config.overlay.allowedTypes.includes(file.type)) { this.showToast('❌ Nur PNG, JPEG oder SVG erlaubt!'); return; }
      if (file.size > this.config.overlay.maxFileSizeMB * 1024 * 1024) { this.showToast(`❌ Datei zu groß (max. ${this.config.overlay.maxFileSizeMB} MB)!`); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        this.engine.setOverlay(ev.target.result);
        const controls = document.getElementById('overlay-controls');
        if (controls) controls.classList.remove('hidden');
        this.showToast('📄 Vorlage geladen – Tipp: erst „In Bild", dann 🪣!');
        this._playClickSound();
      };
      reader.readAsDataURL(file);
      input.value = '';
    });
  }
  _wireOverlayControls() {
    const toggleBtn = document.getElementById('btn-overlay-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
      const visible = this.engine.toggleOverlay();
      const emoji = toggleBtn.querySelector('.tool-emoji');
      if (emoji) emoji.textContent = visible ? '👁️' : '🙈';
      this.showToast(visible ? '👁️ Vorlage eingeblendet!' : '🙈 Vorlage versteckt!');
      this._playClickSound();
    });
    const bakeBtn = document.getElementById('btn-overlay-bake');
    if (bakeBtn) bakeBtn.addEventListener('click', () => this._bakeOverlay());
    const removeBtn = document.getElementById('btn-overlay-remove');
    if (removeBtn) removeBtn.addEventListener('click', () => {
      this.engine.setOverlay(this._getBlankTemplate());
      const controls = document.getElementById('overlay-controls');
      if (controls) controls.classList.add('hidden');
      this.showToast('🧻 Vorlage entfernt – frisches Blatt!');
      this._playClickSound();
    });
  }

  /* ═══════════════ GALERIE ═══════════════ */
  _wireGallery() {
    const galleryBtn = document.getElementById('btn-gallery');
    if (!galleryBtn) return;
    galleryBtn.addEventListener('click', () => { this.gallery.open(); this._playClickSound(); });
  }
  _loadGalleryImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      const { ctx, width, height } = this.engine;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = this.config.canvas.background || '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      const scale = Math.min(width / img.width, height / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
      ctx.restore();
      this.engine.saveSnapshot();
      this._hideStageHint();
      this.showToast('📂 Bild auf die Leinwand geladen – mal weiter!');
    };
    img.src = dataUrl;
  }

  /* ═══════════════ SOUND ═══════════════ */
  _syncSoundButton() {
    const btn = document.getElementById('btn-sound');
    if (!btn) return;
    btn.textContent = this.soundEnabled ? '🔊' : '🔇';
    btn.setAttribute('aria-label', this.soundEnabled ? 'Sound ausschalten' : 'Sound einschalten');
  }
  _wireSound() {
    const soundBtn = document.getElementById('btn-sound');
    if (!soundBtn) return;
    soundBtn.addEventListener('click', () => {
      this.soundEnabled = !this.soundEnabled;
      this._syncSoundButton();
      this.showToast(this.soundEnabled ? '🔊 Sound an!' : '🔇 Sound aus!');
      if (this.soundEnabled) this._playClickSound();
    });
  }

  /* ═══════════════ DARK MODE ═══════════════ */
  _wireDarkMode() {
    const btn = document.getElementById('btn-darkmode');
    if (!btn) return;
    const saved = localStorage.getItem('artstudio-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) { document.documentElement.setAttribute('data-theme', 'dark'); btn.textContent = '☀️'; }
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
      btn.textContent = isDark ? '🌙' : '☀️';
      localStorage.setItem('artstudio-theme', isDark ? 'light' : 'dark');
      this._playClickSound();
    });
  }

  /* ═══════════════ STAGE HINT ═══════════════ */
  _wireStageHint(canvasEl) {
    const hint = document.getElementById('stage-hint');
    if (!hint) return;
    canvasEl.addEventListener('pointerdown', () => hint.classList.add('hidden'), { once: true });
  }
  _hideStageHint() { document.getElementById('stage-hint')?.classList.add('hidden'); }

  /* ═══════════════ SHORTCUTS ═══════════════ */
  _wireShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.gallery && this.gallery.isOpen()) { this.gallery.close(); return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase(), sc = this.config.shortcuts;
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') { e.preventDefault(); this.engine.undo(); this._playUndoSound(); }
        else if (key === 'y') { e.preventDefault(); this.engine.redo(); this._playUndoSound(); }
        else if (key === 's') { e.preventDefault(); document.getElementById('btn-save')?.click(); }
        return;
      }
      if (key === sc.brush)        this._activateTool('btn-brush', 'brush');
      else if (key === sc.rainbow) this._activateTool('btn-rainbow', 'rainbow');
      else if (key === sc.spray)   this._activateTool('btn-spray', 'spray');
      else if (key === sc.eraser)  this._activateTool('btn-eraser', 'eraser');
      else if (key === (sc.fill || 'f')) document.getElementById('btn-fill')?.click();
    });
  }

  /* ═══════════════ AUDIO ═══════════════ */
  _initAudio() {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }
  _playTone(freq, dur, type) {
    if (!this.soundEnabled) return;
    try {
      this._initAudio();
      const osc = this.audioCtx.createOscillator(), gain = this.audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.value = this.config.sounds.volume;
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + dur);
      osc.connect(gain); gain.connect(this.audioCtx.destination);
      osc.start(); osc.stop(this.audioCtx.currentTime + dur);
    } catch {}
  }
  _playClickSound() { const s = this.config.sounds.clickSound; this._playTone(s.frequency, s.duration, s.type); }
  _playUndoSound()  { const s = this.config.sounds.undoSound;  this._playTone(s.frequency, s.duration, s.type); }
  _playSaveSound()  { const s = this.config.sounds.saveSound;  this._playTone(s.frequency, s.duration, s.type); }

  /* ═══════════════ KONFETTI ═══════════════ */
  _launchConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);
    const colors = ['#FF6B6B', '#FFD93D', '#4FC3F7', '#4ECDC4', '#9B59B6', '#FF8ED4'];
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
      piece.style.animationDelay = Math.random() * 0.5 + 's';
      piece.style.width  = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      container.appendChild(piece);
    }
    setTimeout(() => { if (container.parentNode) container.parentNode.removeChild(container); }, 4000);
  }
}

const app = new App();
app.boot();