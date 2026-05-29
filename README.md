# POSHIVE

**Free, open-source, self-hosted Point of Sale.** Works out of the box for any business — add only the plugins you need.

Built with Node.js + MongoDB. Runs on any VPS you control. No monthly fees, no third-party lock-in.

---

## Core (always on)

- **Multi-tenant** — each store owner gets their own isolated store; a superadmin approves new accounts
- **POS** — product catalog, cart, cash / card / bank transfer / check / other payment methods
- **Sales reporting** — every transaction recorded; filter by date and method; daily revenue breakdown
- **Cashier accounts** — store owners create logins for staff; cashiers see only their store
- **Image uploads** — product and banner images stored on your own server, compressed client-side
- **i18n** — English and Spanish, switchable per session
- **PWA** — installable on any device (iOS, Android, desktop); works offline after first load
- **Role system** — superadmin → store owner → cashier

---

## Plugins (toggle per store in Admin → Settings)

| Plugin | What it does |
|--------|-------------|
| **Hive / HBD Payments** | Accept HBD (stable $1 crypto) at the POS via QR code. Customers scan with any Hive wallet. Payments confirmed automatically. |
| **Bitcoin Lightning** | Accept BTC via Lightning Network through v4v.app. |
| **Memberships** | Track members, dues, and payment history. Overdue alerts on the dashboard. Great for gyms, clubs, and subscription businesses. |
| **Email Reminders** | Automated overdue payment reminders via SMTP. Configurable interval and custom message templates. |
| **Email Campaigns** | Send bulk emails to your member list. |
| **Open Tabs & Tables** | Assign orders to tables, save open tabs, close them at payment. |
| **Kitchen Display** | PIN-protected screen for kitchen staff shows open orders in real time. |

---

## Quick Install

```bash
git clone <repo-url> /opt/poshive
cd /opt/poshive
sudo bash install.sh
```

The install script checks dependencies, scans for a free port, prompts for configuration, writes `.env`, installs packages, and starts a systemd service.

**To update:**
```bash
bash update.sh
```

---

## Manual Setup

```bash
cd backend
cp .env.example .env
# Edit .env — set MONGODB_URI, JWT_SECRET, SUPERADMIN_USERNAME, PUBLIC_URL at minimum
npm install
npm start
```

Visit `http://localhost:3001` to open the app.

---

## Project Structure

```
POSHIVE/
├── install.sh              One-command setup wizard (run as root)
├── update.sh               Pull updates + restart service
├── docs/
│   └── nginx.conf          nginx reverse proxy config
├── backend/
│   ├── server.js
│   ├── .env.example
│   ├── middleware/         JWT auth helpers
│   ├── models/             Mongoose schemas (User, Store, Cashier, Member,
│   │                         MembershipType, MemberPayment, Sale)
│   ├── routes/             API endpoints
│   └── uploads/            Uploaded product/banner images (gitignored)
├── pos.html                Point of Sale (cashier view)
├── quick-sale.html         Quick payment / QR generator
├── members.html            Membership management
├── dashboard.html          Store owner dashboard
├── admin.html              Store settings, items, cashiers, plugins
├── superadmin.html         Platform admin — approve/reject store owners
├── login.html              Login + registration
├── reviewreceipts.html     Sales reports
├── kitchen.html            Kitchen display (PIN-protected)
├── campaigns.html          Email campaigns
├── theme.css               Shared design system
├── i18n.js                 EN/ES translation dictionary
├── manifest.json           PWA manifest
└── service-worker.js       PWA app-shell cache
```

---

## .env Reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | Port to listen on (default: `3001`) |
| `MONGODB_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | Long random string — keep secret |
| `JWT_EXPIRY` | no | Token lifetime (default: `7d`) |
| `CORS_ORIGIN` | no | Allowed CORS origin(s), or `*` |
| `SUPERADMIN_USERNAME` | yes | This username gets superadmin on first registration |
| `PUBLIC_URL` | yes | Public base URL, no trailing slash (e.g. `https://pos.example.com`) |
| `EMAIL_HOST` | for email plugins | SMTP host |
| `EMAIL_PORT` | no | SMTP port (default: `465`) |
| `EMAIL_SECURE` | no | `true` for port 465, `false` for STARTTLS (default: `true`) |
| `EMAIL_USER` | for email plugins | SMTP username |
| `EMAIL_PASS` | for email plugins | SMTP password / API key |
| `EMAIL_FROM` | no | From address shown to recipients |
| `REMINDER_CRON` | no | Cron for daily reminder run (default: `0 9 * * *`) |
| `REMINDER_INTERVAL_DAYS` | no | Min days between reminders per member (default: `7`) |
| `TZ` | no | Server timezone for cron (e.g. `America/Guayaquil`) |

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Login → JWT |
| GET | `/api/admin/pending` | superadmin | List unapproved owners |
| POST | `/api/admin/approve/:id` | superadmin | Approve owner |
| DELETE | `/api/admin/reject/:id` | superadmin | Reject + delete owner |
| GET/POST/PUT | `/api/store` | store_owner | Store config + items |
| GET/POST/PUT/DELETE | `/api/cashiers` | store_owner | Cashier accounts |
| GET/POST/PUT/DELETE | `/api/members` | store_owner | Members |
| GET/POST/PUT/DELETE | `/api/membership-types` | store_owner | Membership plans |
| POST/GET | `/api/members/:id/payments` | store_owner | Record / list payments |
| POST | `/api/sales` | owner/cashier | Record a sale |
| GET | `/api/sales` | store_owner | List sales |
| GET | `/api/sales/summary` | store_owner | Revenue totals |
| POST | `/api/upload` | store_owner | Upload image |
| POST | `/api/reminders/send` | store_owner | Trigger overdue reminders |
| POST | `/api/kitchen/auth` | — | Kitchen PIN login |
| GET | `/api/kitchen/orders` | kitchen | Open orders |

---

## First Login

1. Start the backend
2. Open `/login.html` and register with the username set in `SUPERADMIN_USERNAME`
3. Log in — the account is auto-approved as superadmin
4. Go to `superadmin.html` to approve other store owners

---

## Deploy with nginx

```bash
cp docs/nginx.conf /etc/nginx/sites-available/poshive
# edit upstream port if needed
ln -s /etc/nginx/sites-available/poshive /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d pos.yourdomain.com
```

Useful commands:
```bash
systemctl status poshive
journalctl -u poshive -f
systemctl restart poshive
```

---

## License

MIT
