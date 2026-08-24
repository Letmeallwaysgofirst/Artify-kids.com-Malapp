export class CanvasEngine {
  constructor(canvasEl, overlayEl, config) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { alpha: false, desynchronized: true });
    this.overlay = overlayEl;
    this.config = config;

    this.width = config.canvas.width;
    this.height = config.canvas.height;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.fillStyle = config.canvas.background || '#FFFFFF';
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.tool = 'brush';
    this.color = config.colors[0].hex;
    this.brushSize = config.brushSizes[2].size;
    this.mirrorMode = 0;
    this.hue = 0;

    this.isDrawing = false;
    this.lastX = 0;
    this.lastY = 0;
    this.points = [];

    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo = config.undo.maxSteps;

    this.sprayActive = false;
    this.sprayRAF = null;
    this._loadToken = 0;
    this.overlayVisible = true;

    this._mirroredPointsCache = new Map();
    this._strokeStyleCache = null;
    this._lastStrokeColor = null;

    this._bindPointerEvents();
    this.updateCursor();
    this.saveSnapshot();
  }

  enableHiDPI(maxDpr = 2) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (dpr <= 1) return;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.fillStyle = this.config.canvas.background || '#FFFFFF';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this._mirroredPointsCache.clear();
  }

  setTool(toolName) {
    if (this.sprayActive) this._stopSpray();
    this.tool = toolName;
    this.ctx.globalCompositeOperation = (toolName === 'eraser') ? 'destination-out' : 'source-over';
    this.updateCursor();
  }

  setColor(hex) {
    this.color = hex;
    if (this.tool === 'eraser') this.setTool('brush');
  }

  setBrushSize(size) {
    this.brushSize = size;
    this.updateCursor();
  }

  setMirror(mode) {
    this.mirrorMode = parseInt(mode, 10) || 0;
  }

  updateCursor() {
    const r = Math.max(4, this.brushSize);
    const svgSize = r + 6;
    const half = svgSize / 2;
    const innerR = r / 2;
    let fill = this.tool === 'eraser' ? '%2331295e' : encodeURIComponent(this.color);
    if (this.tool === 'rainbow') fill = '%23FF6B6B';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${svgSize}' height='${svgSize}'><circle cx='${half}' cy='${half}' r='${innerR}' fill='${fill}' opacity='0.4'/><circle cx='${half}' cy='${half}' r='${innerR}' fill='none' stroke='%2331295e' stroke-width='1.5'/></svg>`;
    this.canvas.style.cursor = `url("data:image/svg+xml,${svg}") ${half} ${half}, crosshair`;
  }

  saveSnapshot() {
    this.undoStack.push(this.canvas.toDataURL('image/png'));
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length <= 1) return false;
    this.redoStack.push(this.undoStack.pop());
    this._loadSnapshot(this.undoStack[this.undoStack.length - 1]);
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const data = this.redoStack.pop();
    this.undoStack.push(data);
    this._loadSnapshot(data);
    return true;
  }

  _loadSnapshot(dataUrl) {
    const token = ++this._loadToken;
    const img = new Image();
    img.onload = () => {
      if (token !== this._loadToken) return;
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  }

  clearCanvas() {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = this.config.canvas.background || '#FFFFFF';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.saveSnapshot();
  }

  getImageData() {
    return this.canvas.toDataURL('image/png');
  }

  setOverlay(src) {
    this.overlay.src = src;
    this.overlay.style.display = 'block';
    this.overlay.classList.remove('hidden');
    this.overlayVisible = true;
  }

  toggleOverlay() {
    this.overlayVisible = !this.overlayVisible;
    this.overlay.classList.toggle('hidden', !this.overlayVisible);
    return this.overlayVisible;
  }

  removeOverlay() {
    this.overlay.src = '';
    this.overlay.style.display = 'none';
    this.overlay.classList.add('hidden');
    this.overlayVisible = false;
  }

  _getCanvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    const cx = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const cy = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
  }

  _bindPointerEvents() {
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('pointerleave', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _onPointerDown(e) {
    e.preventDefault();
    if (this.isDrawing) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    this.isDrawing = true;
    const pos = this._getCanvasPos(e);
    this.lastX = pos.x;
    this.lastY = pos.y;
    this.points = [pos];
    if (this.tool === 'spray') {
      this._startSpray(pos);
    } else {
      this._drawDot(pos);
    }
  }

  _onPointerMove(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    const pos = this._getCanvasPos(e);
    if (this.tool === 'spray') {
      this.lastX = pos.x;
      this.lastY = pos.y;
      return;
    }
    this.points.push(pos);
    if (this.points.length >= 3) {
      const len = this.points.length;
      const p0 = this.points[len - 3];
      const p1 = this.points[len - 2];
      const p2 = this.points[len - 1];
      this._drawSmoothSegment(
        (p0.x + p1.x) / 2, (p0.y + p1.y) / 2,
        p1.x, p1.y,
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2
      );
    } else if (this.points.length === 2) {
      this._drawLineSeg(this.points[0].x, this.points[0].y, pos.x, pos.y);
    }
    this.lastX = pos.x;
    this.lastY = pos.y;
  }

  _onPointerUp() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.tool === 'spray') this._stopSpray();
    this.points = [];
    this.ctx.globalCompositeOperation = 'source-over';
    this.saveSnapshot();
  }

  _getStrokeColor() {
    if (this.tool === 'eraser') return 'rgba(0,0,0,1)';
    if (this.tool === 'rainbow') {
      this.hue = (this.hue + this.config.tools.rainbow.hueSpeed) % 360;
      const color = `hsl(${this.hue}, 80%, 55%)`;
      if (this._lastStrokeColor !== color) {
        this._strokeStyleCache = color;
        this._lastStrokeColor = color;
      }
      return this._strokeStyleCache;
    }
    if (this._lastStrokeColor !== this.color) {
      this._strokeStyleCache = this.color;
      this._lastStrokeColor = this.color;
    }
    return this._strokeStyleCache;
  }

  _drawDot(pos) {
    const strokeColor = this._getStrokeColor();
    this.ctx.save();
    if (this.tool === 'eraser') this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.fillStyle = strokeColor;
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, Math.max(0.5, this.brushSize / 2), 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
    if (this.mirrorMode > 0) this._drawDotMirrored(pos, strokeColor);
  }

  _drawSmoothSegment(sx, sy, cpx, cpy, ex, ey) {
    const strokeColor = this._getStrokeColor();
    this.ctx.save();
    if (this.tool === 'eraser') this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.beginPath();
    this.ctx.moveTo(sx, sy);
    this.ctx.quadraticCurveTo(cpx, cpy, ex, ey);
    this.ctx.stroke();
    this.ctx.restore();
    if (this.mirrorMode > 0) this._drawSmoothMirrored(sx, sy, cpx, cpy, ex, ey, strokeColor);
  }

  _drawLineSeg(x1, y1, x2, y2) {
    const strokeColor = this._getStrokeColor();
    this.ctx.save();
    if (this.tool === 'eraser') this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
    this.ctx.restore();
    if (this.mirrorMode > 0) this._drawLineMirrored(x1, y1, x2, y2, strokeColor);
  }

  _getMirroredPoints(x, y) {
    const cacheKey = `${x},${y}`;
    if (this._mirroredPointsCache.has(cacheKey)) {
      return this._mirroredPointsCache.get(cacheKey);
    }
    const cx = this.width / 2;
    const cy = this.height / 2;
    const pts = [];
    if (this.mirrorMode === 2 || this.mirrorMode === 8) pts.push({ x: this.width - x, y });
    if (this.mirrorMode === 4 || this.mirrorMode === 8) {
      pts.push({ x, y: this.height - y });
      pts.push({ x: this.width - x, y: this.height - y });
    }
    if (this.mirrorMode === 8) {
      const dx = x - cx, dy = y - cy;
      pts.push({ x: cx + dy, y: cy + dx });
      pts.push({ x: cx - dy, y: cy + dx });
      pts.push({ x: cx + dy, y: cy - dx });
      pts.push({ x: cx - dy, y: cy - dx });
    }
    this._mirroredPointsCache.set(cacheKey, pts);
    if (this._mirroredPointsCache.size > 500) {
      const firstKey = this._mirroredPointsCache.keys().next().value;
      this._mirroredPointsCache.delete(firstKey);
    }
    return pts;
  }

  _drawDotMirrored(pos, strokeColor) {
    this.ctx.save();
    if (this.tool === 'eraser') this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.fillStyle = strokeColor;
    for (const m of this._getMirroredPoints(pos.x, pos.y)) {
      this.ctx.beginPath();
      this.ctx.arc(m.x, m.y, Math.max(0.5, this.brushSize / 2), 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  _drawSmoothMirrored(sx, sy, cpx, cpy, ex, ey, strokeColor) {
    const endM = this._getMirroredPoints(ex, ey);
    const cpM = this._getMirroredPoints(cpx, cpy);
    const stM = this._getMirroredPoints(sx, sy);
    this.ctx.save();
    if (this.tool === 'eraser') this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = this.brushSize;
    for (let i = 0; i < endM.length; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(stM[i].x, stM[i].y);
      this.ctx.quadraticCurveTo(cpM[i].x, cpM[i].y, endM[i].x, endM[i].y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  _drawLineMirrored(x1, y1, x2, y2, strokeColor) {
    const endM = this._getMirroredPoints(x2, y2);
    const stM = this._getMirroredPoints(x1, y1);
    this.ctx.save();
    if (this.tool === 'eraser') this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = this.brushSize;
    for (let i = 0; i < endM.length; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(stM[i].x, stM[i].y);
      this.ctx.lineTo(endM[i].x, endM[i].y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  _startSpray(pos) {
    this.sprayActive = true;
    this._sprayAt(pos);
    const tick = () => {
      if (!this.sprayActive) return;
      if (this.isDrawing) this._sprayAt({ x: this.lastX, y: this.lastY });
      this.sprayRAF = requestAnimationFrame(tick);
    };
    this.sprayRAF = requestAnimationFrame(tick);
  }

  _stopSpray() {
    this.sprayActive = false;
    if (this.sprayRAF) {
      cancelAnimationFrame(this.sprayRAF);
      this.sprayRAF = null;
    }
  }

  _sprayAt(pos) {
    const density = this.config.tools.spray.density;
    const radius = this.brushSize;
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = this.color;
    for (let i = 0; i < density; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      this.ctx.beginPath();
      this.ctx.arc(pos.x + Math.cos(angle) * dist, pos.y + Math.sin(angle) * dist, Math.random() * 1.5 + 0.5, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
    if (this.mirrorMode > 0) {
      const mirrored = this._getMirroredPoints(pos.x, pos.y);
      this.ctx.save();
      this.ctx.fillStyle = this.color;
      for (const m of mirrored) {
        for (let i = 0; i < density; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * radius;
          this.ctx.beginPath();
          this.ctx.arc(m.x + Math.cos(angle) * dist, m.y + Math.sin(angle) * dist, Math.random() * 1.5 + 0.5, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
      this.ctx.restore();
    }
  }
}