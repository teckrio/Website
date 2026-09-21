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
  Customers, For Retailers, For Vendors, Partner With Us, Contact, FAQ,
  Privacy Policy & Terms.
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

1. **Retailer/Vendor OTP login.** `/portal/retailer-login` and
   `/portal/vendor-login` currently show an honest holding page
   ("login is on its way") instead of a broken or fake login form, with a
   link to the registration form instead. Once the app exposes an OTP
   login/redirect URL, replace the two routes in `server.js`
   (`renderPortalPage`) with a redirect to that URL.
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
3. **"30-second listing in the TEKRIO app" / "live vendor bidding" UI.**
   These are described on the Retailer/Vendor pages as product features of
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
  configuring backups depends on your AWS/DigitalOcean account
  credentials, which weren't available here.
- **Google Analytics / Search Console.** The loader and a verification
  meta-tag slot are wired up and inert until you supply real IDs (see
  below) — creating those properties requires your Google account.

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
├── data/leads.json       # captured leads (auto-created)
├── config.js             # admin credentials + pending app-API settings
└── server.js             # zero-dependency Node HTTP server
```

Edit content in `content/pages/` or styles in `public/css/style.css`,
then run `npm run build` (only needed after editing `content/` or
`scripts/`; CSS/JS edits under `public/` take effect immediately).

## Running it

```bash
npm run build     # generates /public/*.html from content/ + templates/
npm start         # serves the site on http://localhost:3000
# or: npm run dev # build + start in one step
```

Visit `http://localhost:3000`. Admin dashboard: `http://localhost:3000/admin`
(default credentials below — change them before deploying).

### Configuration (environment variables)

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | server port | `3000` |
| `TEKRIO_ADMIN_USER` | `/admin` username | `admin` |
| `TEKRIO_ADMIN_PASSWORD` | `/admin` password | `tekrio-admin-2026` (**change this**) |
| `TEKRIO_APP_API_WEBHOOK_URL` | pending — see above | unset (no-op) |
| `TEKRIO_APP_API_KEY` | pending — see above | unset |

## Deployment (AWS / DigitalOcean, as the brief specifies)

1. Provision a small VM (e.g. a DigitalOcean Droplet or AWS EC2
   `t3.micro`), install Node 18+.
2. Copy this project to the server, run `npm run build`.
3. Run the server under a process manager, e.g.:
   ```bash
   TEKRIO_ADMIN_PASSWORD=<strong-password> \
   npm start
   # or with pm2:
   pm2 start server.js --name tekrio -- 
   ```
4. Put Nginx (or Caddy) in front of it as a reverse proxy to `localhost:3000`
   and obtain a free SSL certificate for `www.tekrio.in` via Let's Encrypt
   (Certbot). Caddy will do this automatically with a two-line config.
5. Point the domain's DNS `A`/`CNAME` records at the server.
6. Set up automated backups of `data/leads.json` (or migrate it to a
   managed database once lead volume grows — the storage layer in
   `server.js` is isolated behind `appendLead()` so swapping it out later
   is a small, contained change).

## Turning on Analytics & Search Console

1. Create a GA4 property for `www.tekrio.in`, copy its Measurement ID
   (`G-XXXXXXXXXX`).
2. In `templates/_shell.html`, replace `G-XXXXXXXXXX` in the
   `window.__TEKRIO_GA_ID` line with the real ID, then `npm run build`.
3. Create a Google Search Console property for `www.tekrio.in`, and paste
   its verification `<meta>` tag into `templates/_shell.html` where marked,
   then `npm run build`. Submit `https://www.tekrio.in/sitemap.xml` in
   Search Console once live.

## Form fields captured (per the brief's Section 5)

| Form | Fields |
|---|---|
| Customer (`/for-customers.html`) | Name, Mobile, City, Phone Brand/Model |
| Retailer (`/for-retailers.html`) | Store Name, Owner Name, Mobile, City, GSTIN (optional) |
| Vendor (`/for-vendors.html`) | Business Name, Mobile, City, GST/PAN |
| Partner (`/partner.html`) | Name, Company, Mobile, City, Partnership Type, Message |
| Contact (`/contact.html`) | Name, Email, Mobile, Topic, Message |

## Legal note

`content/pages/privacy-terms.html` is a plain-language starting draft
written for this build. Anabriya Technologies LLP should have it reviewed
by legal counsel before go-live, particularly for compliance with India's
Digital Personal Data Protection Act, 2023.
