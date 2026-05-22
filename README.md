# POSHIVE

Multi-tenant Point of Sale for the Hive blockchain — accepts HBD, HIVE, cash, and Bitcoin Lightning. Includes sales reporting, optional membership/subscription management, and a self-hosted backend you control.

## Features

- **Multi-tenant** — each authorized store owner gets their own isolated store
- **Hive blockchain payments** — HBD/HIVE transfers via QR code with automatic confirmation polling
- **Bitcoin Lightning** — optional, via v4v.app integration
- **Sales reporting** — every transaction is recorded; filter by date range and payment method; summary stats and daily breakdown
- **Membership management** — track members, dues, and payment history (per-store opt-in, great for gyms/clubs)
- **Email reminders** — automated overdue payment reminders via SMTP; configurable interval throttle; manual trigger from the dashboard
- **Role system** — superadmin approves store owners; store owners manage their own cashiers
- **Image uploads** — product and banner images uploaded to your own server, compressed client-side before upload (no third-party image hosts)
- **i18n** — English and Spanish, switchable per session
- **PWA** — installable as an app on any device (iOS, Android, desktop)
- **Self-hostable** — runs on any VPS with Node.js + MongoDB; one-command install script included

## Quick Install

```bash
git clone <repo-url> /opt/poshive
cd /opt/poshive
sudo bash install.sh
```

The install script will check dependencies, scan for a free port, prompt for all configuration, write `.env`, install Node packages, create and start a systemd service, and print next steps.

**To update later:**
```bash
bash update.sh
```

## Manual Setup

If you prefer to set things up yourself:

```bash
cd backend
cp .env.example .env
# Edit .env — set MONGODB_URI, JWT_SECRET, SUPERADMIN_USERNAME, PUBLIC_URL at minimum
npm install
npm start
```

The backend serves the frontend files too — visit `http://localhost:3001` to open the app.

## Project Structure

```
POSHIVE/
├── install.sh              One-command setup wizard (run as root)
├── update.sh               Pull updates + restart service
├── docs/
│   └── nginx.conf          nginx reverse proxy config for pos.3speak.tv
├── backend/
│   ├── server.js
│   ├── .env.example
│   ├── middleware/         JWT auth helpers
│   ├── models/             Mongoose schemas (User, Store, Cashier, Member,
│   │                         MembershipType, MemberPayment, Sale)
│   ├── routes/             API endpoints
│   └── uploads/            Uploaded product/banner images (gitignored)
├── pos.html                Point of Sale (cashier view)
├── quick-sale.html         Quick HBD payment / QR generator
├── members.html            Membership management
├── dashboard.html          Store owner dashboard (today's revenue, metrics)
├── admin.html              Store settings, items, cashiers, feature flags
├── superadmin.html         Platform admin — approve/reject store owners
├── login.html              Login + registration (store owners await approval)
├── reviewreceipts.html     Sales reports — date filter, revenue summary, transaction list
├── theme.css               Shared design system (warm palette, CSS variables)
├── i18n.js                 EN/ES translation dictionary
├── manifest.json           PWA manifest
├── service-worker.js       PWA service worker (app-shell caching)
└── pwa.js                  Service worker registration (included in all pages)
```

## .env Reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | Port to listen on (default: `3001`) |
| `MONGODB_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | Secret for signing JWTs — use a long random string in production |
| `JWT_EXPIRY` | no | Token lifetime (default: `7d`) |
| `CORS_ORIGIN` | no | Allowed CORS origin(s), or `*` for open access |
| `SUPERADMIN_USERNAME` | yes | This Hive username gets superadmin on first registration |
| `PUBLIC_URL` | yes | Public base URL of this server, no trailing slash (e.g. `https://pos.3speak.tv`) |
| `EMAIL_HOST` | for reminders | SMTP host (e.g. `smtp.resend.com`) |
| `EMAIL_PORT` | no | SMTP port (default: `465`) |
| `EMAIL_SECURE` | no | `true` for port 465 / direct TLS, `false` for STARTTLS (default: `true`) |
| `EMAIL_USER` | for reminders | SMTP username |
| `EMAIL_PASS` | for reminders | SMTP password / API key |
| `EMAIL_FROM` | no | From address shown to members |
| `REMINDER_CRON` | no | Cron expression for the daily reminder run (default: `0 9 * * *` — 9 am) |
| `REMINDER_INTERVAL_DAYS` | no | Minimum days between reminders per member (default: `7`) |
| `TZ` | no | Server timezone for cron scheduling (e.g. `America/Guayaquil`, default: `UTC`) |

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Create account (auto-approved if `SUPERADMIN_USERNAME`) |
| POST | `/api/auth/login` | — | Login → JWT |
| GET | `/api/admin/pending` | superadmin | List unapproved store owners |
| POST | `/api/admin/approve/:id` | superadmin | Approve owner |
| DELETE | `/api/admin/reject/:id` | superadmin | Reject + delete owner |
| GET/POST/PUT | `/api/store` | store_owner | Store config + items |
| GET/POST/PUT/DELETE | `/api/cashiers` | store_owner | Cashier accounts |
| GET/POST/PUT/DELETE | `/api/members` | store_owner | Members |
| GET/POST/PUT/DELETE | `/api/membership-types` | store_owner | Membership plans |
| POST | `/api/members/:id/payments` | store_owner | Record member payment |
| GET | `/api/members/:id/payments` | store_owner | Payment history |
| POST | `/api/sales` | store_owner/cashier | Record a POS sale |
| GET | `/api/sales` | store_owner | List sales (`?from=&to=&method=&page=&limit=`) |
| GET | `/api/sales/summary` | store_owner | Revenue totals + breakdown (`?from=&to=`) |
| POST | `/api/upload` | store_owner | Upload image → saved to `uploads/`, returns absolute URL |
| POST | `/api/reminders/send` | store_owner | Manually trigger overdue email reminders |

## Email Reminders

When `EMAIL_HOST`, `EMAIL_USER`, and `EMAIL_PASS` are set, the backend will:

- **Automatically** send overdue membership reminders once daily (controlled by `REMINDER_CRON`)
- **Throttle** reminders per member — won't re-send until `REMINDER_INTERVAL_DAYS` have passed
- Only send for stores where the **Email Reminders** feature flag is enabled (Admin → Store Settings)
- Let store owners customize the reminder subject and body with `{{name}}`, `{{amount}}`, `{{storeName}}` placeholders

The reminder language defaults to Spanish if the store owner's UI is set to Spanish, English otherwise. Manual trigger available from the dashboard.

If email is not configured, reminders are silently skipped and the manual trigger returns `503`.

## Deploy with nginx

Copy `docs/nginx.conf` to `/etc/nginx/sites-available/poshive`, update the `upstream` port if needed, then:

```bash
ln -s /etc/nginx/sites-available/poshive /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d pos.3speak.tv
```

The included config handles HTTP → HTTPS redirect, SSL, security headers, gzip compression, and a 30-day cache on uploaded images.

Useful service commands:

```bash
systemctl status poshive        # check service
journalctl -u poshive -f        # follow logs
systemctl restart poshive       # restart
```

## First Login

1. Start the backend (`sudo systemctl start poshive` or `npm start`)
2. Open `http://localhost:3001/login.html`
3. Register with the username set in `SUPERADMIN_USERNAME`
4. Log in — the account is auto-approved and promoted to superadmin
5. Go to `superadmin.html` to approve other store owners

## Image Uploads

Product and banner images are compressed in the browser before upload (max 900 px / 1600 px for banners, re-encoded as JPEG at 82% quality) and stored in `backend/uploads/`. No third-party image service required. The `uploads/` folder is gitignored — back it up separately on your server.

## PWA

POSHIVE is installable as a Progressive Web App. On any HTTPS deployment, browsers will offer an "Add to Home Screen" / install prompt. Once installed, the app shell loads instantly from cache — useful for cashiers on slow connections.

## License

MIT
