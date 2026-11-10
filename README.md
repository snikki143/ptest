# Joshra Photography – website + admin panel

Zero-dependency Node.js project (needs Node 18+; nothing to `npm install`).

## Run
```bash
node server.js
# site:   http://localhost:3000
# admin:  http://localhost:3000/admin
```
On the **first run** an admin account is created and the password is printed once in the terminal.
To choose your own instead:
```bash
ADMIN_USER=joshra ADMIN_PASSWORD='a-long-password' node server.js
```
(only used the first time, when `data/admin.json` doesn't exist). Change it later in **Admin → Account**.

## What the admin can do
- **Upload** photos (JPG/PNG/WebP/GIF/AVIF, ≤25 MB) and videos (MP4/WebM/MOV, ≤1 GB) – drag & drop, multiple files, progress bars
- Choose a category: Weddings, Portraits, Events, Aerials, Films, Stories
- **Library**: edit title/caption/category, delete, set one video as the homepage **Showreel**
- **Enquiries** from the contact form, with reply-by-email / WhatsApp
- Hero cards on the homepage automatically show the latest photo of Weddings / Aerials / Events / Portraits

## Edit contact details & stats
`site.config.json` (created on first run): WhatsApp number (country code, digits only), Instagram, YouTube, email, location, and the 500+ / 6+ / 100% numbers.

## Files
```
server.js            backend (API, auth, uploads, static files)
public/              website (index.html, css/, js/, img/) and public/admin/
uploads/             uploaded media (back this up!)
data/                media.json, enquiries.json, admin.json, secret.key (back up, keep private)
```

## Going live
- To keep media on a persistent disk, set `STORAGE_DIR` (e.g. `/var/data`); `uploads/` and `data/` are then created inside it.
- Put it behind HTTPS (Nginx/Caddy reverse proxy, or a host like Render/Railway/a VPS) and set `COOKIE_SECURE=1`.
- If using Nginx, set `client_max_body_size 1100m;` and `proxy_request_buffering off;` for large video uploads.
- Use a host with a **persistent disk** – `uploads/` and `data/` must survive restarts.
- Keep it running with `pm2 start server.js --name joshra` (or systemd).
- Optional: `PORT=8080 node server.js`.

## Security notes
Passwords are hashed (scrypt); sessions are signed HttpOnly SameSite=Strict cookies; login and enquiry endpoints are rate-limited; uploads are checked by extension **and** file signature, stored under random names, and served with `nosniff`; strict Content-Security-Policy.
