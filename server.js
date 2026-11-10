'use strict';
/**
 * Joshra Photography – zero-dependency Node.js server
 * Run:  node server.js
 *
 * - Serves the public website (/public)
 * - Admin panel at /admin (login required)
 * - Streams image/video uploads to /uploads
 * - Stores metadata in /data/*.json
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Transform, pipeline } = require('stream');

// ───────────────────────── Config ─────────────────────────
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// Set STORAGE_DIR to a persistent disk path on your host (e.g. /var/data) to keep
// uploads/ and data/ there; otherwise they live next to server.js.
const STORAGE = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : ROOT;
const UPLOAD_DIR = path.join(STORAGE, 'uploads');
const DATA_DIR = path.join(STORAGE, 'data');
const PORT = Number(process.env.PORT) || 3000;

const MAX_IMAGE = 25 * 1024 * 1024;        // 25 MB
const MAX_VIDEO = 1024 * 1024 * 1024;      // 1 GB
const SESSION_TTL = 1000 * 60 * 60 * 12;   // 12 hours

const CATEGORIES = ['weddings', 'portraits', 'events', 'aerials', 'films', 'stories'];
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4',
  '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

for (const d of [UPLOAD_DIR, DATA_DIR]) fs.mkdirSync(d, { recursive: true });

// ───────────────────────── Tiny JSON store ─────────────────────────
function makeStore(file, fallback) {
  let cache;
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = fallback; }
  let chain = Promise.resolve();
  return {
    get: () => cache,
    save() {
      chain = chain.then(async () => {
        const tmp = file + '.tmp';
        await fsp.writeFile(tmp, JSON.stringify(cache, null, 2));
        await fsp.rename(tmp, file);
      }).catch((e) => console.error('Store write failed:', e));
      return chain;
    },
  };
}

const mediaStore = makeStore(path.join(DATA_DIR, 'media.json'), []);
const enquiryStore = makeStore(path.join(DATA_DIR, 'enquiries.json'), []);

// Site config (editable by hand)
const DEFAULT_SITE = {
  brand: 'Joshra Photography',
  tagline: 'Capturing real emotions, timeless moments, and stories that stay with you forever.',
  stats: { events: '500+', years: '6+', satisfaction: '100%' },
  whatsapp: '919999999999',
  instagram: 'https://instagram.com/',
  youtube: 'https://youtube.com/',
  email: 'hello@joshraphotography.com',
  location: 'Hyderabad, India',
};
const siteFile = path.join(ROOT, 'site.config.json');
if (!fs.existsSync(siteFile)) fs.writeFileSync(siteFile, JSON.stringify(DEFAULT_SITE, null, 2));
function loadSite() {
  try { return { ...DEFAULT_SITE, ...JSON.parse(fs.readFileSync(siteFile, 'utf8')) }; }
  catch { return DEFAULT_SITE; }
}

// ───────────────────────── Auth ─────────────────────────
const secretFile = path.join(DATA_DIR, 'secret.key');
let SECRET;
try { SECRET = fs.readFileSync(secretFile); } catch {
  SECRET = crypto.randomBytes(32);
  fs.writeFileSync(secretFile, SECRET, { mode: 0o600 });
}

const adminFile = path.join(DATA_DIR, 'admin.json');
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function initAdmin() {
  if (fs.existsSync(adminFile)) return;
  const username = process.env.ADMIN_USER || 'admin';
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(adminFile, JSON.stringify({ username, salt, hash: hashPassword(password, salt) }), { mode: 0o600 });
  console.log('\n┌──────────────────────────────────────────────┐');
  console.log('│  ADMIN ACCOUNT CREATED                       │');
  console.log(`│  Username: ${username.padEnd(34)}│`);
  if (generated) {
    console.log(`│  Password: ${password.padEnd(34)}│`);
    console.log('│  (shown once – change it in Admin → Account) │');
  } else {
    console.log('│  Password: taken from ADMIN_PASSWORD env     │');
  }
  console.log('└──────────────────────────────────────────────┘\n');
}
initAdmin();

function readAdmin() { return JSON.parse(fs.readFileSync(adminFile, 'utf8')); }
function safeEqual(a, b) {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function checkLogin(username, password) {
  const admin = readAdmin();
  const okUser = safeEqual(String(username), admin.username);
  const okPass = safeEqual(hashPassword(String(password), admin.salt), admin.hash);
  return okUser && okPass;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!safeEqual(mac, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  const s = verify(parseCookies(req).jp_session);
  if (!s) return false;
  // Invalidate sessions issued before the last password change
  return s.v === readAdmin().hash.slice(0, 12);
}
function setSession(req, res) {
  const token = sign({ exp: Date.now() + SESSION_TTL, v: readAdmin().hash.slice(0, 12) });
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
  res.setHeader('Set-Cookie',
    `jp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure ? '; Secure' : ''}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'jp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

// Simple in-memory rate limiter
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return true; }
  arr.push(now); buckets.set(key, arr);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600e3)) buckets.delete(k);
}, 600e3).unref();
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// ───────────────────────── Helpers ─────────────────────────
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function sniff(buf, ext) {
  const hex = buf.toString('hex');
  if (['.jpg', '.jpeg'].includes(ext)) return hex.startsWith('ffd8ff');
  if (ext === '.png') return hex.startsWith('89504e47');
  if (ext === '.gif') return buf.slice(0, 4).toString() === 'GIF8';
  if (ext === '.webp') return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  if (['.avif', '.mp4', '.m4v', '.mov'].includes(ext)) return buf.slice(4, 8).toString() === 'ftyp';
  if (ext === '.webm') return hex.startsWith('1a45dfa3');
  return false;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
    "style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

// ───────────────────────── Static file serving (with Range) ─────────────────────────
async function serveFile(req, res, filePath, cache) {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const headers = {
    'Content-Type': type, 'Accept-Ranges': 'bytes', 'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(), 'Cache-Control': cache,
  };
  if (req.headers['if-none-match'] === etag) { send(res, 304, null, headers); return true; }

  let start = 0, end = stat.size - 1, status = 200;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (m[1] === '' && m[2] === '')) {
      send(res, 416, null, { ...headers, 'Content-Range': `bytes */${stat.size}` }); return true;
    }
    if (m[1] === '') { start = Math.max(stat.size - Number(m[2]), 0); }
    else { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), end); }
    if (start > end || start >= stat.size) {
      send(res, 416, null, { ...headers, 'Content-Range': `bytes */${stat.size}` }); return true;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
}

function resolveInside(base, rel) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const full = path.join(base, path.normalize(decoded));
  return full.startsWith(base + path.sep) || full === base ? full : null;
}

// ───────────────────────── API ─────────────────────────
const publicMedia = (m) => ({
  id: m.id, type: m.type, category: m.category, title: m.title, caption: m.caption,
  url: `/uploads/${m.file}`, showreel: !!m.showreel, createdAt: m.createdAt,
});

async function handleUpload(req, res, url) {
  const category = url.searchParams.get('category');
  if (!CATEGORIES.includes(category)) return json(res, 400, { error: 'Invalid category' });

  const origName = clean(url.searchParams.get('name') || 'file', 200);
  const ext = path.extname(origName).toLowerCase();
  const kind = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
  if (!kind) { res.setHeader('Connection', 'close'); return json(res, 415, { error: 'Unsupported file type' }); }

  const max = kind === 'image' ? MAX_IMAGE : MAX_VIDEO;
  const len = Number(req.headers['content-length']);
  if (!len) { res.setHeader('Connection', 'close'); return json(res, 411, { error: 'Content-Length required' }); }
  if (len > max) {
    res.setHeader('Connection', 'close');
    return json(res, 413, { error: `File too large (max ${Math.round(max / 1048576)} MB for ${kind}s)` });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const fileName = id + ext;
  const finalPath = path.join(UPLOAD_DIR, fileName);
  const tmpPath = finalPath + '.part';

  let received = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > max) return cb(new Error('too-large'));
      cb(null, chunk);
    },
  });

  try {
    await new Promise((resolve, reject) => {
      pipeline(req, counter, fs.createWriteStream(tmpPath), (err) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    fsp.unlink(tmpPath).catch(() => {});
    return json(res, e.message === 'too-large' ? 413 : 400, { error: 'Upload failed' });
  }

  // verify file signature
  const fh = await fsp.open(tmpPath, 'r');
  const head = Buffer.alloc(16);
  await fh.read(head, 0, 16, 0);
  await fh.close();
  if (!sniff(head, ext)) {
    await fsp.unlink(tmpPath).catch(() => {});
    return json(res, 415, { error: 'File content does not match its type' });
  }
  await fsp.rename(tmpPath, finalPath);

  const title = clean(url.searchParams.get('title'), 120) || origName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const item = {
    id, type: kind, category, title,
    caption: clean(url.searchParams.get('caption'), 400),
    file: fileName, size: received, showreel: false, createdAt: new Date().toISOString(),
  };
  mediaStore.get().unshift(item);
  await mediaStore.save();
  json(res, 201, { item: publicMedia(item) });
}

async function api(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // ── Public ──
  if (method === 'GET' && p === '/api/config') return json(res, 200, loadSite());

  if (method === 'GET' && p === '/api/media') {
    const cat = url.searchParams.get('category');
    const type = url.searchParams.get('type');
    let list = mediaStore.get();
    if (cat) list = list.filter((m) => m.category === cat);
    if (type) list = list.filter((m) => m.type === type);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);
    return json(res, 200, { items: list.slice(0, limit).map(publicMedia) });
  }

  if (method === 'GET' && p === '/api/showreel') {
    const m = mediaStore.get().find((x) => x.showreel && x.type === 'video');
    return json(res, 200, { item: m ? publicMedia(m) : null });
  }

  if (method === 'POST' && p === '/api/enquiry') {
    if (limited('enq:' + ipOf(req), 5, 3600e3)) return json(res, 429, { error: 'Too many enquiries. Please try later.' });
    const b = await readJson(req);
    const e = {
      id: crypto.randomBytes(6).toString('hex'),
      name: clean(b.name, 100), email: clean(b.email, 160), phone: clean(b.phone, 30),
      service: clean(b.service, 60), date: clean(b.date, 30), message: clean(b.message, 2000),
      read: false, createdAt: new Date().toISOString(),
    };
    if (b.website) return json(res, 200, { ok: true }); // honeypot
    if (!e.name || !e.message || (!e.email && !e.phone)) return json(res, 400, { error: 'Name, message and an email or phone are required.' });
    if (e.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) return json(res, 400, { error: 'Invalid email address.' });
    enquiryStore.get().unshift(e);
    await enquiryStore.save();
    return json(res, 201, { ok: true });
  }

  // ── Admin auth ──
  if (method === 'POST' && p === '/api/admin/login') {
    const ip = ipOf(req);
    if (limited('login:' + ip, 8, 15 * 60e3)) return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const b = await readJson(req);
    if (!checkLogin(b.username, b.password)) return json(res, 401, { error: 'Invalid username or password' });
    setSession(req, res);
    return json(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/admin/logout') { clearSession(res); return json(res, 200, { ok: true }); }
  if (method === 'GET' && p === '/api/admin/me') return json(res, 200, { authed: isAuthed(req) });

  // ── Everything below requires admin ──
  if (p.startsWith('/api/admin/')) {
    if (!isAuthed(req)) return json(res, 401, { error: 'Not authorised' });
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') return json(res, 403, { error: 'Bad request origin' });

    if (method === 'GET' && p === '/api/admin/media') {
      const items = mediaStore.get().map((m) => ({ ...publicMedia(m), size: m.size }));
      return json(res, 200, { items, categories: CATEGORIES });
    }
    if (method === 'GET' && p === '/api/admin/stats') {
      const m = mediaStore.get(), e = enquiryStore.get();
      return json(res, 200, {
        images: m.filter((x) => x.type === 'image').length,
        videos: m.filter((x) => x.type === 'video').length,
        bytes: m.reduce((a, x) => a + (x.size || 0), 0),
        enquiries: e.length, unread: e.filter((x) => !x.read).length,
      });
    }
    if (method === 'POST' && p === '/api/admin/upload') return handleUpload(req, res, url);

    let m = /^\/api\/admin\/media\/([a-f0-9]+)$/.exec(p);
    if (m) {
      const list = mediaStore.get();
      const idx = list.findIndex((x) => x.id === m[1]);
      if (idx < 0) return json(res, 404, { error: 'Not found' });
      if (method === 'PATCH') {
        const b = await readJson(req);
        const it = list[idx];
        if (b.title !== undefined) it.title = clean(b.title, 120);
        if (b.caption !== undefined) it.caption = clean(b.caption, 400);
        if (b.category !== undefined) {
          if (!CATEGORIES.includes(b.category)) return json(res, 400, { error: 'Invalid category' });
          it.category = b.category;
        }
        if (b.showreel !== undefined && it.type === 'video') {
          list.forEach((x) => { x.showreel = false; });
          it.showreel = !!b.showreel;
        }
        await mediaStore.save();
        return json(res, 200, { item: publicMedia(it) });
      }
      if (method === 'DELETE') {
        const [it] = list.splice(idx, 1);
        await mediaStore.save();
        fsp.unlink(path.join(UPLOAD_DIR, it.file)).catch(() => {});
        return json(res, 200, { ok: true });
      }
    }

    if (method === 'GET' && p === '/api/admin/enquiries') return json(res, 200, { items: enquiryStore.get() });
    m = /^\/api\/admin\/enquiries\/([a-f0-9]+)$/.exec(p);
    if (m) {
      const list = enquiryStore.get();
      const idx = list.findIndex((x) => x.id === m[1]);
      if (idx < 0) return json(res, 404, { error: 'Not found' });
      if (method === 'PATCH') {
        const b = await readJson(req);
        list[idx].read = !!b.read;
        await enquiryStore.save();
        return json(res, 200, { ok: true });
      }
      if (method === 'DELETE') { list.splice(idx, 1); await enquiryStore.save(); return json(res, 200, { ok: true }); }
    }

    if (method === 'POST' && p === '/api/admin/password') {
      const b = await readJson(req);
      const admin = readAdmin();
      if (!checkLogin(admin.username, b.current)) return json(res, 403, { error: 'Current password is incorrect' });
      if (typeof b.next !== 'string' || b.next.length < 10) return json(res, 400, { error: 'New password must be at least 10 characters' });
      admin.salt = crypto.randomBytes(16).toString('hex');
      admin.hash = hashPassword(b.next, admin.salt);
      fs.writeFileSync(adminFile, JSON.stringify(admin), { mode: 0o600 });
      setSession(req, res); // keep this browser logged in, all others are invalidated
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: 'Not found' });
}

// ───────────────────────── Server ─────────────────────────
const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p.startsWith('/api/')) return await api(req, res, url);

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    if (p.startsWith('/uploads/')) {
      const f = resolveInside(UPLOAD_DIR, p.slice('/uploads/'.length));
      if (f && !f.endsWith('.part') && await serveFile(req, res, f, 'public, max-age=2592000, immutable')) return;
      return send(res, 404, 'Not found');
    }

    // Admin panel
    if (p === '/admin' || p === '/admin/') return await serveFile(req, res, path.join(PUBLIC_DIR, 'admin', 'index.html'), 'no-store');

    let rel = p === '/' ? 'index.html' : p.slice(1);
    const f = resolveInside(PUBLIC_DIR, rel);
    if (f && await serveFile(req, res, f, rel.endsWith('.html') ? 'no-cache' : 'public, max-age=3600')) return;
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Server error' : err.message });
    else res.destroy();
  }
});

server.requestTimeout = 0;          // allow long video uploads
server.headersTimeout = 30e3;
server.keepAliveTimeout = 65e3;

server.listen(PORT, () => {
  console.log(`Joshra Photography running →  http://localhost:${PORT}`);
  console.log(`Admin panel               →  http://localhost:${PORT}/admin`);
});
