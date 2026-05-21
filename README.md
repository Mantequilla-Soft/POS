# POSHIVE

Multi-tenant Point of Sale for the Hive blockchain — accepts HBD, cash, and Bitcoin Lightning. Includes optional membership/subscription management for gyms, clubs, and any business with recurring fees.

## Features

- **Multi-tenant** — each authorized store owner gets their own isolated store
- **Hive blockchain payments** — HBD transfers via QR code with automatic confirmation polling
- **Bitcoin Lightning** — optional, via v4v.app integration
- **Membership management** — track members, dues, payment history (per-store opt-in)
- **Role system** — superadmin approves store owners; store owners manage their own cashiers
- **Self-hostable** — runs on any VPS with Node.js + MongoDB; fully configurable via `.env`
- **PWA** — installable on mobile and desktop

## Project Structure

```
POSHIVE/
├── backend/              Node.js + Express API
│   ├── server.js
│   ├── .env.example
│   ├── middleware/       JWT auth
│   ├── models/           Mongoose schemas
│   ├── routes/           API endpoints
│   └── deploy/           systemd + nginx examples
├── pos.html              Point of Sale (cashier view)
├── quick-sale.html       Quick HBD payment / QR generator
├── members.html          Membership management
├── dashboard.html        Store owner dashboard
├── admin.html            Store settings, items, cashiers
├── superadmin.html       Platform admin — approve/reject store owners
├── login.html            Login + registration (awaits approval)
├── reviewreceipts.html   Receipt viewer
├── manifest.json         PWA manifest
└── service-worker.js     PWA service worker
```

## Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env — set MONGODB_URI, JWT_SECRET, SUPERADMIN_USERNAME
npm install
npm start
```

### .env reference

| Variable | Description |
|---|---|
| `PORT` | Port to listen on (default: 3001) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing JWTs — use a long random string |
| `JWT_EXPIRY` | Token lifetime (default: `7d`) |
| `CORS_ORIGIN` | Allowed origin(s), or `*` for open access |
| `SUPERADMIN_USERNAME` | This username gets superadmin on first login |

### Deploy with systemd + nginx

Copy `backend/deploy/hive-pos-backend.service` to `/etc/systemd/system/`, update the paths, then:

```bash
sudo systemctl enable hive-pos-backend
sudo systemctl start hive-pos-backend
```

Use `backend/deploy/nginx-site.conf` as a starting point for your reverse proxy config.

## Frontend Setup

Open `admin.html` → Store Settings → set **API Server URL** to your backend (e.g. `https://api.yourdomain.com`). This is saved in `localStorage` and used by all pages.

## First Login

1. Start the backend
2. Register an account using the username set in `SUPERADMIN_USERNAME`
3. Log in — the account is auto-approved and promoted to superadmin
4. Navigate to `superadmin.html` to approve other store owners

## License

MIT
