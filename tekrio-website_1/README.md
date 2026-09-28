# TEKRIO Website

Marketing website + lead-capture backend for **TEKRIO** (www.tekrio.in), an
initiative by **Anabriya Technologies LLP**. Built from
`TEKRIO_Website_Content.pdf` (the developer brief).

Zero external npm dependencies — the whole server runs on Node's built-in
`http`/`fs` modules. This was a deliberate choice for this build: this
environment's npm registry access was blocked, so a dependency-free server
guarantees it runs anywhere with plain Node 18+, no `npm install` required.
If you'd rather use Express, drop-in swapping is straightforward since the
routes in `server.js` are already organized by concern.

## What's included (done, working)

- **All 10 pages** from the brief: Home, About, How It Works, For
  Customers, For Retailers, For Buyers (formerly For Vendors), Partner
  With Us, Contact, FAQ, Privacy Policy & Terms.
- **Sell Your Device** (`/sell.html`): a guided journey (Select Device ->
  Add Details -> Get Offers -> Choose Offer -> Complete Transaction). Its
  storage/RAM/condition options come live from the TEKRIO app backend's
  public `GET /catalog` (proxied and cached for 1 hour at `/api/catalog`,
  with a built-in fallback), so the website and the retailer app describe
  devices identically. Submissions are saved as `sell` leads.
- **Terminology:** the three sides are Customer | Retailer | Buyer. Old
  `/for-vendors.html` and `/portal/vendor-login` URLs 301-redirect to the
  Buyer equivalents. Internally the lead type stays `vendor` to match the
  app backend's role name.
- **Homepage content matches the brief's exact copy** (headline,
  sub-headline, CTAs, 3-step process, 3-audience section, trust section,
  final CTA, footer).
- **Working lead-capture forms** for all three registration types plus
  Contact and Partner enquiries, with:
  - client-side validation (required fields, 10-digit Indian mobile,
    email, GSTIN/PAN format) in `public/js/main.js`
  - server-side validation and honeypot spam trap in `server.js`
  - submissions saved to `data/leads.json`
  - a basic-auth-protected **/admin** dashboard to view captured leads
    (`/api/admin/leads` for the raw JSON)
  - rate limiting (10 submissions/minute/IP) against form abuse
- **SEO**: per-page title tags & meta descriptions (homepage matches the
  brief's exact SEO section), canonical URLs, Open Graph tags,
  Organization JSON-LD schema, auto-generated `sitemap.xml` and
  `robots.txt`.
- **Analytics-ready**: a GA4 loader (`public/js/analytics.js`) that only
  activates once you paste in a real Measurement ID — see Pending below.
- **Responsive, accessible**: mobile nav, keyboard focus states,
  `prefers-reduced-motion` support, semantic HTML, skip-to-content link.
- **A simple templating build** (`scripts/build.js`) so header/footer/meta
  live in one place instead of being copy-pasted across 10 files — the
  closest thing to a lightweight CMS without a real backend (see Pending).

## Pending (needs the TEKRIO app/API — intentionally left as configurable placeholders)

As requested, everything that depends on the **TEKRIO mobile app's own
backend/API** (which doesn't exist yet) is stubbed cleanly rather than
faked:

1. **Retailer and Buyer accounts.** Retailers and buyers use the separate
   TEKRIO apps; this website only registers them. The backend only lets an
   Admin create accounts (`POST /managers`, `POST /vendors`), so the TEKRIO
   team verifies each registration from `/admin`, creates the account and
   emails the app login. The old `/portal/*-login` URLs redirect to the
   registration forms.
2. **Pushing leads into the app/admin backend automatically.** Every lead
   is saved locally to `data/leads.json` and shown in `/admin` today.
   `server.js` already has a `forwardToAppApi()` hook that will POST every
   new lead as JSON to your app's webhook the moment you set two
   environment variables (see `config.js`):
   ```
   TEKRIO_APP_API_WEBHOOK_URL=https://your-app-backend/api/leads/webhook
   TEKRIO_APP_API_KEY=your-bearer-token   # optional
   ```
   No code changes needed — just set the variables and restart.
3. **Sell requests -> app backend.** The backend currently has no public
   endpoint for customer sell requests (`POST /devices` needs a Store
   Manager login, a `branchId` and both IMEIs). Sell requests are stored
   locally and sent through the webhook above; once the backend adds an
   intake endpoint, point `TEKRIO_APP_API_WEBHOOK_URL` at it. The request's
   device fields (`platform`, `model`, `storage`, `ram`, `batteryHealth`,
   `screenDamage`, `bodyScratches`, `deviceAge`, `box`, `bill`, `charger`)
   already use the backend catalog's names and values.
4. **Retailer listing / buyer offers UI.**
   These are described on the Retailer/Buyer pages as product features of
   the app itself (marked with an amber "pending" badge), not built as
   part of this website, since they belong to the app's own UI.

Everything else in the original brief has been built for real.

## Partially covered / needs a decision from you

- **CMS.** The brief asked for a CMS so the team can edit text without a
  developer. A full CMS (e.g. a headless CMS like Strapi/Sanity, or a
  WordPress rebuild) is a separate infrastructure decision — it wasn't
  built here since it wasn't blocked on the app API, but it's a bigger
  scope than "the rest of this brief." As a practical middle ground,
  **all page copy lives in `content/pages/*.html`** and **all page
  titles/meta live in `scripts/pages.config.js`** — a non-developer
  comfortable editing HTML/text can update copy directly, then run
  `npm run build`. If you want a true no-code CMS, say the word and it can
  be layered on top of this same site.
- **Hosting, domain, SSL.** The code is ready to deploy (see below), but
  actually pointing `www.tekrio.in` at a server, obtaining SSL, and
  configuring backups depends on your hosting account.
- **Google Analytics / Search Console.** Both are wired up and switch on
  via environment variables (see below) — creating those properties
  requires your Google account.

## Project structure

```
tekrio/
├── content/pages/       # page copy fragments (edit these for text changes)
├── templates/           # shared header/footer/page shell
├── scripts/
│   ├── build.js         # stitches templates + content -> /public
│   └── pages.config.js  # per-page title/description/meta
├── public/               # BUILT output — served as-is by server.js
│   ├── css/style.css
│   ├── js/{main.js,analytics.js}
│   ├── images/
│   └── *.html, sitemap.xml, robots.txt
├── data/leads.json       # captured leads (auto-created, git-ignored)
├── config.js             # all settings, read from environment variables
├── server.js             # zero-dependency Node HTTP server
├── Dockerfile            # container build for Docker-based hosts
└── .env.example          # every environment variable, documented
```

Edit content in `content/pages/` or styles in `public/css/style.css`,
then run `npm run build` (only needed after editing `content/` or
`scripts/`; CSS/JS edits under `public/` take effect immediately).

## Running it

```bash
npm start         # builds /public from content/ + templates/, then serves
                  # the site on http://localhost:3000
npm run serve     # serve only, without rebuilding
```

Visit `http://localhost:3000`. Locally, the admin dashboard at
`http://localhost:3000/admin` uses `admin` / `tekrio-admin-dev`. With
`NODE_ENV=production` there is **no default password**: `/admin` stays
disabled until `TEKRIO_ADMIN_PASSWORD` is set.

### Configuration (environment variables)

See `.env.example` for a ready-to-copy list.

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | set to `production` on the live server | unset |
| `PORT` | server port | `3000` |
| `TEKRIO_ADMIN_USER` | `/admin` username | `admin` |
| `TEKRIO_ADMIN_PASSWORD` | `/admin` password (**required** in production to enable `/admin`) | dev only: `tekrio-admin-dev` |
| `TEKRIO_DATA_DIR` | folder for `leads.json`; use a persistent disk | `./data` |
| `TEKRIO_TRUST_PROXY` | `true` when behind Nginx/Caddy/a platform proxy, so rate limiting uses the real client IP | `false` |
| `TEKRIO_GA_ID` | GA4 Measurement ID, applied at build time | unset (analytics off) |
| `TEKRIO_GSC_VERIFICATION` | Search Console verification token, applied at build time | unset |
| `TEKRIO_BACKEND_API_BASE_URL` | TEKRIO app backend (device catalog) | Railway production URL |
| `TEKRIO_APP_API_WEBHOOK_URL` | pending — see above | unset (no-op) |
| `TEKRIO_APP_API_KEY` | pending — see above | unset |

## Deployment

### Pre-launch checklist

- [ ] `NODE_ENV=production` and a strong `TEKRIO_ADMIN_PASSWORD` set
- [ ] `TEKRIO_DATA_DIR` on storage that survives redeploys, with backups
- [ ] `TEKRIO_TRUST_PROXY=true` if (and only if) behind a reverse proxy
- [ ] HTTPS working for `www.tekrio.in`, and `tekrio.in` redirecting to it
- [ ] `TEKRIO_GA_ID` / `TEKRIO_GSC_VERIFICATION` set if analytics is wanted
- [ ] Privacy Policy & Terms reviewed by legal counsel (see Legal note)
- [ ] `/healthz` returns `{"status":"ok"}` and a test sell request shows in `/admin`

### Option A: a VM (AWS EC2 / DigitalOcean Droplet)

1. Provision a small VM (e.g. a DigitalOcean Droplet or AWS EC2
   `t3.micro`) and install Node 18+.
2. Copy this project to the server and create a `.env` from
   `.env.example` (or export the variables in your process manager).
3. Run it under a process manager so it restarts on crash/reboot:
   ```bash
   pm2 start npm --name tekrio -- start
   pm2 save && pm2 startup
   ```
4. Put Caddy (or Nginx) in front as a reverse proxy to `localhost:3000`.
   Caddy obtains the SSL certificate automatically:
   ```
   www.tekrio.in {
     reverse_proxy localhost:3000
   }
   tekrio.in {
     redir https://www.tekrio.in{uri} permanent
   }
   ```
5. Point the domain's DNS `A` records at the server.
6. Back up `leads.json` in `TEKRIO_DATA_DIR` regularly (or migrate it to
   a managed database once lead volume grows — the storage layer in
   `server.js` is isolated behind `appendLead()` so swapping it out later
   is a small, contained change).

### Option B: Docker / container platforms (Railway, Render, Fly.io)

```bash
docker build -t tekrio-website .
docker run -d -p 3000:3000 -v tekrio-data:/data \
  -e TEKRIO_ADMIN_PASSWORD=<strong-password> -e TEKRIO_TRUST_PROXY=true \
  tekrio-website
```

On a platform, attach a **persistent volume at `/data`**: these hosts
wipe the app's own filesystem on every redeploy, which would delete all
captured leads.

## Security

Built into `server.js`:

- `/admin` has no default password in production, and each IP is locked
  out for a minute after 10 failed logins. Admin responses are sent
  `no-store` / `noindex`.
- Content-Security-Policy (no inline or third-party scripts except Google
  Analytics), HSTS in production, clickjacking and MIME-sniffing headers.
- Lead forms: JSON-only (so other sites can't post into them), 16 KB body
  limit, per-field length caps, unknown fields dropped, 10 submissions per
  IP per minute. `X-Forwarded-For` is only trusted with
  `TEKRIO_TRUST_PROXY=true`, and then only its last (proxy-added) entry.
- `leads.json` is written atomically with owner-only permissions (0600),
  and the server refuses to overwrite it if it's ever corrupted, rather
  than losing earlier leads.
- Static files can't be read outside `public/`; slow clients time out
  after 15 s (headers) / 30 s (request).

Also keep the Node runtime patched (`node:20-alpine` in the Dockerfile
picks up fixes on rebuild) and serve the site only over HTTPS.

## Turning on Analytics & Search Console

1. Create a GA4 property for `www.tekrio.in` and set its Measurement ID
   (`G-...`) as `TEKRIO_GA_ID`.
2. Create a Google Search Console property for `www.tekrio.in` using the
   "HTML tag" method and set the token from its `content="..."` as
   `TEKRIO_GSC_VERIFICATION`.
3. Restart with `npm start` (it rebuilds the pages with both applied).
   Submit `https://www.tekrio.in/sitemap.xml` in Search Console once live.

## Form fields captured (per the brief's Section 5)

| Form | Fields |
|---|---|
| Sell (`/sell.html`) | Platform, Brand, Model, Storage, RAM, Screen/Body condition, Device age, Battery health, Box/Bill/Charger, Name, Mobile, City, Pincode |
| Retailer (`/for-retailers.html`) | Store Name, Owner Name, Email, Mobile, City, Store Address, GSTIN (optional) |
| Buyer (`/for-buyers.html`) | Business Name, Contact Person, Email, Mobile, City, GST/PAN |
| Partner (`/partner.html`) | Name, Company, Mobile, City, Partnership Type, Message |
| Contact (`/contact.html`) | Name, Email, Mobile, Topic, Message |

## Legal note

`content/pages/privacy-terms.html` is a plain-language starting draft
written for this build. Anabriya Technologies LLP should have it reviewed
by legal counsel before go-live, particularly for compliance with India's
Digital Personal Data Protection Act, 2023.
