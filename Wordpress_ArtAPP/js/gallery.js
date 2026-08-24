export class Gallery {
  constructor(config) {
    this.config = config;
    this.panelEl = null;
    this.gridEl = null;
    this.overlayEl = null;
    this.items = [];
    this.onLoadImage = null;
    this._createDOM();
  }

  _createDOM() {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'gallery-overlay';
    document.body.appendChild(this.overlayEl);

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'gallery-panel';
    this.panelEl.setAttribute('role', 'dialog');
    this.panelEl.setAttribute('aria-modal', 'true');
    this.panelEl.setAttribute('aria-label', 'Galerie');

    const header = document.createElement('div');
    header.className = 'gallery-header';

    const title = document.createElement('h2');
    title.textContent = '🖼️ Meine Galerie';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gallery-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Galerie schliessen');
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(title);
    header.appendChild(closeBtn);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'gallery-grid';

    this.panelEl.appendChild(header);
    this.panelEl.appendChild(this.gridEl);
    document.body.appendChild(this.panelEl);

    this.overlayEl.addEventListener('click', () => this.close());
  }

  async refresh() {
    try {
      const resp = await fetch(this.config.gallery.endpoint);
      if (!resp.ok) { this._showEmpty('Galerie konnte nicht geladen werden.'); return; }
      this.items = await resp.json();
      this._renderGrid();
    } catch (err) {
      this.items = [];
      this._showEmpty('Noch keine Kunstwerke gespeichert.');
    }
  }

  _renderGrid() {
    this.gridEl.innerHTML = '';
    if (this.items.length === 0) { this._showEmpty('Noch keine Kunstwerke gespeichert.'); return; }
    for (const item of this.items) {
      this.gridEl.appendChild(this._createItemCard(item));
    }
  }

  _showEmpty(msg) {
    this.gridEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'gallery-empty';
    p.textContent = msg;
    this.gridEl.appendChild(p);
  }

  _createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'gallery-item';
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Kunstwerk vom ${item.date || 'unbekannt'}`);

    const img = document.createElement('img');
    img.src = item.thumbnail || item.url;
    img.alt = `Kunstwerk vom ${item.date || 'unbekannt'}`;
    img.loading = 'lazy';

    const dateEl = document.createElement('p');
    dateEl.className = 'gallery-item-date';
    dateEl.textContent = item.date || '';

    const actionsEl = document.createElement('div');
    actionsEl.className = 'gallery-item-actions';

    const loadBtn = document.createElement('button');
    loadBtn.textContent = '📂 Laden';
    loadBtn.setAttribute('aria-label', 'Kunstwerk laden');
    loadBtn.addEventListener('click', (e) => { e.stopPropagation(); this._loadImage(item.url); });

    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn-download';
    dlBtn.textContent = '💾 Download';
    dlBtn.setAttribute('aria-label', 'Kunstwerk herunterladen');
    dlBtn.addEventListener('click', (e) => { e.stopPropagation(); this._downloadImage(item.url, item.filename || item.name); });

    actionsEl.appendChild(loadBtn);
    actionsEl.appendChild(dlBtn);

    card.appendChild(img);
    card.appendChild(dateEl);
    card.appendChild(actionsEl);

    card.addEventListener('click', () => this._loadImage(item.url));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._loadImage(item.url); }
    });
    return card;
  }

  async _loadImage(url) {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (this.onLoadImage) this.onLoadImage(dataUrl);
      this.close();
    } catch (err) {
      console.error('Bild konnte nicht geladen werden:', err);
    }
  }

  _downloadImage(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'kunstwerk.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  open() {
    this.panelEl.classList.add('open');
    this.overlayEl.classList.add('visible');
    this.refresh();
  }

  close() {
    this.panelEl.classList.remove('open');
    this.overlayEl.classList.remove('visible');
  }

  isOpen() {
    return this.panelEl.classList.contains('open');
  }
}