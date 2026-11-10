/* Joshra Photography – admin panel */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const NS = 'http://www.w3.org/2000/svg';

  const CATS = { weddings: 'Weddings', portraits: 'Portraits', events: 'Events', aerials: 'Aerials', films: 'Films', stories: 'Stories' };
  const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
  const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v'];
  const MAX_IMAGE = 25 * 1024 * 1024;
  const MAX_VIDEO = 1024 * 1024 * 1024;

  function icon(id) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `/img/icons.svg#${id}`);
    svg.appendChild(use);
    return svg;
  }
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c != null) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  }
  const fmtBytes = (n) => {
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
  };
  const extOf = (name) => (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();

  const toastEl = $('#toast');
  let toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  // ───────── API ─────────
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error('Session expired – please sign in again.'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ───────── views ─────────
  const loginView = $('#loginView');
  const appView = $('#appView');
  function showLogin() { appView.hidden = true; loginView.hidden = false; $('#lUser').focus(); }
  function showApp() { loginView.hidden = true; appView.hidden = false; loadStats(); }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#loginMsg');
    msg.textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', body: { username: $('#lUser').value, password: $('#lPass').value } });
      $('#lPass').value = '';
      showApp();
    } catch (err) { msg.textContent = err.message; }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    showLogin();
  });

  // ───────── tabs ─────────
  function switchTab(name) {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
    if (name === 'library') loadLibrary();
    if (name === 'enquiries') loadEnquiries();
    loadStats();
  }
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // ───────── stats ─────────
  async function loadStats() {
    try {
      const s = await api('/api/admin/stats');
      const row = $('#statsRow');
      row.replaceChildren(
        ...[[s.images, 'Photos'], [s.videos, 'Videos'], [fmtBytes(s.bytes), 'Storage used'], [s.enquiries, 'Enquiries']]
          .map(([n, l]) => h('div', { class: 'stat-box' }, h('b', {}, String(n)), h('span', {}, l))),
      );
      const pill = $('#unreadPill');
      pill.hidden = !s.unread;
      pill.textContent = s.unread;
    } catch { /* handled in api() */ }
  }

  // ───────── upload ─────────
  const drop = $('#drop');
  const fileInput = $('#fileInput');
  const queueEl = $('#queue');
  const startBtn = $('#startUpload');
  const clearBtn = $('#clearQueue');
  let queue = [];
  let uploading = false;

  function addFiles(files) {
    for (const file of files) {
      const ext = extOf(file.name);
      const kind = IMAGE_EXT.includes(ext) ? 'image' : VIDEO_EXT.includes(ext) ? 'video' : null;
      if (!kind) { toast(`“${file.name}” is not a supported file type.`); continue; }
      const max = kind === 'image' ? MAX_IMAGE : MAX_VIDEO;
      if (file.size > max) { toast(`“${file.name}” is too large (max ${fmtBytes(max)}).`); continue; }
      if (file.size === 0) { toast(`“${file.name}” is empty.`); continue; }
      const item = { file, kind, status: 'queued', url: URL.createObjectURL(file) };
      queue.push(item);
    }
    renderQueue();
  }

  function renderQueue() {
    queueEl.replaceChildren();
    queue.forEach((it) => {
      const thumb = h('div', { class: 'q-thumb' },
        it.kind === 'image' ? h('img', { src: it.url, alt: '' }) : h('video', { src: `${it.url}#t=0.5`, muted: '', preload: 'metadata' }));
      it.metaEl = h('div', { class: 'q-meta' }, `${fmtBytes(it.file.size)} · ${it.kind}`);
      it.barEl = h('i');
      const li = h('li', { class: 'q-item' }, thumb,
        h('div', {}, h('div', { class: 'q-name' }, it.file.name), it.metaEl, h('div', { class: 'bar' }, it.barEl)),
        h('button', { class: 'q-x', type: 'button', 'aria-label': 'Remove', onclick: () => removeItem(it) }, icon('close')));
      it.li = li;
      queueEl.append(li);
      applyStatus(it);
    });
    const waiting = queue.filter((q) => q.status === 'queued' || q.status === 'error').length;
    startBtn.disabled = uploading || !waiting;
    startBtn.textContent = waiting ? `Upload ${waiting} file${waiting > 1 ? 's' : ''}` : 'Start upload';
    clearBtn.disabled = uploading || !queue.length;
  }

  function applyStatus(it) {
    if (it.status === 'done') { it.metaEl.className = 'q-meta ok'; it.metaEl.textContent = 'Uploaded ✓'; it.barEl.style.width = '100%'; }
    else if (it.status === 'error') { it.metaEl.className = 'q-meta err'; it.metaEl.textContent = it.error || 'Failed'; }
  }

  function removeItem(it) {
    if (uploading && it.status === 'uploading') return;
    URL.revokeObjectURL(it.url);
    queue = queue.filter((q) => q !== it);
    renderQueue();
  }

  function sendOne(it, params) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/admin/upload?${params}`);
      xhr.setRequestHeader('X-Requested-With', 'fetch');
      xhr.setRequestHeader('Content-Type', it.file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        it.barEl.style.width = `${pct}%`;
        it.metaEl.textContent = `Uploading… ${pct}% (${fmtBytes(e.loaded)} of ${fmtBytes(e.total)})`;
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status === 401) { showLogin(); return reject(new Error('Session expired – sign in again.')); }
        xhr.status >= 200 && xhr.status < 300 ? resolve(data) : reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(it.file);
    });
  }

  startBtn.addEventListener('click', async () => {
    const todo = queue.filter((q) => q.status === 'queued' || q.status === 'error');
    if (!todo.length) return;
    uploading = true;
    startBtn.disabled = true; clearBtn.disabled = true;
    const category = $('#upCat').value;
    const single = todo.length === 1;
    let ok = 0;
    for (const it of todo) {
      it.status = 'uploading';
      const p = new URLSearchParams({ category, name: it.file.name });
      if (single && $('#upTitle').value.trim()) p.set('title', $('#upTitle').value.trim());
      if ($('#upCaption').value.trim()) p.set('caption', $('#upCaption').value.trim());
      try { await sendOne(it, p.toString()); it.status = 'done'; ok++; }
      catch (err) { it.status = 'error'; it.error = err.message; }
      applyStatus(it);
    }
    uploading = false;
    if (ok) { $('#upTitle').value = ''; toast(`${ok} file${ok > 1 ? 's' : ''} uploaded.`); }
    // drop finished items, keep failed ones so they can be retried
    queue.filter((q) => q.status === 'done').forEach((q) => URL.revokeObjectURL(q.url));
    setTimeout(() => {
      queue = queue.filter((q) => q.status !== 'done');
      renderQueue();
    }, 1500);
    renderQueue();
    loadStats();
  });

  clearBtn.addEventListener('click', () => { queue.forEach((q) => URL.revokeObjectURL(q.url)); queue = []; renderQueue(); });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  window.addEventListener('beforeunload', (e) => { if (uploading) { e.preventDefault(); e.returnValue = ''; } });

  // ───────── library ─────────
  let library = [];
  const libCat = $('#libCat');
  Object.entries(CATS).forEach(([v, l]) => libCat.append(h('option', { value: v }, l)));
  const edCat = $('#edCat');
  Object.entries(CATS).forEach(([v, l]) => edCat.append(h('option', { value: v }, l)));
  libCat.addEventListener('change', renderLibrary);
  $('#libType').addEventListener('change', renderLibrary);

  async function loadLibrary() {
    try { library = (await api('/api/admin/media')).items; renderLibrary(); }
    catch (err) { toast(err.message); }
  }

  function renderLibrary() {
    const cat = libCat.value, type = $('#libType').value;
    const list = library.filter((m) => (!cat || m.category === cat) && (!type || m.type === type));
    $('#libCount').textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;
    const lib = $('#lib');
    lib.replaceChildren();
    if (!list.length) { lib.append(h('div', { class: 'empty' }, 'Nothing here yet — upload some photos or videos.')); return; }
    list.forEach((m) => {
      const thumb = h('div', { class: 'm-thumb' },
        m.type === 'video' ? h('video', { src: `${m.url}#t=0.5`, muted: '', preload: 'metadata', playsinline: '' }) : h('img', { src: m.url, alt: '', loading: 'lazy' }),
        h('span', { class: 'm-tag' }, `${CATS[m.category] || m.category} · ${m.type}`),
        m.showreel ? h('span', { class: 'm-tag reel' }, 'Showreel') : null);
      const actions = h('div', { class: 'm-actions' },
        h('button', { class: 'icon-btn', type: 'button', onclick: () => openEdit(m) }, icon('edit'), 'Edit'),
        m.type === 'video'
          ? h('button', { class: `icon-btn ${m.showreel ? 'on' : ''}`, type: 'button', title: 'Use as homepage showreel', onclick: () => toggleReel(m) }, icon('play'), m.showreel ? 'Unset reel' : 'Set as reel')
          : null,
        h('button', { class: 'icon-btn danger', type: 'button', onclick: () => remove(m) }, icon('trash'), 'Delete'));
      lib.append(h('article', { class: 'm-card' }, thumb,
        h('div', { class: 'm-body' }, h('b', {}, m.title || '(untitled)'), h('small', {}, `${fmtBytes(m.size || 0)} · ${new Date(m.createdAt).toLocaleDateString()}`)),
        actions));
    });
  }

  async function toggleReel(m) {
    try { await api(`/api/admin/media/${m.id}`, { method: 'PATCH', body: { showreel: !m.showreel } }); toast(m.showreel ? 'Showreel unset.' : 'Set as homepage showreel.'); loadLibrary(); }
    catch (err) { toast(err.message); }
  }
  async function remove(m) {
    if (!confirm(`Delete “${m.title || 'this item'}” permanently? This cannot be undone.`)) return;
    try { await api(`/api/admin/media/${m.id}`, { method: 'DELETE', body: {} }); toast('Deleted.'); loadLibrary(); loadStats(); }
    catch (err) { toast(err.message); }
  }

  const dlg = $('#editDlg');
  let editing = null;
  function openEdit(m) {
    editing = m;
    $('#edTitle').value = m.title || '';
    $('#edCaption').value = m.caption || '';
    edCat.value = m.category;
    dlg.showModal();
  }
  $('#edCancel').addEventListener('click', () => dlg.close());
  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/media/${editing.id}`, { method: 'PATCH', body: { title: $('#edTitle').value, caption: $('#edCaption').value, category: edCat.value } });
      dlg.close(); toast('Saved.'); loadLibrary();
    } catch (err) { toast(err.message); }
  });

  // ───────── enquiries ─────────
  async function loadEnquiries() {
    const box = $('#enqList');
    try {
      const { items } = await api('/api/admin/enquiries');
      box.replaceChildren();
      if (!items.length) { box.append(h('div', { class: 'empty' }, 'No enquiries yet.')); return; }
      items.forEach((q) => box.append(enquiryRow(q)));
    } catch (err) { toast(err.message); }
  }

  function enquiryRow(q) {
    const det = h('details', { class: q.read ? '' : 'unread' });
    const dl = h('dl', {});
    [['Email', q.email], ['Phone', q.phone], ['Service', q.service], ['Event date', q.date]].forEach(([k, v]) => {
      if (v) dl.append(h('dt', {}, k), h('dd', {}, v));
    });
    const phoneDigits = (q.phone || '').replace(/\D/g, '');
    const actions = h('div', { class: 'enq-actions' },
      q.email ? h('a', { class: 'icon-btn', href: `mailto:${q.email}?subject=${encodeURIComponent('Re: your enquiry – Joshra Photography')}` }, icon('mail'), 'Reply by email') : null,
      phoneDigits.length >= 8 ? h('a', { class: 'icon-btn', href: `https://wa.me/${phoneDigits}`, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'WhatsApp') : null,
      h('button', { class: 'icon-btn', type: 'button', onclick: async () => { await setRead(q, !q.read); } }, icon('check'), q.read ? 'Mark unread' : 'Mark read'),
      h('button', { class: 'icon-btn danger', type: 'button', onclick: async () => {
        if (!confirm('Delete this enquiry?')) return;
        try { await api(`/api/admin/enquiries/${q.id}`, { method: 'DELETE', body: {} }); loadEnquiries(); loadStats(); } catch (err) { toast(err.message); }
      } }, icon('trash'), 'Delete'));
    det.append(
      h('summary', {}, h('i', { class: 'dot' }), h('b', {}, q.name), h('span', {}, q.service || ''), h('time', {}, new Date(q.createdAt).toLocaleString())),
      h('div', { class: 'enq-body' }, dl, h('p', {}, q.message), actions));
    det.addEventListener('toggle', () => { if (det.open && !q.read) setRead(q, true, true); });
    return det;
  }
  async function setRead(q, read, silent) {
    try {
      await api(`/api/admin/enquiries/${q.id}`, { method: 'PATCH', body: { read } });
      q.read = read;
      loadStats();
      if (!silent) loadEnquiries();
    } catch (err) { toast(err.message); }
  }

  // ───────── account ─────────
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#pwMsg');
    msg.className = 'full form-msg';
    if ($('#pwNew').value !== $('#pwNew2').value) { msg.classList.add('err'); msg.textContent = 'New passwords do not match.'; return; }
    try {
      await api('/api/admin/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } });
      e.target.reset();
      msg.classList.add('ok'); msg.textContent = 'Password changed.';
    } catch (err) { msg.classList.add('err'); msg.textContent = err.message; }
  });

  // ───────── boot ─────────
  (async () => {
    try {
      const { authed } = await (await fetch('/api/admin/me', { credentials: 'same-origin' })).json();
      authed ? showApp() : showLogin();
    } catch { showLogin(); }
  })();
})();
