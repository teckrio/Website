#!/usr/bin/env node
/**
 * TEKRIO website server — pure Node.js (no external dependencies, since
 * this environment cannot reach the npm registry). Serves the built
 * static site from /public, accepts lead-form submissions into a local
 * JSON store, and exposes a minimal password-protected admin view of
 * captured leads.
 *
 * PENDING (documented in README.md): TEKRIO app/API connection for
 * OTP retailer/vendor login and automatic push of leads into the app's
 * own backend. Until that API exists, /portal/* routes show an
 * explanatory holding page instead of a broken login, and leads are
 * queued in data/leads.json (plus a webhook hook) ready to sync once
 * the API is available.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const CONFIG = require("./config.js");
const DATA_DIR = CONFIG.DATA_DIR ? path.resolve(CONFIG.DATA_DIR) : path.join(ROOT, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");

// leads.json holds customers' personal data: owner-only permissions
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, "[]", { mode: 0o600 });

const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

// ---------------------------------------------------------------------
// tiny in-process write queue so concurrent form submits never clobber
// each other's write to leads.json. Writes go to a temp file and are
// renamed into place, so a crash mid-write can't leave a truncated file.
// If the existing file can't be parsed we refuse to write rather than
// silently replacing (and losing) every earlier lead.
// ---------------------------------------------------------------------
let writeChain = Promise.resolve();
async function writeLead(record) {
  const raw = await fs.promises.readFile(LEADS_FILE, "utf8");
  let list;
  try {
    list = JSON.parse(raw || "[]");
  } catch (e) {
    throw new Error(`${LEADS_FILE} is not valid JSON; fix or move it aside`);
  }
  if (!Array.isArray(list)) throw new Error(`${LEADS_FILE} is not a JSON array`);
  list.push(record);
  const tmp = `${LEADS_FILE}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  await fs.promises.rename(tmp, LEADS_FILE);
  return record;
}
function appendLead(record) {
  const result = writeChain.then(() => writeLead(record));
  // keep the queue alive after a failed write; the caller still sees the error
  writeChain = result.catch(() => {});
  return result;
}
function readLeads() {
  return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8") || "[]");
}

// ---------------------------------------------------------------------
// simple per-IP rate limiter (in-memory) for the lead endpoints
// ---------------------------------------------------------------------
const RATE_WINDOW_MS = 60 * 1000;
function createRateLimiter(max) {
  const hits = new Map();
  // drop idle IPs so the map can't grow without bound
  setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of hits) {
      if (!times.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(ip);
    }
  }, RATE_WINDOW_MS).unref();
  const recent = (ip) => (hits.get(ip) || []).filter((t) => Date.now() - t < RATE_WINDOW_MS);
  return {
    // record a hit; true if this IP is now over the limit
    hit(ip) {
      const times = recent(ip);
      times.push(Date.now());
      hits.set(ip, times);
      return times.length > max;
    },
    // over the limit already, without recording anything
    blocked(ip) {
      return recent(ip).length >= max;
    },
  };
}
const leadLimiter = createRateLimiter(10); // lead submissions per IP per minute
const adminLoginLimiter = createRateLimiter(10); // failed admin logins per IP per minute

// The client IP. X-Forwarded-For is only trusted behind our own proxy, and
// then only its LAST entry: that's the one the proxy appended; anything to
// its left was sent by the client and can be forged.
function clientIp(req) {
  if (CONFIG.TRUST_PROXY && req.headers["x-forwarded-for"]) {
    const parts = String(req.headers["x-forwarded-for"]).split(",");
    const last = parts[parts.length - 1].trim();
    if (last) return last;
  }
  return req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------------
// lead schema validation per form type — mirrors the Section 5 brief:
//   Customer: Name, Mobile, City, Phone Brand/Model
//   Retailer: Store Name, Owner Name, Mobile, City, GST (optional)
//   Vendor:   Business Name, Mobile, City, GST/PAN  (shown as "Buyer" on the
//             site; kept as "vendor" to match the app backend's role name)
//   Sell:     website "Sell Your Device" journey — device fields use the
//             same names/values as the app backend's catalog so the request
//             can be turned into a device listing without remapping
// plus partner + contact, which the brief doesn't specify fields for.
// ---------------------------------------------------------------------
const SCHEMAS = {
  customer: {
    required: ["name", "mobile", "city", "device"],
    optional: [],
  },
  retailer: {
    required: ["storeName", "ownerName", "mobile", "city"],
    optional: ["gst"],
  },
  vendor: {
    required: ["businessName", "mobile", "city", "gstOrPan"],
    optional: [],
  },
  sell: {
    required: ["platform", "brand", "model", "storage", "name", "mobile", "city", "pincode"],
    optional: [
      "ram", "batteryHealth", "screenDamage", "bodyScratches", "deviceAge",
      "box", "bill", "charger", "catalogVersion",
    ],
  },
  partner: {
    required: ["name", "company", "mobile", "city", "partnershipType"],
    optional: ["message"],
  },
  contact: {
    required: ["name", "email", "mobile", "topic", "message"],
    optional: [],
  },
};

function isValidMobile(v) {
  return /^[6-9]\d{9}$/.test(String(v || "").trim());
}
function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function validateLead(type, body) {
  const schema = Object.prototype.hasOwnProperty.call(SCHEMAS, type) ? SCHEMAS[type] : null;
  if (!schema) return { ok: false, message: "Unknown form type." };
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid submission." };
  }
  if (body._hp) return { ok: false, message: "Rejected." }; // honeypot tripped

  for (const field of schema.required) {
    const v = body[field];
    if (!v || typeof v === "object" || !String(v).trim()) {
      return { ok: false, message: `Missing required field: ${field}.` };
    }
  }
  if (body.mobile && !isValidMobile(body.mobile)) {
    return { ok: false, message: "Enter a valid 10-digit Indian mobile number." };
  }
  if (body.email && !isValidEmail(body.email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (type === "sell") {
    if (!["apple", "android"].includes(body.platform)) {
      return { ok: false, message: "Select Apple or Android." };
    }
    if (!/^[1-9]\d{5}$/.test(String(body.pincode).trim())) {
      return { ok: false, message: "Enter a valid 6-digit pincode." };
    }
    if (body.batteryHealth && !/^(100|[1-9]?\d)$/.test(String(body.batteryHealth).trim())) {
      return { ok: false, message: "Battery health should be a number between 0 and 100." };
    }
  }

  const clean = {};
  [...schema.required, ...schema.optional].forEach((f) => {
    const v = body[f];
    if (v === undefined || v === null) return;
    if (typeof v === "object") return; // only plain values are accepted
    clean[f] = String(v).trim().slice(0, f === "message" ? 2000 : 200);
  });
  return { ok: true, data: clean };
}

// ---------------------------------------------------------------------
// PENDING: push a captured lead into the TEKRIO app/admin backend once
// that API exists. Configure CONFIG.APP_API_WEBHOOK_URL in config.js
// (or the TEKRIO_APP_API_WEBHOOK_URL env var) and this fires
// automatically; until then it's a documented no-op.
// ---------------------------------------------------------------------
function forwardToAppApi(record) {
  const url = CONFIG.APP_API_WEBHOOK_URL;
  if (!url) return; // pending — no API configured yet
  try {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? require("https") : http;
    const body = JSON.stringify(record);
    const req = lib.request(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...(CONFIG.APP_API_KEY
            ? { Authorization: `Bearer ${CONFIG.APP_API_KEY}` }
            : {}),
        },
      },
      (res) => res.resume()
    );
    req.on("error", (e) => console.error("[app-api] forward failed:", e.message));
    req.write(body);
    req.end();
  } catch (e) {
    console.error("[app-api] forward error:", e.message);
  }
}

// ---------------------------------------------------------------------
// device catalog for the website sell journey, proxied from the TEKRIO app
// backend's public GET /catalog (its CORS doesn't allow the website origin,
// and caching here keeps the page fast). Falls back to the last good copy,
// and the browser has its own minimal fallback if this returns an error.
// ---------------------------------------------------------------------
const CATALOG_TTL_MS = 60 * 60 * 1000;
let catalogCache = { data: null, fetchedAt: 0 };
const CATALOG_RETRY_MS = 60 * 1000; // after a failure, don't refetch per request
let catalogFailedAt = 0;
function fetchJson(url, timeoutMs = 5000, maxBytes = 2e6) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? require("https") : http;
    const req = lib.get(target, { timeout: timeoutMs }, (res) => {
      let raw = "";
      res.on("data", (c) => {
        raw += c;
        if (raw.length > maxBytes) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}
async function getCatalog() {
  if (catalogCache.data && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.data;
  }
  if (!catalogCache.data && Date.now() - catalogFailedAt < CATALOG_RETRY_MS) {
    throw new Error("catalog recently unavailable");
  }
  try {
    const json = await fetchJson(CONFIG.BACKEND_API_BASE_URL + "/catalog");
    if (!json || !json.data) throw new Error("unexpected catalog shape");
    catalogCache = { data: json.data, fetchedAt: Date.now() };
  } catch (e) {
    console.error("[catalog] fetch failed:", e.message);
    catalogFailedAt = Date.now();
    if (!catalogCache.data) throw e;
    catalogCache.fetchedAt = Date.now() - CATALOG_TTL_MS + CATALOG_RETRY_MS; // serve stale, retry soon
  }
  return catalogCache.data;
}

// ---------------------------------------------------------------------
// admin basic auth (credentials via config.js / env — see README)
// ---------------------------------------------------------------------
function checkBasicAuth(req) {
  if (!CONFIG.ADMIN_PASSWORD) return false; // admin disabled, never match ""
  const header = req.headers["authorization"] || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return (
    timingSafeEqual(user, CONFIG.ADMIN_USER) &&
    timingSafeEqual(pass, CONFIG.ADMIN_PASSWORD)
  );
}
// compare fixed-length digests so neither content nor length leaks via timing
function timingSafeEqual(a, b) {
  const hash = (v) => crypto.createHash("sha256").update(String(v)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}
function requireAuth(res) {
  if (!CONFIG.ADMIN_PASSWORD) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("Admin dashboard is disabled. Set TEKRIO_ADMIN_PASSWORD to enable it.");
  }
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="TEKRIO Admin"',
    "Content-Type": "text/plain",
  });
  res.end("Authentication required.");
}

// ---------------------------------------------------------------------
// static file serving (with basic path traversal protection)
// ---------------------------------------------------------------------
// Text files are compressed (Brotli, else gzip) once and kept in memory
// until the file changes; the whole site is well under 1 MB.
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".xml", ".txt", ".webmanifest"]);
const compressedCache = new Map(); // filePath -> { mtimeMs, br, gzip }
function compressed(filePath, stat, content, encoding) {
  let entry = compressedCache.get(filePath);
  if (!entry || entry.mtimeMs !== stat.mtimeMs) {
    entry = { mtimeMs: stat.mtimeMs };
    compressedCache.set(filePath, entry);
  }
  if (!entry[encoding]) {
    entry[encoding] =
      encoding === "br"
        ? zlib.brotliCompressSync(content, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
          })
        : zlib.gzipSync(content, { level: 9 });
  }
  return entry[encoding];
}
function pickEncoding(req) {
  const accept = String(req.headers["accept-encoding"] || "");
  if (/\bbr\b/.test(accept)) return "br";
  if (/\bgzip\b/.test(accept)) return "gzip";
  return null;
}

function sendFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const lastModified = stat.mtime.toUTCString();
  // assets aren't fingerprinted, so keep caching short enough that a
  // redeploy shows up within the hour; HTML always revalidates
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    "Last-Modified": lastModified,
    Vary: "Accept-Encoding",
  };
  const since = Date.parse(req.headers["if-modified-since"] || "");
  if (since && Math.floor(stat.mtimeMs / 1000) * 1000 <= since) {
    res.writeHead(304, headers);
    return res.end();
  }
  fs.readFile(filePath, (err, content) => {
    if (err) return serve404(res);
    const encoding = COMPRESSIBLE.has(ext) && content.length > 1024 ? pickEncoding(req) : null;
    let body = content;
    if (encoding) {
      body = compressed(filePath, stat, content, encoding);
      headers["Content-Encoding"] = encoding;
    }
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  });
}

// ---------------------------------------------------------------------
// static file serving (with basic path traversal protection)
// ---------------------------------------------------------------------
function serveStatic(req, res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0]);
  } catch (e) {
    return serve404(res); // malformed %-escape
  }
  if (rel.includes("\0")) return serve404(res);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // require the separator so a sibling like "public-old/" can't match
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(req, res, filePath, stat);
    // "/about" -> 301 to "/about.html", so each page has one URL
    fs.stat(filePath + ".html", (err2, stat2) => {
      if (err2 || !stat2.isFile()) return serve404(res);
      // build the target from the resolved file, never from the raw URL,
      // so a path like "//about" can't become a redirect to another host
      const target = "/" + path.relative(PUBLIC_DIR, filePath).split(path.sep).join("/") + ".html";
      res.writeHead(301, { Location: target });
      res.end();
    });
  });
}

function serve404(res) {
  const notFoundPath = path.join(PUBLIC_DIR, "404.html");
  fs.readFile(notFoundPath, (err, content) => {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      content ||
        "<h1>404 - Page not found</h1><p><a href='/'>Return to TEKRIO home</a></p>"
    );
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        // stop buffering and drain the rest, so we can still answer 413
        req.removeAllListeners("data");
        req.resume();
        reject(new Error("Payload too large"));
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------------
// portal placeholder page (retailer/vendor OTP login — pending API)
// ---------------------------------------------------------------------
function renderPortalPage(kind) {
  const label = kind === "retailer" ? "Retailer" : "Buyer";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label} Login | TEKRIO</title>
<link rel="icon" href="/images/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/images/favicon-192.png" type="image/png" sizes="192x192">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css"></head>
<body>
<div class="container" style="max-width:520px;padding-top:80px;padding-bottom:80px;">
  <a href="/" class="brand" style="color:var(--ink);margin-bottom:28px;display:inline-flex;">
    <span class="brand-mark" style="color:var(--ink);">TEKRIO</span>
  </a>
  <div class="form-card">
    <span class="pending-badge">Pending app/API connection</span>
    <h2 style="margin-top:14px;">${label} login is on its way</h2>
    <p class="form-sub">OTP login for ${label.toLowerCase()}s will redirect here to the TEKRIO ${label} app once that connection is live. Until the app/API integration is complete, please use the ${label.toLowerCase()} registration form and our onboarding team will reach out with next steps and early access.</p>
    <a href="/for-${kind}s.html#${kind === "retailer" ? "register" : "join"}" class="btn btn-gold btn-block">Go to ${label} Registration</a>
    <p class="form-note" style="margin-top:20px;">Already registered and need help? Email <a href="mailto:info@tekrio.in">info@tekrio.in</a>.</p>
  </div>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------
// admin dashboard (basic-auth protected, read-only view of leads.json)
// ---------------------------------------------------------------------
function renderAdminPage(leads) {
  const rows = leads
    .slice()
    .reverse()
    .map((l) => {
      const fields = Object.keys(l)
        .filter((k) => !["id", "type", "createdAt", "ip"].includes(k))
        .map((k) => `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(l[k])}`)
        .join("<br>");
      return `<tr>
        <td>${escapeHtml(new Date(l.createdAt).toLocaleString("en-IN"))}</td>
        <td><span class="pill">${escapeHtml(l.type)}</span></td>
        <td>${fields}</td>
      </tr>`;
    })
    .join("\n");

  const counts = leads.reduce((acc, l) => {
    acc[l.type] = (acc[l.type] || 0) + 1;
    return acc;
  }, {});
  const countCards = Object.entries(counts)
    .map(([type, n]) => `<div class="stat"><span class="num">${n}</span><span class="label">${escapeHtml(type)}</span></div>`)
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TEKRIO Admin — Leads</title>
<link rel="icon" href="/images/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/images/favicon-192.png" type="image/png" sizes="192x192">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<style>
table { width:100%; border-collapse: collapse; background:#fff; }
td { border-bottom:1px solid var(--line); padding:14px 12px; vertical-align:top; font-size:0.9rem; }
td:first-child { white-space:nowrap; color:var(--slate); font-size:0.82rem; }
.two-col.stats-row { grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); margin-bottom:32px; }
</style>
</head>
<body>
<div class="container" style="padding-top:48px;padding-bottom:64px;">
  <a href="/" class="brand" style="color:var(--ink);margin-bottom:20px;display:inline-flex;"><span class="brand-mark" style="color:var(--ink);">TEKRIO</span></a>
  <h1 style="font-size:1.8rem;">Admin — Captured Leads</h1>
  <p>Total leads: <strong>${leads.length}</strong>. This is a lightweight built-in view; leads also queue for the TEKRIO app/API sync once that connection is configured (see README.md).</p>
  <div class="two-col stats-row">${countCards || "<p>No leads yet.</p>"}</div>
  <table>
    <thead><tr><td><strong>Received</strong></td><td><strong>Type</strong></td><td><strong>Details</strong></td></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No submissions yet.</td></tr>'}</tbody>
  </table>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------
// request handler
// ---------------------------------------------------------------------
// Scripts only from our own origin (plus Google Analytics); styles allow
// inline because the pages use style="" attributes.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://www.google-analytics.com https://www.googletagmanager.com",
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...(CONFIG.IS_PRODUCTION
    ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
    : {}),
};

const server = http.createServer(async (req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  try {
    // fixed base: the Host header is client-controlled and may be malformed
    const pathname = new URL(req.url, "http://localhost").pathname;
    const ip = clientIp(req);

    // ---- lead capture API ----
    if (pathname.startsWith("/api/leads/") && req.method === "POST") {
      const type = pathname.replace("/api/leads/", "").trim();
      // Requiring JSON forces a CORS preflight for cross-site requests, which
      // this server never approves, so other sites can't post forms here.
      const contentType = String(req.headers["content-type"] || "").split(";")[0].trim();
      if (contentType !== "application/json") {
        return sendJson(res, 415, { message: "Unsupported content type." });
      }
      if (leadLimiter.hit(ip)) {
        return sendJson(res, 429, { message: "Too many submissions. Please try again in a minute." });
      }
      let raw;
      try {
        raw = await readBody(req);
      } catch (e) {
        res.setHeader("Connection", "close");
        return sendJson(res, 413, { message: "Request too large." });
      }
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch (e) {
        return sendJson(res, 400, { message: "Invalid submission." });
      }
      const result = validateLead(type, body);
      if (!result.ok) {
        return sendJson(res, 400, { message: result.message });
      }
      const record = {
        id: crypto.randomUUID(),
        type,
        ...result.data,
        createdAt: new Date().toISOString(),
        ip,
      };
      try {
        await appendLead(record);
      } catch (e) {
        console.error("Failed to save lead:", e);
        return sendJson(res, 500, { message: "Could not save your submission. Please try again." });
      }
      forwardToAppApi(record); // no-op until APP_API_WEBHOOK_URL is configured
      return sendJson(res, 200, {
        message: "Thanks! Our team will reach out shortly.",
        reference: record.id.slice(0, 8).toUpperCase(),
      });
    }

    // ---- device catalog (from the TEKRIO app backend) ----
    if (pathname === "/api/catalog" && req.method === "GET") {
      try {
        const data = await getCatalog();
        res.setHeader("Cache-Control", "public, max-age=300");
        return sendJson(res, 200, { data });
      } catch (e) {
        return sendJson(res, 503, { message: "Catalog unavailable." });
      }
    }

    // ---- admin dashboard ----
    const isAdmin = pathname === "/admin" || pathname === "/admin/";
    if (isAdmin || pathname === "/api/admin/leads") {
      // personal data: never cache, never index
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      // check the lockout before the password, so guesses stop being
      // evaluated at all once an IP is locked out
      if (adminLoginLimiter.blocked(ip)) {
        res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "60" });
        return res.end("Too many failed attempts. Try again in a minute.");
      }
      if (!checkBasicAuth(req)) {
        if (req.headers["authorization"]) adminLoginLimiter.hit(ip);
        return requireAuth(res);
      }
      if (isAdmin) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(renderAdminPage(readLeads()));
      }
      return sendJson(res, 200, readLeads());
    }

    // ---- portal placeholders (pending app/API + OTP login) ----
    if (pathname.startsWith("/portal/")) {
      // placeholder pages: keep them out of search results
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
    if (pathname === "/portal/retailer-login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPortalPage("retailer"));
    }
    if (pathname === "/portal/buyer-login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPortalPage("buyer"));
    }

    // ---- renamed pages (Vendor -> Buyer); keep old links working ----
    const MOVED = {
      "/portal/vendor-login": "/portal/buyer-login",
      "/for-vendors.html": "/for-buyers.html",
      "/for-vendors": "/for-buyers.html",
    };
    if (MOVED[pathname]) {
      res.writeHead(301, { Location: MOVED[pathname] });
      return res.end();
    }

    // ---- health check ----
    if (pathname === "/healthz") {
      return sendJson(res, 200, { status: "ok" });
    }

    // ---- static site ----
    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method not allowed");
  } catch (err) {
    console.error("Unhandled error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal server error");
  }
});

// cut off slow/idle clients (slowloris) well before Node's 5-minute default
server.requestTimeout = 30 * 1000;
server.headersTimeout = 15 * 1000;

server.listen(PORT, () => {
  console.log(`TEKRIO server running at http://localhost:${PORT}`);
  console.log(`Leads file: ${LEADS_FILE}`);
  if (CONFIG.ADMIN_PASSWORD) {
    console.log(`Admin dashboard: http://localhost:${PORT}/admin (user: ${CONFIG.ADMIN_USER})`);
  } else {
    console.warn("Admin dashboard disabled: set TEKRIO_ADMIN_PASSWORD to enable /admin.");
  }
});

// let the process manager / platform stop us cleanly (finish in-flight
// requests, including a pending leads.json write)
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => writeChain.finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
