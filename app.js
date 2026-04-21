/* =============================================================
   app.js  –  Windows-like File Explorer
   =============================================================
   Structure:
     1. VFS         – virtual filesystem (localStorage-backed)
     2. FT          – file-type helpers (icons, labels, sizes)
     3. Explorer    – UI controller
   ============================================================= */

'use strict';

/* =============================================================
   1. VFS  –  Virtual Filesystem
   ============================================================= */
class VFS {
  constructor() {
    this.tree = this._load() || this._defaultTree();
    this._save();
  }

  /* ---------- default initial structure -------------------- */
  _defaultTree() {
    const now = new Date().toISOString();
    const folder = (name, children = []) => ({
      id: this._uid(), name, type: 'folder', children, created: now, modified: now,
    });
    return {
      id: 'root', name: 'This PC', type: 'folder',
      children: [
        folder('Desktop'),
        folder('Documents'),
        folder('Downloads'),
        folder('Music'),
        folder('Pictures'),
        folder('Videos'),
      ],
      created: now, modified: now,
    };
  }

  /* ---------- persistence ---------------------------------- */
  _load() {
    try { const s = localStorage.getItem('vfs_tree'); return s ? JSON.parse(s) : null; }
    catch (_) { return null; }
  }
  _save() {
    try { localStorage.setItem('vfs_tree', JSON.stringify(this.tree)); }
    catch (e) { console.warn('VFS save failed:', e); }
  }

  /* ---------- id generator --------------------------------- */
  _uid() {
    return 'n' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  }

  /* ---------- tree traversal helpers ----------------------- */
  get(id) {
    if (id === 'root') return this.tree;
    return this._find(this.tree, id);
  }
  _find(node, id) {
    if (node.id === id) return node;
    if (node.children) for (const c of node.children) { const r = this._find(c, id); if (r) return r; }
    return null;
  }
  parent(id) { return this._findParent(this.tree, id); }
  _findParent(node, id) {
    if (!node.children) return null;
    for (const c of node.children) {
      if (c.id === id) return node;
      const r = this._findParent(c, id);
      if (r) return r;
    }
    return null;
  }
  /** Returns true if `descendantId` is nested inside node `ancestorId` */
  isAncestorOf(ancestorId, descendantId) {
    const anc = this.get(ancestorId);
    if (!anc) return false;
    return !!this._find(anc, descendantId);
  }

  /* ---------- path ----------------------------------------- */
  pathTo(id) {
    const path = [];
    this._buildPath(this.tree, id, path);
    return path;                    // [{id, name}, …] root-first
  }
  _buildPath(node, id, path) {
    if (node.id === id) { path.push({ id: node.id, name: node.name }); return true; }
    if (node.children) for (const c of node.children) {
      if (this._buildPath(c, id, path)) { path.unshift({ id: node.id, name: node.name }); return true; }
    }
    return false;
  }

  /* ---------- CRUD ----------------------------------------- */
  list(folderId) {
    const n = this.get(folderId);
    return (n && n.children) ? n.children : [];
  }

  mkdir(parentId, name) {
    const now = new Date().toISOString();
    const item = { id: this._uid(), name: this._uniq(parentId, name), type: 'folder', children: [], created: now, modified: now };
    const p = this.get(parentId);
    p.children.push(item); p.modified = now; this._save();
    return item;
  }

  addFile(parentId, name, mimeType, size) {
    const now = new Date().toISOString();
    const item = { id: this._uid(), name: this._uniq(parentId, name), type: 'file', mimeType, size, created: now, modified: now };
    const p = this.get(parentId);
    p.children.push(item); p.modified = now; this._save();
    return item;
  }

  rename(id, newName) {
    const node = this.get(id); if (!node) return false;
    const p = this.parent(id);
    node.name = this._uniq(p ? p.id : 'root', newName.trim(), id);
    node.modified = new Date().toISOString(); this._save();
    return node.name;
  }

  delete(id) {
    /* also wipe stored file data for this subtree */
    const node = this.get(id);
    if (node) this._collectIds(node).forEach(i => this._delData(i));
    const p = this.parent(id); if (!p) return false;
    p.children = p.children.filter(c => c.id !== id);
    p.modified = new Date().toISOString(); this._save();
    return true;
  }
  _collectIds(node) {
    const ids = [node.id];
    if (node.children) node.children.forEach(c => ids.push(...this._collectIds(c)));
    return ids;
  }

  move(id, newParentId) {
    if (id === newParentId) return false;
    if (this.isAncestorOf(id, newParentId)) return false; // circular guard
    const node = this.get(id), newP = this.get(newParentId);
    if (!node || !newP || newP.type !== 'folder') return false;
    const oldP = this.parent(id); if (!oldP) return false;
    const now = new Date().toISOString();
    oldP.children = oldP.children.filter(c => c.id !== id); oldP.modified = now;
    node.name = this._uniq(newParentId, node.name);
    newP.children.push(node); newP.modified = now;
    this._save(); return true;
  }

  clone(id) {
    const node = this.get(id); if (!node) return null;
    const c = JSON.parse(JSON.stringify(node));
    this._reId(c); return c;
  }
  _reId(node) {
    const old = node.id; node.id = this._uid();
    const data = this._getData(old); if (data) this._setData(node.id, data);
    if (node.children) node.children.forEach(c => this._reId(c));
  }

  paste(parentId, cloneNode) {
    const p = this.get(parentId); if (!p || p.type !== 'folder') return false;
    const now = new Date().toISOString();
    cloneNode.name = this._uniq(parentId, cloneNode.name);
    cloneNode.created = now; cloneNode.modified = now;
    p.children.push(cloneNode); p.modified = now; this._save();
    return true;
  }

  /* ---------- file data (base64) --------------------------- */
  setData(id, dataUrl) {
    try { localStorage.setItem('vfs_d_' + id, dataUrl); return true; }
    catch (e) { console.warn('File data quota exceeded:', e); return false; }
  }
  getData(id) { return localStorage.getItem('vfs_d_' + id) || null; }
  _setData(id, d) { this.setData(id, d); }
  _getData(id)    { return this.getData(id); }
  _delData(id)    { localStorage.removeItem('vfs_d_' + id); }

  /* ---------- unique name helper --------------------------- */
  _uniq(folderId, name, excludeId = null) {
    const folder = this.get(folderId);
    if (!folder || !folder.children) return name;
    const taken = folder.children.filter(c => c.id !== excludeId).map(c => c.name);
    if (!taken.includes(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext  = dot > 0 ? name.slice(dot) : '';
    let i = 2;
    while (taken.includes(`${base} (${i})${ext}`)) i++;
    return `${base} (${i})${ext}`;
  }

  hasFolderChildren(id) {
    const n = this.get(id);
    return !!(n && n.children && n.children.some(c => c.type === 'folder'));
  }
}


/* =============================================================
   2. FT  –  File-type helpers
   ============================================================= */
const FT = {
  EXT: {
    jpg:'image', jpeg:'image', png:'image', gif:'image',
    webp:'image', svg:'image', bmp:'image', ico:'image', avif:'image',
    mp4:'video', avi:'video', mov:'video', wmv:'video', mkv:'video', webm:'video', flv:'video',
    mp3:'audio', wav:'audio', ogg:'audio', flac:'audio', aac:'audio', m4a:'audio',
    pdf:'pdf',
    doc:'word', docx:'word',
    xls:'excel', xlsx:'excel', csv:'excel',
    ppt:'ppt', pptx:'ppt',
    zip:'zip', rar:'zip', '7z':'zip', tar:'zip', gz:'zip', bz2:'zip',
    js:'code', ts:'code', html:'code', css:'code', py:'code', java:'code',
    cpp:'code', c:'code', json:'code', xml:'code', php:'code', rb:'code',
    go:'code', rs:'code', sh:'code', bat:'code',
    txt:'text', md:'text', rtf:'text', log:'text', ini:'text', cfg:'text',
    exe:'exe', msi:'exe', dmg:'exe', app:'exe',
  },
  ICONS: {
    folder:'📁', image:'🖼️', video:'🎬', audio:'🎵', pdf:'📕',
    word:'📝', excel:'📊', ppt:'📊', zip:'🗜️', code:'💻',
    text:'📄', exe:'⚙️', unknown:'📄',
  },
  LABELS: {
    folder:'File folder', image:'Image file', video:'Video file', audio:'Audio file',
    pdf:'PDF Document', word:'Word Document', excel:'Spreadsheet',
    ppt:'Presentation', zip:'Compressed archive', code:'Source code',
    text:'Text file', exe:'Application', unknown:'File',
  },

  cat(name) {
    if (!name) return 'unknown';
    const ext = name.split('.').pop().toLowerCase();
    return this.EXT[ext] || 'unknown';
  },
  icon(name, nodeType) {
    if (nodeType === 'folder') return this.ICONS.folder;
    return this.ICONS[this.cat(name)] || this.ICONS.unknown;
  },
  label(node) {
    if (node.type === 'folder') return this.LABELS.folder;
    return this.LABELS[this.cat(node.name)] || this.LABELS.unknown;
  },
  isImage(name, mime) {
    return (mime && mime.startsWith('image/')) || this.cat(name) === 'image';
  },
  fmtSize(b) {
    if (b == null) return '';
    if (b === 0) return '0 B';
    const u = ['B','KB','MB','GB','TB'];
    const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
    return (b / 1024 ** i).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
  },
  fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  },
};


/* =============================================================
   3. Explorer  –  UI controller
   ============================================================= */
class Explorer {
  constructor() {
    this.vfs        = new VFS();
    this.currentId  = 'root';
    this.history    = ['root'];
    this.histIdx    = 0;
    this.viewMode   = 'details';    // 'details' | 'thumbs'
    this.clipboard  = null;         // { action:'copy'|'cut', id, node }
    this.selectedId = null;
    this.dragSrcId  = null;
    this.ctxTargetId= null;         // item right-clicked (null = bg)
    this.sortBy     = 'name';       // 'name'|'date'|'type'|'size'
    this.sortAsc    = true;
    this.searchQ    = '';
    this._treeExpanded = new Set(['root']);

    this._init();
  }

  /* ============================================================
     Init
     ============================================================ */
  _init() {
    /* cache DOM refs */
    this.$fileList    = document.getElementById('fileList');
    this.$addrBar     = document.getElementById('addrBar');
    this.$sbTree      = document.getElementById('sidebarTree');
    this.$sbPC        = document.getElementById('sidebarThisPC');
    this.$statusBar   = document.getElementById('statusBar');
    this.$ctxMenu     = document.getElementById('ctxMenu');
    this.$propsBack   = document.getElementById('propsBackdrop');
    this.$dropOver    = document.getElementById('dropOverlay');
    this.$winTitle    = document.getElementById('windowTitle');
    this.$btnBack     = document.getElementById('btnBack');
    this.$btnFwd      = document.getElementById('btnForward');
    this.$btnUp       = document.getElementById('btnUp');
    this.$searchInp   = document.getElementById('searchInput');
    this.$fileInput   = document.getElementById('fileInput');

    this._bindEvents();
    this._renderSidebar();
    this._renderContent();
  }

  /* ============================================================
     Events
     ============================================================ */
  _bindEvents() {
    /* nav buttons */
    this.$btnBack.addEventListener('click', () => this._navBack());
    this.$btnFwd .addEventListener('click', () => this._navFwd());
    this.$btnUp  .addEventListener('click', () => this._navUp());

    /* view toggles */
    document.getElementById('btnDetails').addEventListener('click', () => this._setView('details'));
    document.getElementById('btnThumbs') .addEventListener('click', () => this._setView('thumbs'));

    /* new folder / upload */
    document.getElementById('btnNewFolder').addEventListener('click', () => this._newFolder());
    document.getElementById('btnUpload')   .addEventListener('click', () => this.$fileInput.click());
    this.$fileInput.addEventListener('change', e => this._handleFileInput(e));

    /* search */
    this.$searchInp.addEventListener('input', e => {
      this.searchQ = e.target.value.trim().toLowerCase();
      this._renderContent();
    });

    /* global click – close context menu */
    document.addEventListener('click', e => {
      if (!this.$ctxMenu.contains(e.target)) this._hideCtx();
    });

    /* context menu actions */
    this.$ctxMenu.addEventListener('click', e => {
      const item = e.target.closest('[data-action]');
      if (item) this._ctxAction(item.dataset.action);
    });

    /* keyboard shortcuts */
    document.addEventListener('keydown', e => this._onKey(e));

    /* content panel drag-and-drop (file upload from OS) */
    const panel = document.getElementById('contentPanel');
    panel.addEventListener('dragover',  e => { e.preventDefault(); this.$dropOver.classList.add('active'); });
    panel.addEventListener('dragleave', e => { if (!panel.contains(e.relatedTarget)) this.$dropOver.classList.remove('active'); });
    panel.addEventListener('drop',      e => { e.preventDefault(); this.$dropOver.classList.remove('active'); this._handleDrop(e); });

    /* properties modal */
    document.getElementById('propsClose') .addEventListener('click', () => this._hideProps());
    document.getElementById('propsCancel').addEventListener('click', () => this._hideProps());
    document.getElementById('propsOK')    .addEventListener('click', () => this._propsOK());

    /* sidebar resizer */
    this._bindResizer();

    /* sort columns (details header – delegated via _renderContent) */
    this.$fileList.addEventListener('click', e => {
      const col = e.target.closest('[data-sort]');
      if (col) { this._toggleSort(col.dataset.sort); return; }
    });
  }

  /* ---- sidebar resizer ------------------------------------ */
  _bindResizer() {
    const resizer = document.getElementById('sbResizer');
    const sidebar = document.getElementById('sidebar');
    let startX, startW;
    resizer.addEventListener('mousedown', e => {
      startX = e.clientX; startW = sidebar.getBoundingClientRect().width;
      resizer.classList.add('active');
      const onMove = mv => { sidebar.style.width = Math.max(140, Math.min(450, startW + mv.clientX - startX)) + 'px'; };
      const onUp   = ()  => { resizer.classList.remove('active'); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ============================================================
     Keyboard shortcuts
     ============================================================ */
  _onKey(e) {
    const tag = document.activeElement.tagName.toLowerCase();
    if (tag === 'input') return;  // typing in an input — ignore

    if (e.key === 'F2' && this.selectedId) { e.preventDefault(); this._startRename(this.selectedId); return; }
    if (e.key === 'Delete' && this.selectedId) { e.preventDefault(); this._deleteItem(this.selectedId); return; }
    if (e.key === 'Backspace') { e.preventDefault(); this._navUp(); return; }
    if (e.key === 'Enter' && this.selectedId) { e.preventDefault(); this._openItem(this.selectedId); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && this.selectedId) { e.preventDefault(); this._copy(this.selectedId); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'x' && this.selectedId) { e.preventDefault(); this._cut(this.selectedId);  return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); this._paste(); return; }
  }

  /* ============================================================
     Navigation
     ============================================================ */
  _navigate(id, pushHistory = true) {
    const node = this.vfs.get(id);
    if (!node || node.type !== 'folder') return;
    this.currentId  = id;
    this.selectedId = null;
    if (pushHistory) {
      this.history = this.history.slice(0, this.histIdx + 1);
      this.history.push(id);
      this.histIdx = this.history.length - 1;
    }
    this._renderContent();
    this._renderSidebar();
    this._updateNavButtons();
  }

  _navBack() {
    if (this.histIdx > 0) { this.histIdx--; this._navigate(this.history[this.histIdx], false); }
  }
  _navFwd() {
    if (this.histIdx < this.history.length - 1) { this.histIdx++; this._navigate(this.history[this.histIdx], false); }
  }
  _navUp() {
    const p = this.vfs.parent(this.currentId);
    if (p) this._navigate(p.id);
  }
  _updateNavButtons() {
    this.$btnBack.disabled = this.histIdx <= 0;
    this.$btnFwd .disabled = this.histIdx >= this.history.length - 1;
    this.$btnUp  .disabled = !this.vfs.parent(this.currentId);
  }

  /* ============================================================
     Address bar
     ============================================================ */
  _renderAddrBar() {
    const path = this.vfs.pathTo(this.currentId);
    this.$addrBar.innerHTML = '';
    path.forEach((seg, i) => {
      const span = document.createElement('span');
      span.className = 'addr-part';
      span.textContent = seg.name;
      span.addEventListener('click', () => this._navigate(seg.id));
      this.$addrBar.appendChild(span);
      if (i < path.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'addr-sep'; sep.textContent = '›';
        this.$addrBar.appendChild(sep);
      }
    });
    const cur = this.vfs.get(this.currentId);
    this.$winTitle.textContent = (cur ? cur.name : 'File Explorer') + ' – File Explorer';
  }

  /* ============================================================
     Sidebar
     ============================================================ */
  _renderSidebar() {
    /* Quick access = root children that are folders */
    const rootChildren = this.vfs.list('root').filter(c => c.type === 'folder');
    this.$sbTree.innerHTML = '';
    rootChildren.forEach(n => this.$sbTree.appendChild(this._makeTreeRow(n, 8)));

    /* This PC = same list */
    this.$sbPC.innerHTML = '';
    rootChildren.forEach(n => this.$sbPC.appendChild(this._makeTreeRow(n, 8)));
  }

  _makeTreeRow(node, indent, level = 0) {
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.className = 'tree-row' + (node.id === this.currentId ? ' selected' : '');
    row.style.paddingLeft = indent + 'px';

    /* expand toggle */
    const tog = document.createElement('span');
    tog.className = 'tree-toggle' + (this._treeExpanded.has(node.id) ? ' open' : '');
    tog.textContent = this.vfs.hasFolderChildren(node.id) ? '▶' : '';

    const icon  = document.createElement('span'); icon.className = 'tree-icon'; icon.textContent = '📁';
    const label = document.createElement('span'); label.className = 'tree-label'; label.textContent = node.name;

    row.appendChild(tog); row.appendChild(icon); row.appendChild(label);
    wrap.appendChild(row);

    /* children container */
    const childWrap = document.createElement('div');
    childWrap.className = 'tree-children' + (this._treeExpanded.has(node.id) ? ' open' : '');

    /* lazy-render children when needed */
    const renderChildren = () => {
      childWrap.innerHTML = '';
      this.vfs.list(node.id).filter(c => c.type === 'folder')
        .forEach(c => childWrap.appendChild(this._makeTreeRow(c, indent + 16, level + 1)));
    };
    if (this._treeExpanded.has(node.id)) renderChildren();
    wrap.appendChild(childWrap);

    /* toggle expand */
    tog.addEventListener('click', e => {
      e.stopPropagation();
      if (this._treeExpanded.has(node.id)) this._treeExpanded.delete(node.id);
      else { this._treeExpanded.add(node.id); renderChildren(); }
      tog.classList.toggle('open', this._treeExpanded.has(node.id));
      childWrap.classList.toggle('open', this._treeExpanded.has(node.id));
    });

    /* navigate on row click */
    row.addEventListener('click', e => {
      e.stopPropagation();
      this._navigate(node.id);
    });

    /* drag target – sidebar items accept drops */
    row.addEventListener('dragover',  e => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop',      e => {
      e.preventDefault(); row.classList.remove('drag-over');
      if (this.dragSrcId && this.dragSrcId !== node.id) {
        if (this.vfs.move(this.dragSrcId, node.id)) {
          this.dragSrcId = null; this._renderContent(); this._renderSidebar();
        }
      }
    });

    return wrap;
  }

  /* ============================================================
     Content rendering
     ============================================================ */
  _setView(mode) {
    this.viewMode = mode;
    document.getElementById('btnDetails').classList.toggle('active', mode === 'details');
    document.getElementById('btnThumbs') .classList.toggle('active', mode === 'thumbs');
    this._renderContent();
  }

  _toggleSort(field) {
    if (this.sortBy === field) this.sortAsc = !this.sortAsc;
    else { this.sortBy = field; this.sortAsc = true; }
    this._renderContent();
  }

  _sortedItems(items) {
    const q = this.searchQ;
    let list = q ? items.filter(i => i.name.toLowerCase().includes(q)) : [...items];
    list.sort((a, b) => {
      /* folders first */
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      let va, vb;
      switch (this.sortBy) {
        case 'date': va = a.modified; vb = b.modified; break;
        case 'type': va = FT.label(a); vb = FT.label(b); break;
        case 'size': va = a.size || 0; vb = b.size || 0; break;
        default:     va = a.name.toLowerCase(); vb = b.name.toLowerCase();
      }
      if (va < vb) return this.sortAsc ? -1 : 1;
      if (va > vb) return this.sortAsc ?  1 : -1;
      return 0;
    });
    return list;
  }

  _renderContent() {
    this._renderAddrBar();
    this._updateNavButtons();

    const fl = this.$fileList;
    fl.innerHTML = '';

    const allItems = this.vfs.list(this.currentId);
    const items = this._sortedItems(allItems);

    /* empty state */
    if (items.length === 0 && !this.searchQ) {
      const es = document.createElement('div'); es.className = 'empty-state';
      es.innerHTML = '<span class="empty-state-icon">📂</span><div class="empty-state-txt">This folder is empty</div>';
      fl.appendChild(es);
    }

    if (this.viewMode === 'details') {
      fl.classList.remove('thumbs-mode');
      this._renderDetails(fl, items);
    } else {
      fl.classList.add('thumbs-mode');
      items.forEach(node => fl.appendChild(this._makeThumbnailItem(node)));
    }

    /* background context menu + deselect */
    fl.oncontextmenu = e => {
      if (e.target === fl || e.target.classList.contains('det-hdr') || e.target.closest('.det-hdr')) {
        e.preventDefault(); this.ctxTargetId = null; this._showCtx(e, false);
      }
    };
    fl.onclick = e => {
      if (e.target === fl || e.target.classList.contains('det-hdr')) {
        this.selectedId = null; this._highlightSelected();
      }
    };

    this._updateStatus(allItems.length);
  }

  /* ---- details view --------------------------------------- */
  _renderDetails(fl, items) {
    const hdr = document.createElement('div'); hdr.className = 'det-hdr';
    const mk = (txt, sort) => { const s = document.createElement('span'); s.textContent = txt; if (sort) s.dataset.sort = sort; return s; };
    hdr.appendChild(mk('Name', 'name'));
    hdr.appendChild(mk('Date modified', 'date'));
    hdr.appendChild(mk('Type', 'type'));
    hdr.appendChild(mk('Size', 'size'));
    fl.appendChild(hdr);
    items.forEach(node => fl.appendChild(this._makeDetailItem(node)));
  }

  _makeDetailItem(node) {
    const row = document.createElement('div');
    row.className = 'fi' + (node.id === this.selectedId ? ' selected' : '') + (this._isCut(node.id) ? ' cut' : '');
    row.dataset.id = node.id;
    row.draggable = true;

    /* name cell */
    const nameCell = document.createElement('div'); nameCell.className = 'fi-name-cell';
    nameCell.appendChild(this._makeIcon(node, false));
    const nameSpan = document.createElement('span'); nameSpan.className = 'fi-name'; nameSpan.textContent = node.name;
    nameCell.appendChild(nameSpan);

    const dateSpan = document.createElement('div'); dateSpan.className = 'fi-date'; dateSpan.textContent = FT.fmtDate(node.modified);
    const typeSpan = document.createElement('div'); typeSpan.className = 'fi-type'; typeSpan.textContent = FT.label(node);
    const sizeSpan = document.createElement('div'); sizeSpan.className = 'fi-size'; sizeSpan.textContent = node.type === 'file' ? FT.fmtSize(node.size) : '';

    row.appendChild(nameCell); row.appendChild(dateSpan); row.appendChild(typeSpan); row.appendChild(sizeSpan);

    this._attachItemEvents(row, node);
    return row;
  }

  /* ---- thumbnails view ------------------------------------ */
  _makeThumbnailItem(node) {
    const tile = document.createElement('div');
    tile.className = 'fi-thumb' + (node.id === this.selectedId ? ' selected' : '') + (this._isCut(node.id) ? ' cut' : '');
    tile.dataset.id = node.id;
    tile.draggable = true;

    const iconWrap = document.createElement('div'); iconWrap.className = 'fi-thumb-icon';
    iconWrap.appendChild(this._makeIcon(node, true));

    const nameDv = document.createElement('div'); nameDv.className = 'fi-thumb-name'; nameDv.textContent = node.name;

    tile.appendChild(iconWrap); tile.appendChild(nameDv);
    this._attachItemEvents(tile, node);
    return tile;
  }

  /* ---- icon helper ---------------------------------------- */
  _makeIcon(node, large) {
    if (node.type === 'file' && FT.isImage(node.name, node.mimeType)) {
      const data = this.vfs.getData(node.id);
      if (data) {
        const img = document.createElement('img');
        img.src = data; img.alt = node.name;
        if (!large) img.style.cssText = 'width:16px;height:16px;object-fit:cover;border-radius:2px;';
        else         img.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:4px;border:1px solid #ddd;';
        const wrap = document.createElement('span');
        wrap.className = large ? '' : 'fi-icon';
        wrap.appendChild(img);
        return wrap;
      }
    }
    const span = document.createElement('span');
    span.className = large ? '' : 'fi-icon';
    span.textContent = FT.icon(node.name, node.type);
    return span;
  }

  /* ---- attach click / dblclick / contextmenu / drag ------- */
  _attachItemEvents(el, node) {
    /* select */
    el.addEventListener('click', e => {
      e.stopPropagation();
      this.selectedId = node.id;
      this._highlightSelected();
    });

    /* open */
    el.addEventListener('dblclick', e => { e.stopPropagation(); this._openItem(node.id); });

    /* context menu */
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      this.selectedId = node.id; this._highlightSelected();
      this.ctxTargetId = node.id; this._showCtx(e, true);
    });

    /* drag-and-drop (internal move) */
    el.addEventListener('dragstart', e => {
      this.dragSrcId = node.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
    });
    el.addEventListener('dragend', () => {
      this.dragSrcId = null;
      el.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    });

    if (node.type === 'folder') {
      el.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation(); el.classList.remove('drag-over');
        if (this.dragSrcId && this.dragSrcId !== node.id) {
          if (this.vfs.move(this.dragSrcId, node.id)) {
            this.dragSrcId = null; this._renderContent(); this._renderSidebar();
          }
        } else if (!this.dragSrcId) {
          /* files from OS dropped onto subfolder */
          this._uploadFiles(e.dataTransfer.files, node.id);
        }
      });
    }
  }

  /* ---- highlight ------------------------------------------ */
  _highlightSelected() {
    document.querySelectorAll('[data-id]').forEach(el => {
      const id = el.dataset.id;
      el.classList.toggle('selected', id === this.selectedId);
    });
  }
  _isCut(id) { return this.clipboard && this.clipboard.action === 'cut' && this.clipboard.id === id; }

  /* ---- status bar ----------------------------------------- */
  _updateStatus(total) {
    const sel = this.selectedId ? this.vfs.get(this.selectedId) : null;
    if (sel) this.$statusBar.textContent = `1 item selected  ·  ${FT.fmtSize(sel.size) || FT.label(sel)}`;
    else if (this.searchQ) this.$statusBar.textContent = `Search results in "${this.vfs.get(this.currentId)?.name}"`;
    else this.$statusBar.textContent = `${total} item${total !== 1 ? 's' : ''}`;
  }

  /* ============================================================
     Open item
     ============================================================ */
  _openItem(id) {
    const node = this.vfs.get(id);
    if (!node) return;
    if (node.type === 'folder') { this._navigate(id); return; }
    /* for files: try to open in new tab if we have data */
    const data = this.vfs.getData(id);
    if (data) {
      const a = document.createElement('a'); a.href = data; a.download = node.name; a.click();
    }
  }

  /* ============================================================
     Context menu
     ============================================================ */
  _showCtx(e, hasTarget) {
    const menu = this.$ctxMenu;
    /* toggle items based on context */
    menu.querySelectorAll('[data-action]').forEach(el => {
      const a = el.dataset.action;
      if (a === 'open'   || a === 'cut' || a === 'copy' || a === 'rename' || a === 'delete')
        el.classList.toggle('disabled', !hasTarget);
      if (a === 'paste')
        el.classList.toggle('disabled', !this.clipboard);
    });

    menu.style.display = 'block';
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = e.clientX, y = e.clientY;
    menu.style.left = '0'; menu.style.top = '0';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (x + mw > vw) x = vw - mw - 4;
    if (y + mh > vh) y = vh - mh - 4;
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
  }
  _hideCtx() { this.$ctxMenu.style.display = 'none'; }

  _ctxAction(action) {
    this._hideCtx();
    const id = this.ctxTargetId || this.selectedId;
    switch (action) {
      case 'open':       if (id) this._openItem(id); break;
      case 'cut':        if (id) this._cut(id); break;
      case 'copy':       if (id) this._copy(id); break;
      case 'paste':      this._paste(); break;
      case 'rename':     if (id) this._startRename(id); break;
      case 'delete':     if (id) this._deleteItem(id); break;
      case 'new-folder': this._newFolder(); break;
      case 'properties': this._showProps(id || this.currentId); break;
    }
  }

  /* ============================================================
     Clipboard
     ============================================================ */
  _copy(id) {
    this.clipboard = { action: 'copy', id };
    this._highlightSelected();
    this._updateStatus(this.vfs.list(this.currentId).length);
  }
  _cut(id) {
    this.clipboard = { action: 'cut', id };
    this._highlightSelected();
    /* show cut style */
    document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.classList.add('cut'));
  }
  _paste() {
    if (!this.clipboard) return;
    const { action, id } = this.clipboard;
    if (action === 'cut') {
      if (this.vfs.move(id, this.currentId)) {
        this.clipboard = null;
      }
    } else {
      /* Always clone fresh from the original so each paste gets unique IDs
         and correct file-data copies regardless of how many times we paste. */
      const fresh = this.vfs.clone(id);
      if (fresh) this.vfs.paste(this.currentId, fresh);
    }
    this._renderContent(); this._renderSidebar();
  }

  /* ============================================================
     New Folder
     ============================================================ */
  _newFolder() {
    const folder = this.vfs.mkdir(this.currentId, 'New Folder');
    this._renderContent(); this._renderSidebar();
    /* auto-start rename */
    requestAnimationFrame(() => this._startRename(folder.id));
  }

  /* ============================================================
     Rename (inline)
     ============================================================ */
  _startRename(id) {
    const node = this.vfs.get(id); if (!node) return;
    const el = document.querySelector(`[data-id="${id}"]`);
    if (!el) return;

    /* find name span inside the element */
    const nameSpan = el.querySelector('.fi-name, .fi-thumb-name');
    if (!nameSpan) return;

    const origName = node.name;
    const inp = document.createElement('input');
    inp.className = 'rename-inp';
    inp.value = origName;
    inp.style.width = Math.max(80, nameSpan.offsetWidth) + 'px';

    nameSpan.replaceWith(inp);
    inp.focus();
    /* select name without extension */
    const dot = origName.lastIndexOf('.');
    inp.setSelectionRange(0, dot > 0 ? dot : origName.length);

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const newName = inp.value.trim();
      if (newName && newName !== origName) {
        const finalName = this.vfs.rename(id, newName);
        nameSpan.textContent = finalName || newName;
      } else {
        nameSpan.textContent = origName;
      }
      if (inp.parentNode) inp.replaceWith(nameSpan);
      this._renderContent(); this._renderSidebar();
    };

    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); inp.removeEventListener('blur', commit); commit(); }
      if (e.key === 'Escape') { inp.value = origName; inp.removeEventListener('blur', commit); commit(); }
    });
  }

  /* ============================================================
     Delete
     ============================================================ */
  _deleteItem(id) {
    const node = this.vfs.get(id); if (!node) return;
    if (!confirm(`Delete "${node.name}"?`)) return;
    if (this.clipboard && this.clipboard.id === id) this.clipboard = null;
    this.vfs.delete(id);
    this.selectedId = null;
    this._renderContent(); this._renderSidebar();
  }

  /* ============================================================
     File upload
     ============================================================ */
  _handleFileInput(e) {
    this._uploadFiles(e.target.files, this.currentId);
    e.target.value = '';   // reset so the same file can be re-uploaded
  }

  _handleDrop(e) {
    /* internal move already handled by item drag-drop */
    if (this.dragSrcId) return;
    const files = e.dataTransfer.files;
    if (files.length) { this._uploadFiles(files, this.currentId); return; }
    /* handle folders drag from browser (items API) – best-effort */
    if (e.dataTransfer.items) {
      [...e.dataTransfer.items].forEach(item => {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry && entry.isDirectory) { this._importDirectory(entry, this.currentId); }
      });
    }
  }

  _uploadFiles(fileList, parentId) {
    if (!fileList || !fileList.length) return;
    let processed = 0;
    const total = fileList.length;
    [...fileList].forEach(file => {
      const item = this.vfs.addFile(parentId, file.name, file.type || 'application/octet-stream', file.size);
      const reader = new FileReader();
      reader.onload = ev => {
        this.vfs.setData(item.id, ev.target.result);
        processed++;
        if (processed === total) { this._renderContent(); this._renderSidebar(); }
      };
      reader.onerror = () => { processed++; if (processed === total) { this._renderContent(); this._renderSidebar(); } };
      reader.readAsDataURL(file);
    });
  }

  _importDirectory(entry, parentId) {
    const folder = this.vfs.mkdir(parentId, entry.name);
    const reader = entry.createReader();
    reader.readEntries(entries => {
      entries.forEach(e => {
        if (e.isFile) {
          e.file(f => this._uploadFiles([f], folder.id));
        } else if (e.isDirectory) {
          this._importDirectory(e, folder.id);
        }
      });
      this._renderContent(); this._renderSidebar();
    });
  }

  /* ============================================================
     Properties modal
     ============================================================ */
  _showProps(id) {
    const node = this.vfs.get(id); if (!node) return;
    this._propsId = id;

    document.getElementById('propsTitleText').textContent = node.name + ' Properties';
    document.getElementById('propsNameInp').value = node.name;

    /* icon */
    const iconEl = document.getElementById('propsIconBig');
    iconEl.innerHTML = '';
    if (node.type === 'file' && FT.isImage(node.name, node.mimeType)) {
      const data = this.vfs.getData(id);
      if (data) {
        const img = document.createElement('img'); img.src = data;
        img.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:4px;';
        iconEl.appendChild(img);
      } else { iconEl.textContent = FT.icon(node.name, node.type); }
    } else { iconEl.textContent = FT.icon(node.name, node.type); }

    document.getElementById('propsType')    .textContent = FT.label(node);
    document.getElementById('propsLoc')     .textContent = this.vfs.pathTo(id).slice(0, -1).map(p => p.name).join(' › ') || 'Root';
    document.getElementById('propsSize')    .textContent = node.type === 'file' ? FT.fmtSize(node.size) : '—';
    document.getElementById('propsCreated') .textContent = FT.fmtDate(node.created);
    document.getElementById('propsModified').textContent = FT.fmtDate(node.modified);

    this.$propsBack.classList.add('active');
    document.getElementById('propsNameInp').focus();
  }
  _hideProps() { this.$propsBack.classList.remove('active'); }
  _propsOK() {
    const inp = document.getElementById('propsNameInp');
    const newName = inp.value.trim();
    const node = this.vfs.get(this._propsId);
    if (node && newName && newName !== node.name) {
      this.vfs.rename(this._propsId, newName);
      this._renderContent(); this._renderSidebar();
    }
    this._hideProps();
  }
}


/* =============================================================
   Boot
   ============================================================= */
document.addEventListener('DOMContentLoaded', () => {
  window.explorer = new Explorer();
});
