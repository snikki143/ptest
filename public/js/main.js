/* Joshra Photography – public site */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const NS = 'http://www.w3.org/2000/svg';

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

  const CAT_ICON = { weddings: 'camera', portraits: 'user', events: 'calendar', aerials: 'drone', films: 'film', stories: 'heart' };
  const CAT_LABEL = { weddings: 'Weddings', portraits: 'Portraits', events: 'Events', aerials: 'Aerials', films: 'Films', stories: 'Stories' };

  let media = [];
  let filter = 'all';

  // ───────── toast ─────────
  const toastEl = $('#toast');
  let toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  // ───────── reveal-on-scroll ─────────
  $$('[data-d]').forEach((el) => el.style.setProperty('--d', `${el.dataset.d}s`));
  const revealIO = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); } });
      }, { threshold: 0.12 })
    : null;
  function watchReveal(root = document) {
    $$('.reveal:not(.in)', root).forEach((el) => (revealIO ? revealIO.observe(el) : el.classList.add('in')));
  }
  watchReveal();

  // ───────── header, nav, section tracking ─────────
  const header = $('#header');
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const nav = $('#nav');
  const toggle = $('#navToggle');
  function setNav(open) {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.replaceChildren(icon(open ? 'close' : 'menu'));
  }
  toggle.addEventListener('click', () => setNav(!nav.classList.contains('open')));
  $$('.nav a').forEach((a) => a.addEventListener('click', () => setNav(false)));
  $('.has-menu > button').addEventListener('click', (e) => e.currentTarget.parentElement.classList.toggle('open'));

  const sectionIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const id = e.target.id;
      $$('[data-s]').forEach((el) => el.classList.toggle('active', el.dataset.s === id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('[data-section]').forEach((s) => sectionIO.observe(s));

  // ───────── 3D tilt on hero stage ─────────
  const stage = $('#stage');
  const hero = $('#home');
  if (window.matchMedia('(pointer:fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let raf = 0;
    hero.addEventListener('mousemove', (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        stage.style.setProperty('--mx', ((e.clientX / window.innerWidth) - 0.5) * 2);
        stage.style.setProperty('--my', ((e.clientY / window.innerHeight) - 0.5) * 2);
      });
    });
    hero.addEventListener('mouseleave', () => { stage.style.setProperty('--mx', 0); stage.style.setProperty('--my', 0); });
  }

  // ───────── lightbox ─────────
  const lb = $('#lb');
  const lbStage = $('#lbStage');
  let lbList = [];
  let lbIdx = 0;
  let lastFocus = null;

  function lbRender() {
    const it = lbList[lbIdx];
    lbStage.replaceChildren();
    if (!it) return;
    const el = it.type === 'video'
      ? h('video', { src: it.url, controls: '', autoplay: '', playsinline: '', preload: 'metadata' })
      : h('img', { src: it.url, alt: it.title || '' });
    const cap = h('div', { class: 'lb-cap' }, h('b', {}, it.title || ''), it.caption ? h('p', {}, it.caption) : null);
    lbStage.append(el, cap);
    const many = lbList.length > 1;
    $('#lbPrev').hidden = !many;
    $('#lbNext').hidden = !many;
  }
  function openLightbox(list, idx = 0) {
    if (!list.length) return;
    lbList = list; lbIdx = idx;
    lastFocus = document.activeElement;
    lbRender();
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    $('#lbClose').focus();
  }
  function closeLightbox() {
    lb.classList.remove('open');
    lbStage.replaceChildren(); // stops any playing video
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  function lbStep(d) { lbIdx = (lbIdx + d + lbList.length) % lbList.length; lbRender(); }
  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lbPrev').addEventListener('click', () => lbStep(-1));
  $('#lbNext').addEventListener('click', () => lbStep(1));
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') lbStep(-1);
    else if (e.key === 'ArrowRight') lbStep(1);
  });

  // ───────── rendering ─────────
  const byCat = (cat) => media.filter((m) => m.category === cat);

  function mediaEl(it, { controls = false } = {}) {
    if (it.type === 'video') {
      return h('video', { src: `${it.url}#t=0.5`, muted: '', loop: '', playsinline: '', preload: 'metadata', ...(controls ? { controls: '' } : {}) });
    }
    return h('img', { src: it.url, alt: it.title || '', loading: 'lazy', decoding: 'async' });
  }

  function fillSlot(slot, it) {
    slot.className = 'card-media';
    slot.replaceChildren(mediaEl(it));
    const v = $('video', slot);
    if (v) { v.autoplay = true; v.muted = true; v.play().catch(() => {}); }
  }

  function renderHero() {
    $$('.card[data-cat]').forEach((card) => {
      const cat = card.dataset.cat;
      const list = byCat(cat);
      const pick = list.find((m) => m.type === 'image') || list[0];
      if (pick) fillSlot($('[data-slot]', card), pick);
      card.onclick = () => {
        if (list.length) openLightbox(list, 0);
        else { setFilter(cat); document.getElementById('portfolio').scrollIntoView({ behavior: 'smooth' }); }
      };
    });
    const portrait = byCat('portraits').find((m) => m.type === 'image');
    if (portrait) fillSlot($('#aboutSlot'), portrait);
  }

  function placeholderTile(cat, i) {
    const shape = ['', 'tall', 'wide'][i % 3];
    return h('div', { class: `tile ph ${shape}` },
      h('div', { class: `card-media ph ph-${cat}` }, icon(CAT_ICON[cat])),
      h('div', { class: 'cap' }, h('b', {}, CAT_LABEL[cat]), h('small', {}, 'Coming soon')));
  }

  function renderGallery() {
    const g = $('#gallery');
    g.replaceChildren();
    const list = (filter === 'all' ? media.filter((m) => m.category !== 'stories') : byCat(filter));
    if (!list.length) {
      const cats = filter === 'all' ? ['weddings', 'portraits', 'events', 'aerials', 'films', 'weddings'] : [filter, filter, filter];
      cats.forEach((c, i) => g.append(placeholderTile(c, i)));
      return;
    }
    list.forEach((it, i) => {
      const tile = h('button', { class: 'tile', type: 'button', 'aria-label': `Open ${it.title || 'media'}` },
        mediaEl(it),
        it.type === 'video' ? h('span', { class: 'vbadge' }, icon('play')) : null,
        h('span', { class: 'cap' }, h('b', {}, it.title || ''), h('small', {}, CAT_LABEL[it.category] || it.category)));
      tile.addEventListener('click', () => openLightbox(list, i));
      g.append(tile);
    });
  }

  function setFilter(f) {
    filter = f;
    $$('#filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === f));
    renderGallery();
  }
  $$('#filters .chip').forEach((c) => c.addEventListener('click', () => setFilter(c.dataset.filter)));
  $$('.menu a[data-filter]').forEach((a) => a.addEventListener('click', () => setFilter(a.dataset.filter)));

  function renderStories() {
    const g = $('#storyGrid');
    g.replaceChildren();
    const list = byCat('stories');
    if (!list.length) {
      for (let i = 0; i < 3; i++) {
        g.append(h('article', { class: 'story reveal' },
          h('div', { class: 'story-img' }, h('div', { class: 'card-media ph ph-stories' }, icon('heart'))),
          h('div', { class: 'story-body' }, h('h3', {}, 'Story coming soon'), h('p', {}, 'Our next love story is being edited. Check back shortly.'))));
      }
      watchReveal(g);
      return;
    }
    list.forEach((it, i) => {
      const card = h('button', { class: 'story reveal', type: 'button' },
        h('div', { class: 'story-img' }, mediaEl(it)),
        h('div', { class: 'story-body' }, h('h3', {}, it.title || ''), it.caption ? h('p', {}, it.caption) : null));
      card.dataset.d = String((i % 3) * 0.1);
      card.style.setProperty('--d', `${(i % 3) * 0.1}s`);
      card.addEventListener('click', () => openLightbox(list, i));
      g.append(card);
    });
    watchReveal(g);
  }

  // ───────── showreel ─────────
  $('#showreelBtn').addEventListener('click', async () => {
    try {
      const r = await (await fetch('/api/showreel')).json();
      if (r.item) return openLightbox([r.item], 0);
    } catch { /* fall through */ }
    const vids = media.filter((m) => m.type === 'video');
    if (vids.length) return openLightbox(vids, 0);
    toast('Our showreel is coming soon.');
  });

  // ───────── enquiry form ─────────
  const form = $('#enquiryForm');
  const msg = $('#formMsg');
  const btn = $('#formBtn');
  $('#fDate').min = new Date().toISOString().slice(0, 10);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'full form-msg';
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim() || !data.message.trim() || (!data.email.trim() && !data.phone.trim())) {
      msg.classList.add('err');
      msg.textContent = 'Please add your name, a message, and an email or phone number.';
      return;
    }
    btn.disabled = true;
    try {
      const res = await fetch('/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Something went wrong.');
      form.reset();
      msg.classList.add('ok');
      msg.textContent = 'Thank you! Your enquiry has been sent — we’ll be in touch soon.';
    } catch (err) {
      msg.classList.add('err');
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ───────── boot ─────────
  $('#year').textContent = new Date().getFullYear();

  async function boot() {
    try {
      const cfg = await (await fetch('/api/config')).json();
      if (cfg.tagline) $('#heroSub').textContent = cfg.tagline;
      if (cfg.stats) {
        $('#stEvents').textContent = cfg.stats.events;
        $('#stYears').textContent = cfg.stats.years;
        $('#stSat').textContent = cfg.stats.satisfaction;
        $$('[data-stat]').forEach((el) => { el.textContent = cfg.stats[el.dataset.stat] ?? el.textContent; });
      }
      const wa = `https://wa.me/${String(cfg.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent('Hi! I found you on your website and would like to enquire.')}`;
      $('#lnkWa').href = wa; $('#cWa').href = wa;
      $('#lnkIg').href = cfg.instagram; $('#lnkIg2').href = cfg.instagram;
      $('#lnkYt').href = cfg.youtube; $('#lnkYt2').href = cfg.youtube;
      $('#cEmail').href = `mailto:${cfg.email}`; $('#cEmail').textContent = cfg.email;
      $('#cLoc').textContent = cfg.location;
    } catch { /* defaults in HTML remain */ }

    try {
      media = (await (await fetch('/api/media')).json()).items || [];
    } catch { media = []; }

    renderHero();
    renderGallery();
    renderStories();
    watchReveal();
  }
  boot();
})();
