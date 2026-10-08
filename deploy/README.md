# Deploying ToolsHubs

Single-server layout behind nginx. Scale out later by adding API instances (PM2 cluster or more hosts behind the same nginx); all shared state lives in MongoDB and Redis.

```
/var/www/toolbox/
  backend/     API source (PM2 runs src/server.js on 127.0.0.1:5000)
  frontend/    contents of frontend/dist (static SPA, served by nginx)
  uploads/     local image uploads (only used when the Cloudinary toggle is OFF)
```

## 1. Prerequisites

| Component | Version | Notes |
|---|---|---|
| Node.js | 24 LTS (≥ 22.12) | `--env-file` and native `fetch` are required |
| MongoDB | 7 or 8 | Atlas, or self-hosted (a single-node replica set is recommended) |
| Redis | 7+ | OTPs, rate limits, cache invalidation, job locks |
| nginx | ≥ 1.25.1 | for `http2 on;` (see the comment in the config for older versions) |
| PM2 | latest | `npm i -g pm2` |

## 2. Directories and permissions

```bash
sudo mkdir -p /var/www/toolbox/{backend,frontend,uploads} /var/log/toolbox
sudo chown -R deploy:deploy /var/www/toolbox /var/log/toolbox   # "deploy" = the user PM2 runs as
sudo chmod 755 /var/www/toolbox/uploads                          # nginx needs read access
```

## 3. Backend

```bash
cd /var/www/toolbox/backend
npm ci --omit=dev
cp .env.example .env        # then edit it, see below
npm run db:sync-indexes     # builds all MongoDB indexes (unique constraints included)
ADMIN_EMAIL=you@company.com ADMIN_NAME="Your Name" npm run seed:admin   # prints a generated password once
pm2 start ../deploy/ecosystem.config.cjs --env production
pm2 save && pm2 startup
```

npm 12 blocks dependency install scripts by default. `argon2` and `sharp` ship prebuilt binaries and work without them. If your platform has no prebuild, run `npm install-scripts approve argon2` and reinstall.

### Production `.env` checklist

- `NODE_ENV=production`
- `CORS_ORIGINS=https://example.com` (required in production)
- Fresh secrets for `JWT_ACCESS_SECRET`, `JWT_ONBOARDING_SECRET`, `OTP_HMAC_SECRET` and `DATA_ENCRYPTION_KEY`. Never reuse development values.
- **Back up `DATA_ENCRYPTION_KEY`.** Vendor bank account numbers can't be decrypted without it.
- `SMS_PROVIDER=smsindiahub` with your API key, sender ID, route, DLT `ENTITY_ID`, `OTP_TEMPLATE_ID`, and `SMSINDIAHUB_OTP_TEMPLATE`. The template text must match the DLT-approved template exactly. The server refuses to start in production with the `console` provider.
- `LOCAL_UPLOAD_DIR` defaults to `/var/www/toolbox/uploads` in production.
- Optional: `CLOUDINARY_*` (needed before the admin can switch storage to Cloudinary), `RAZORPAY_*` (needed before online payments can be enabled) and `SHIPMOZO_PUBLIC_KEY` / `SHIPMOZO_PRIVATE_KEY` (needed before Shipmozo shipping can be enabled).

## 4. Frontend

```bash
cd frontend
npm ci
npm run build
rsync -a --delete dist/ /var/www/toolbox/frontend/
```

`VITE_API_URL` defaults to `/api/v1`, so the SPA and API share one origin through nginx.

## 5. nginx and TLS

```bash
sudo cp deploy/nginx/toolbox.conf /etc/nginx/sites-available/toolbox.conf
sudo cp deploy/nginx/toolbox-security-headers.conf deploy/nginx/toolbox-proxy.conf /etc/nginx/snippets/
sudo ln -s /etc/nginx/sites-available/toolbox.conf /etc/nginx/sites-enabled/
# replace example.com, then:
sudo certbot certonly --webroot -w /var/www/certbot -d example.com -d www.example.com
sudo nginx -t && sudo systemctl reload nginx
```

The config:
- serves the SPA, with `index.html` revalidated on every load and hashed assets cached for a year;
- proxies `/api` to the API, with tighter edge rate limits on OTP and admin login;
- serves `/uploads` straight from disk, `.webp` only;
- sets HSTS and a CSP that allows Razorpay Checkout and Cloudinary images.

## 6. Third-party setup

- **Razorpay:** create a webhook to `https://example.com/api/v1/webhooks/razorpay` with the events `payment.captured`, `payment.failed` and `order.paid`. Put its secret in `RAZORPAY_WEBHOOK_SECRET`. Enable auto-capture in the dashboard. Then turn on **Admin → Settings → Payments**.
- **Shipmozo:** copy the public/private keys from the Shipmozo panel profile into `SHIPMOZO_PUBLIC_KEY` / `SHIPMOZO_PRIVATE_KEY` (server only; `SHIPMOZO_BASE_URL` must not end with `/`). If you want automatic courier assignment, configure **Settings → Auto assign** in the Shipmozo panel first. Then enable **Admin → Settings → Shipping → Shipmozo** and use *Test connection*. Shipmozo's guide documents no webhooks, so tracking is polled every 10 minutes by the API's job runner.
- **SMSIndiaHub:** register the OTP template on DLT and copy the template ID and PE ID into `.env`.
- **Cloudinary:** add the credentials, then flip **Admin → Settings → Storage**. Existing local images keep working, because every file remembers where it was stored.

## 7. Deploying updates

```bash
git pull
(cd backend && npm ci --omit=dev && npm run db:sync-indexes)
pm2 reload toolshubs-api            # rolling restart, no downtime
(cd frontend && npm ci && npm run build && rsync -a --delete dist/ /var/www/toolbox/frontend/)
```

**One-off data steps** (run once, on the release that introduces them):

- Seller leads: `(cd backend && npm run db:backfill-cart-vendors)` tags existing cart lines with their seller, so carts saved before the Leads page existed show up there. Safe to re-run.

Open browser tabs keep running the old bundle until they navigate. If a lazy-loaded chunk has been removed, they show a "new version available, reload" screen.

## 8. Backups and monitoring

- `mongodump` daily, plus `rsync` of `/var/www/toolbox/uploads` if you use local storage.
- `curl -s localhost:5000/health/ready` returns `{"status":"ok"}` when MongoDB and Redis are connected. Wire it into your uptime monitor.
- Logs are JSON (pino) in `/var/log/toolbox/`. Every line carries the request ID that nginx sets.
