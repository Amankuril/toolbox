# ToolsHubs

A multi-vendor marketplace for tools, machinery and spare parts, with three modules:

| Module | URL | Who | Sign-in |
|---|---|---|---|
| **Storefront** (user) | `/` | Buyers | Mobile OTP; new numbers go through onboarding |
| **Seller panel** (vendor) | `/vendor` | Vendors | Mobile OTP, then a setup wizard and admin approval |
| **Admin panel** | `/admin` | Operations team | Email and password |

Vendors onboard first. Once approved, they list **tools, machinery and spare parts**. Every product belongs to a category in one shared three-level tree. Vendors can propose new categories, and admins approve them. Spare parts link to the machines they fit, so a machine's page lists its parts. Admins can see and manage everything.

## Stack

- **API:** Node 24, Express 5, MongoDB (Mongoose 9), Redis, Zod, pino. Plain JavaScript (ESM).
- **Web:** React 19, Vite, React Router 8, TanStack Query, Zustand, React Hook Form + Zod, Tailwind CSS 4, Radix primitives.
- **Integrations:** SMSIndiaHub (OTP SMS), Razorpay (payments), Cloudinary or local disk (images, always converted to WebP).

## Repository layout

```
backend/
  src/
    config/        env (validated with zod at boot), db, redis, logger
    core/          errors, middlewares (validate, rateLimit, upload), cache, utils
    services/      centralised integrations, each behind a provider interface
      storage/     sharp → WebP, then Cloudinary or local disk (admin toggle)
      sms/         SMSIndiaHub | console (dev)
      payment/     Razorpay
      otp/ token/ settings/
    modules/       one folder per domain: model · validation · service · routes
      auth admins users vendors categories products media cart orders quotes banners settings dashboard
    routes/        mounts /api/v1/{auth,public,user,vendor,admin}
    jobs/          interval jobs (expire unpaid orders and stale quotes) with a Redis lock
  scripts/         seed-admin, seed-catalog (dev), sync-indexes
  tests/           integration tests (in-memory MongoDB, real Redis)
frontend/
  src/
    app/           router (each module lazy-loaded), providers, error pages
    core/          API client per audience, sessions, theme engine, payments, lib
    ui/            design system (Button, Field, Dialog, DataTable, ImageUploader, ColumnChart…)
    modules/
      user/        storefront
      vendor/      seller panel
      admin/       admin panel
      shared/      pieces used by more than one module (order items, statuses)
deploy/            nginx config, PM2 ecosystem, deployment guide
```

## Running locally

You need **Node 24**, **MongoDB** and **Redis** running locally (or connection URLs to remote ones).
No MongoDB installed? After `npm install` in `backend`, run `npm run db:local`. It starts the mongod that the tests download, with data kept in `backend/.data/mongo` (git-ignored). Run it again after a reboot.

```bash
# API
cd backend
npm install
cp .env.example .env      # set MONGODB_URI and generate the four secrets (commands are in the file)
npm run seed:catalog      # optional: demo categories, a seller, products and banners
ADMIN_EMAIL=admin@toolshubs.local ADMIN_PASSWORD='Admin@12345' npm run seed:admin
npm run dev               # http://localhost:5000

# Web (second terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173  (proxies /api and /uploads to :5000)
```

With `SMS_PROVIDER=console` (the dev default), OTPs are printed in the API log instead of being texted.

| Script | Where | What |
|---|---|---|
| `npm run dev` | both | dev servers (API restarts on change) |
| `npm test` | backend | integration tests: auth, onboarding, catalogue, media, cart, orders, payments, bulk pricing and quotes |
| `npm run lint` | both | ESLint |
| `npm run build` | frontend | production bundle in `dist/` |
| `npm run db:sync-indexes` | backend | create or update MongoDB indexes (run on every deploy) |
| `npm run db:local` | backend | start a local dev MongoDB on :27017 (`-- --stop` to stop it) |

## How things work

**Authentication**
- An OTP is stored as a hash in Redis for 5 minutes. Resends have a 45 s cooldown. 5 wrong codes lock the number for 15 minutes, and there are hourly limits per phone and per IP.
- An existing account is signed in. A new number gets a 20-minute onboarding token that can only be exchanged for a new account in the same module.
- Access tokens last 15 minutes and are held in memory. Refresh tokens are httpOnly cookies scoped to `/api/v1/auth/<module>`. They rotate on every use, and reusing an old one revokes the whole session family.
- Each module has its own session, so one browser can be signed in as buyer, seller and admin at once.
- Admin passwords use argon2id, with lockout after 5 failures.

**Centralised services** (`backend/src/services`). Every upload, SMS and payment goes through one service with swappable providers.
- **Storage:** each upload is magic-byte checked, auto-rotated, stripped of EXIF data, resized to 1600px at most and encoded as WebP.
  - **Admin → Settings → Storage** picks the destination: ON stores to Cloudinary, OFF stores on local disk (`backend/uploads` in dev, `/var/www/toolshubs/uploads` served by nginx in production).
  - Each file records its provider, so flipping the toggle never breaks existing images.
  - Clients send only media IDs; the server resolves URLs and checks ownership.
- **Payments:** Razorpay orders, signature verification, idempotent webhooks, refunds on item cancellation, and recovery from late payments.

**Dynamic theming.** In **Admin → Settings → Appearance**, the admin picks primary, secondary and accent colours plus corner radius, separately for the storefront, the seller panel and the admin panel.
- The UI derives hover and tint shades with `color-mix`, and picks readable text colour from WCAG contrast.
- Changes apply to every visitor right after saving. The last theme is cached so pages don't flash the default colours.

**Branding.** In **Admin → Settings → Branding**, each module (storefront, seller panel, admin panel) gets its own logo and browser-tab icon. Tab icons are fitted to 256×256 WebP. Each logo is designed for its module's main surface; where it appears on the opposite background (e.g. the storefront's dark footer), it sits on a plate of its own colour.

**Bulk buying.** Two layers, as on B2B marketplaces:
- **Quantity tiers.** A seller sets up to 5 price breaks per product (e.g. 10+ at ₹1,399, 100+ at ₹1,199), optionally for business buyers only. `backend/src/modules/products/pricing.js` is the single pricing engine: the cart, checkout and order lines all use it, and order lines record which tier applied.
- **Quotes (RFQ).** Above the quote threshold, a buyer requests a price for their quantity. The seller replies with a unit price valid for 3–30 days, and can revise it. Accepting puts a locked cart line at that price; placing the order consumes the quote. If an online payment times out, the quote returns to *accepted* while still valid. A job expires stale offers every 5 minutes.

**Moderation.** Vendors, vendor-proposed categories and products wait for admin approval. Each has an auto-approve switch. Editing a live product's content sends it back to review; price and stock edits don't. Suspending a vendor hides their products and signs them out.

**Orders**
- Stock is reserved atomically at checkout.
- Unpaid online orders release their stock after 30 minutes. A payment that arrives after expiry re-reserves the stock, or is refunded if it's gone.
- Each order line belongs to one vendor and moves through pending → confirmed → packed → shipped → delivered.
- COD orders become "paid" once every remaining line is delivered.

**Money** is always an integer number of **paise**, both in the API and the database. The UI converts only for display and input.

## Production

See **[deploy/README.md](deploy/README.md)**: nginx, TLS, PM2 cluster, environment checklist, Razorpay webhook, SMSIndiaHub DLT setup, backups.
