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
// sell-request photos: the same six sides store managers photograph in
// the app. The browser shrinks each to a JPEG (which also drops location
// metadata) and sends it with the form as a data: URL; they're kept beside
// leads.json in photos/<lead id>/<slot>.jpg, shown in /admin and passed on
// to the app backend.
// ---------------------------------------------------------------------
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
const PHOTO_SLOTS = ["front", "back", "top", "bottom", "left", "right"];
const REQUIRED_PHOTO_SLOTS = ["front", "back"];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // one shrunk photo is ~150-400 KB
const SELL_BODY_MAX_BYTES = 10 * 1024 * 1024; // six photos as base64 + the form
const LEAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function photoPath(leadId, slot) {
  return path.join(PHOTOS_DIR, leadId, `${slot}.jpg`);
}
// -> { ok, photos: { slot: Buffer } } or { ok: false, message }
function parsePhotos(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Add photos of the front and back of your device." };
  }
  const photos = {};
  for (const [slot, value] of Object.entries(raw)) {
    if (!PHOTO_SLOTS.includes(slot)) return { ok: false, message: "Unknown photo." };
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/.exec(typeof value === "string" ? value : "");
    const bytes = match ? Buffer.from(match[1], "base64") : null;
    // JPEG files start FF D8 FF; anything else isn't a photo the browser made
    if (!bytes || bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return { ok: false, message: `The ${slot} photo couldn't be read. Please choose it again.` };
    }
    if (bytes.length > MAX_PHOTO_BYTES) {
      return { ok: false, message: `The ${slot} photo is too large. Please choose it again.` };
    }
    photos[slot] = bytes;
  }
  const missing = REQUIRED_PHOTO_SLOTS.find((slot) => !photos[slot]);
  if (missing) return { ok: false, message: `Add a photo of the ${missing} of your device.` };
  return { ok: true, photos };
}
async function savePhotos(leadId, photos) {
  const dir = path.join(PHOTOS_DIR, leadId);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await Promise.all(
    Object.entries(photos).map(([slot, bytes]) => fs.promises.writeFile(photoPath(leadId, slot), bytes, { mode: 0o600 }))
  );
  return PHOTO_SLOTS.filter((slot) => photos[slot]); // stored in slot order
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
const offerLimiter = createRateLimiter(30); // offer page lookups/accepts per IP per minute

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
    required: ["platform", "brand", "model", "storage", "imei1", "imei2", "name", "mobile", "email", "address", "city", "pincode"],
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
    if (body.platform === "android" && !String(body.ram || "").trim()) {
      return { ok: false, message: "Missing required field: ram." };
    }
    if (!/^[1-9]\d{5}$/.test(String(body.pincode).trim())) {
      return { ok: false, message: "Enter a valid 6-digit pincode." };
    }
    if (body.batteryHealth && !/^(100|[1-9]?\d)$/.test(String(body.batteryHealth).trim())) {
      return { ok: false, message: "Battery health should be a number between 0 and 100." };
    }
    const imei1 = String(body.imei1).trim();
    const imei2 = String(body.imei2).trim();
    if (!/^\d{15}$/.test(imei1) || !/^\d{15}$/.test(imei2)) {
      return { ok: false, message: "Enter both 15-digit IMEI numbers." };
    }
    if (imei1 === imei2) {
      return { ok: false, message: "IMEI 2 must be different from IMEI 1." };
    }
  }

  const clean = {};
  [...schema.required, ...schema.optional].forEach((f) => {
    const v = body[f];
    if (v === undefined || v === null) return;
    if (typeof v === "object") return; // only plain values are accepted
    const maxLength = { message: 2000, address: 500 }[f] || 200;
    clean[f] = String(v).trim().slice(0, maxLength);
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
// TEKRIO app backend: website endpoints, authenticated with the shared
// TEKRIO_BACKEND_API_KEY (no admin account involved). Resolves with the
// backend's status and parsed JSON body; rejects only on network errors.
// A Buffer body is sent as-is (photos); anything else as JSON.
// ---------------------------------------------------------------------
function backendRequest(method, endpoint, payload, { contentType, timeoutMs = 8000, maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(CONFIG.BACKEND_API_BASE_URL.replace(/\/$/, "") + endpoint);
    const lib = target.protocol === "https:" ? require("https") : http;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
    const req = lib.request(
      target,
      {
        method,
        timeout: timeoutMs,
        headers: {
          "Content-Type": contentType || "application/json",
          "Content-Length": body.length,
          "X-Api-Key": CONFIG.BACKEND_API_KEY,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
          if (raw.length > maxBytes) req.destroy(new Error("response too large"));
        });
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (e) {
            // non-JSON (proxy error page etc.): status alone tells the story
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
const postBackend = (endpoint, payload) => backendRequest("POST", endpoint, payload);

// A sell request becomes a live listing in the vendor app, in three calls:
// create it (the backend makes the device in its "TEKRIO Online" store),
// upload each photo, then mark it ready, which opens bidding, so vendors
// never see a listing whose photos are still on their way. Every call is
// idempotent on leadId (+ slot), so the whole run is simply retried on a
// timeout. Retries live in memory only; a request that still fails stays
// in leads.json and /admin, and the log line names its reference.
const SELL_RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000];
class BackendRejected extends Error {}
async function sendSellRequest(record) {
  const check = ({ status, body }) => {
    if (status === 200 || status === 201) return;
    const reason = (body && body.error && body.error.message) || `HTTP ${status}`;
    // 4xx means the backend rejected this request as-is: retrying won't help.
    // Except 409 (e.g. PHOTOS_MISSING on ready: the next run re-uploads them)
    // and 429 (rate limited), which a later run can get past.
    if (status >= 400 && status < 500 && status !== 409 && status !== 429) throw new BackendRejected(reason);
    throw new Error(reason);
  };
  const lead = encodeURIComponent(record.id);
  const photos = record.photos || [];
  check(await postBackend("/sell-requests", sellRequestPayload(record)));
  for (const slot of photos) {
    const jpeg = await fs.promises.readFile(photoPath(record.id, slot));
    check(await backendRequest("PUT", `/sell-requests/${lead}/photos/${slot}`, jpeg, {
      contentType: "image/jpeg",
      timeoutMs: 20000,
    }));
  }
  check(await postBackend(`/sell-requests/${lead}/ready`, { photos }));
}
function forwardSellRequest(record, attempt = 0) {
  if (!CONFIG.BACKEND_API_KEY) return; // backend intake not switched on yet
  sendSellRequest(record).catch((e) => {
    if (e instanceof BackendRejected) {
      console.error(`[sell-request] ${record.reference} rejected by the app backend: ${e.message}`);
      return;
    }
    const delay = SELL_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      console.error(`[sell-request] ${record.reference} not listed in the app (${e.message}); follow up from /admin.`);
      return;
    }
    console.warn(`[sell-request] ${record.reference} listing failed (${e.message}); retrying in ${delay / 1000}s.`);
    setTimeout(() => forwardSellRequest(record, attempt + 1), delay).unref();
  });
}
function sellRequestPayload(record) {
  return {
    leadId: record.id,
    reference: record.reference,
    seller: {
      name: record.name,
      phone: record.mobile,
      email: record.email,
      address: record.address,
      city: record.city,
      pincode: record.pincode,
    },
    device: {
      platform: record.platform,
      brand: record.brand,
      model: record.model,
      storage: record.storage,
      imei1: record.imei1,
      imei2: record.imei2,
      ram: record.ram || "",
      batteryHealth: record.batteryHealth ? Number(record.batteryHealth) : null,
      catalogVersion: record.catalogVersion || "",
      answers: {
        screenDamage: record.screenDamage,
        bodyScratches: record.bodyScratches,
        deviceAge: record.deviceAge,
        box: record.box,
        bill: record.bill,
        charger: record.charger,
      },
    },
    photos: record.photos || [],
  };
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
// Pages are served at clean URLs: "/about" serves public/about.html, and
// any request for "/about.html" (or "/index.html") is 301-redirected to
// the clean form, so each page has exactly one URL and ".html" never shows.
function redirect(res, location) {
  res.writeHead(301, { Location: location });
  res.end();
}

function serveStatic(req, res, urlPath) {
  const search = new URL(req.url, "http://localhost").search; // keep ?utm=… on redirects
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0]);
  } catch (e) {
    return serve404(res); // malformed %-escape
  }
  if (rel.includes("\0")) return serve404(res);

  // "/index.html" -> "/", "/blog/index.html" -> "/blog/"
  if (/\/index\.html$/i.test(rel)) {
    return redirect(res, urlPath.replace(/index\.html$/i, "") + search);
  }
  // "/about.html" -> "/about" (404.html is internal; let it 404 normally)
  if (/\.html$/i.test(rel) && !/^\/404\.html$/i.test(rel)) {
    return redirect(res, urlPath.replace(/\.html$/i, "") + search);
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // require the separator so a sibling like "public-old/" can't match
  // (PUBLIC_DIR itself is allowed: that's the "/" request)
  if (filePath !== PUBLIC_DIR + path.sep && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    // real asset file (css, js, images, sitemap.xml, …)
    if (!err && stat.isFile()) return sendFile(req, res, filePath, stat);

    // directory: serve its index.html, adding the trailing slash if missing
    if (!err && stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      return fs.stat(indexPath, (errI, statI) => {
        if (errI || !statI.isFile()) return tryHtml();
        if (!rel.endsWith("/")) return redirect(res, urlPath + "/" + search);
        return sendFile(req, res, indexPath, statI);
      });
    }
    return tryHtml();
  });

  // "/about" -> public/about.html; "/about/" -> 301 to "/about"
  function tryHtml() {
    const trimmed = rel.length > 1 && rel.endsWith("/");
    const base = trimmed
      ? path.normalize(path.join(PUBLIC_DIR, rel.slice(0, -1)))
      : filePath;
    if (!base.startsWith(PUBLIC_DIR + path.sep)) return serve404(res);
    fs.stat(base + ".html", (err2, stat2) => {
      if (err2 || !stat2.isFile()) return serve404(res);
      if (trimmed) return redirect(res, urlPath.slice(0, -1) + search);
      return sendFile(req, res, base + ".html", stat2);
    });
  }
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
    <a href="/for-${kind}s#${kind === "retailer" ? "register" : "join"}" class="btn btn-gold btn-block">Go to ${label} Registration</a>
    <p class="form-note" style="margin-top:20px;">Already registered and need help? Email <a href="mailto:info@tekrio.in">info@tekrio.in</a>.</p>
  </div>
</div>
</body></html>`;
}

// leads saved before the reference was stored get the same one from their id
function leadReference(lead) {
  return lead.reference || String(lead.id).slice(0, 8).toUpperCase();
}
const LEAD_TYPE_NAMES = {
  sell: "Sell request",
  retailer: "Retailer",
  vendor: "Buyer",
  partner: "Partner",
  contact: "Contact",
  customer: "Customer",
};
// lead field -> label in the Details column, in display order
const LEAD_FIELD_LABELS = {
  ownerName: "Owner",
  company: "Company",
  email: "Email",
  address: "Address",
  pincode: "Pincode",
  gst: "GST",
  gstOrPan: "GST / PAN",
  partnershipType: "Partnership type",
  topic: "Topic",
  message: "Message",
};
// sell-request device fields, shown when the Device cell is clicked
const DEVICE_FIELD_LABELS = {
  platform: "Platform",
  brand: "Brand",
  model: "Model",
  storage: "Storage",
  imei1: "IMEI 1",
  imei2: "IMEI 2",
  ram: "RAM",
  batteryHealth: "Battery health",
  screenDamage: "Screen condition",
  bodyScratches: "Body condition",
  deviceAge: "Device age",
  box: "Box",
  bill: "Bill",
  charger: "Charger",
};
const PLATFORM_NAMES = { apple: "Apple (iPhone)", android: "Android" };
// fields with their own column, or not meant for the table
const LEAD_TABLE_SKIP = new Set([
  "id", "reference", "type", "createdAt", "ip", "name", "storeName", "businessName",
  "mobile", "city", "catalogVersion", "device", "photos", ...Object.keys(DEVICE_FIELD_LABELS),
]);
// Device cell: a one-line summary that opens to every device field. The old
// customer form only collected a free-text device name, shown as-is.
function deviceCell(lead) {
  const fields = Object.keys(DEVICE_FIELD_LABELS).filter((k) => lead[k]);
  if (!fields.length) return escapeHtml(lead.device || "");
  const summary = [[lead.brand, lead.model].filter(Boolean).join(" "), lead.storage].filter(Boolean).join(" · ");
  const value = (k) =>
    k === "platform" ? PLATFORM_NAMES[lead[k]] || lead[k] : k === "batteryHealth" ? `${lead[k]}%` : lead[k];
  const rows = fields
    .map((k) => `<dt>${escapeHtml(DEVICE_FIELD_LABELS[k])}</dt><dd>${escapeHtml(value(k))}</dd>`)
    .join("");
  const photos = (Array.isArray(lead.photos) ? lead.photos : [])
    .filter((slot) => PHOTO_SLOTS.includes(slot))
    .map((slot) => {
      const url = `/admin/photos/${encodeURIComponent(lead.id)}/${slot}.jpg`;
      return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${slot}" loading="lazy"><span>${slot}</span></a>`;
    })
    .join("");
  const gallery = photos ? `<div class="photos">${photos}</div>` : "";
  return `<details class="device"><summary>${escapeHtml(summary || "View device")}${photos ? ` · ${lead.photos.length} photos` : ""}</summary><dl>${rows}</dl>${gallery}</details>`;
}
// the admin script's URL changes with its contents, so browsers never run a stale copy
let adminScriptVersion = null;
function adminScriptUrl() {
  if (!adminScriptVersion) {
    const file = fs.readFileSync(path.join(PUBLIC_DIR, "js", "admin.js"));
    adminScriptVersion = crypto.createHash("sha256").update(file).digest("hex").slice(0, 8);
  }
  return `/js/admin.js?v=${adminScriptVersion}`;
}

// ---------------------------------------------------------------------
// admin dashboard (basic-auth protected, read-only view of leads.json).
// Every lead is in the HTML; public/js/admin.js adds search, a type filter
// and sorting on top, all in the browser.
// ---------------------------------------------------------------------
function renderAdminPage(leads) {
  const typeName = (type) => LEAD_TYPE_NAMES[type] || type;
  const rows = leads
    .slice()
    .reverse()
    .map((l) => {
      const name = l.name || l.storeName || l.businessName || "";
      const time = Date.parse(l.createdAt) || 0;
      const received = new Date(time).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      });
      const extraKeys = Object.keys(l).filter((k) => !(k in LEAD_FIELD_LABELS));
      const details = [...Object.keys(LEAD_FIELD_LABELS), ...extraKeys]
        .filter((k) => l[k] !== undefined && l[k] !== "" && !LEAD_TABLE_SKIP.has(k))
        .map((k) => `<span class="detail"><strong>${escapeHtml(LEAD_FIELD_LABELS[k] || k)}:</strong> ${escapeHtml(l[k])}</span>`)
        .join("");
      const searchText = [leadReference(l), typeName(l.type), received, ...Object.values(l)]
        .join(" ")
        .toLowerCase();
      return `<tr data-type="${escapeHtml(l.type)}" data-time="${time}" data-name="${escapeHtml(name)}" data-city="${escapeHtml(l.city || "")}" data-search="${escapeHtml(searchText)}">
        <td class="nowrap muted">${escapeHtml(received)}</td>
        <td class="nowrap"><code>${escapeHtml(leadReference(l))}</code></td>
        <td><span class="pill">${escapeHtml(typeName(l.type))}</span></td>
        <td>${escapeHtml(name)}</td>
        <td class="nowrap">${l.mobile ? `<a href="tel:+91${escapeHtml(l.mobile)}">${escapeHtml(l.mobile)}</a>` : ""}</td>
        <td>${escapeHtml(l.city || "")}</td>
        <td>${deviceCell(l)}</td>
        <td class="details">${details}</td>
      </tr>`;
    })
    .join("\n");

  const counts = leads.reduce((acc, l) => {
    acc[l.type] = (acc[l.type] || 0) + 1;
    return acc;
  }, {});
  const types = [
    ...Object.keys(LEAD_TYPE_NAMES).filter((t) => counts[t]),
    ...Object.keys(counts).filter((t) => !(t in LEAD_TYPE_NAMES)),
  ];
  const countCards = types
    .map((t) => `<div class="stat"><span class="num">${counts[t]}</span><span class="label">${escapeHtml(typeName(t))}</span></div>`)
    .join("");
  const typeOptions = types
    .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(typeName(t))} (${counts[t]})</option>`)
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TEKRIO Admin — Leads</title>
<link rel="icon" href="/images/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/images/favicon-192.png" type="image/png" sizes="192x192">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<script src="${adminScriptUrl()}" defer></script>
<style>
.table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius-s); background:#fff; }
table { width:100%; border-collapse: collapse; }
th, td { border-bottom:1px solid var(--line); padding:12px; vertical-align:top; font-size:0.9rem; text-align:left; }
th { font-size:0.8rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--slate); background:var(--paper); }
tbody tr:last-child td { border-bottom:0; }
.nowrap { white-space:nowrap; }
.muted { color:var(--slate); font-size:0.82rem; }
.details { min-width:260px; }
.details .detail { display:block; }
details.device { min-width:240px; }
td .pill { white-space:nowrap; }
details.device summary { cursor:pointer; color:var(--teal); font-weight:600; }
details.device summary:hover { text-decoration:underline; }
details.device dl { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; margin:10px 0 0; padding:10px 12px; background:var(--paper); border-radius:var(--radius-s); }
details.device dt { color:var(--slate); white-space:nowrap; }
details.device dd { margin:0; }
details.device .photos { display:grid; grid-template-columns:repeat(3, 72px); gap:8px; margin-top:10px; }
details.device .photos a { display:block; text-align:center; font-size:0.75rem; color:var(--slate); text-decoration:none; }
details.device .photos img { display:block; width:72px; height:72px; object-fit:cover; border-radius:var(--radius-s); border:1px solid var(--line); }
.two-col.stats-row { grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); margin-bottom:32px; }
.lead-controls { display:grid; gap:12px; margin-bottom:12px; }
@media (min-width: 760px) { .lead-controls { grid-template-columns: 2fr 1fr 1fr; } }
.lead-controls label { display:block; font-size:0.8rem; font-weight:600; margin-bottom:4px; }
.lead-controls input, .lead-controls select { width:100%; padding:10px 12px; border:1.5px solid var(--line); border-radius:var(--radius-s); font:inherit; font-size:0.95rem; background:#fff; }
.lead-controls input:focus, .lead-controls select:focus { border-color:var(--teal); outline:none; }
.lead-count { font-size:0.85rem; margin:0 0 12px; }
</style>
</head>
<body>
<div class="container" style="padding-top:48px;padding-bottom:64px;">
  <a href="/" class="brand" style="color:var(--ink);margin-bottom:20px;display:inline-flex;"><span class="brand-mark" style="color:var(--ink);">TEKRIO</span></a>
  <h1 style="font-size:1.8rem;">Admin — Captured Leads</h1>
  <p>Total leads: <strong>${leads.length}</strong>. Raw data: <a href="/api/admin/leads">/api/admin/leads</a>.</p>
  <div class="two-col stats-row">${countCards || "<p>No leads yet.</p>"}</div>
  <div class="lead-controls" id="leadControls" hidden>
    <div>
      <label for="leadSearch">Search</label>
      <input id="leadSearch" type="search" placeholder="Name, mobile, reference, model, city…" autocomplete="off">
    </div>
    <div>
      <label for="leadType">Type</label>
      <select id="leadType"><option value="">All types (${leads.length})</option>${typeOptions}</select>
    </div>
    <div>
      <label for="leadSort">Sort</label>
      <select id="leadSort">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="name-az">Name A–Z</option>
        <option value="name-za">Name Z–A</option>
        <option value="city-az">City A–Z</option>
      </select>
    </div>
  </div>
  <p class="lead-count" id="leadCount" role="status"></p>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Received (IST)</th><th>Reference</th><th>Type</th><th>Name</th><th>Mobile</th><th>City</th><th>Device</th><th>Details</th></tr></thead>
      <tbody id="leadRows">${rows || '<tr><td colspan="8">No submissions yet.</td></tr>'}</tbody>
    </table>
  </div>
  <p id="leadEmpty" hidden style="margin-top:16px;">No leads match your search.</p>
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
        raw = await readBody(req, type === "sell" ? SELL_BODY_MAX_BYTES : undefined);
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
      const photos = type === "sell" ? parsePhotos(body.photos) : null;
      if (photos && !photos.ok) {
        return sendJson(res, 400, { message: photos.message });
      }
      const id = crypto.randomUUID();
      const record = {
        id,
        reference: leadReference({ id }), // shown to the visitor after submitting
        type,
        ...result.data,
        createdAt: new Date().toISOString(),
        ip,
      };
      try {
        if (photos) record.photos = await savePhotos(id, photos.photos);
        await appendLead(record);
      } catch (e) {
        if (photos) fs.promises.rm(path.join(PHOTOS_DIR, id), { recursive: true, force: true }).catch(() => {});
        console.error("Failed to save lead:", e);
        return sendJson(res, 500, { message: "Could not save your submission. Please try again." });
      }
      forwardToAppApi(record); // no-op until APP_API_WEBHOOK_URL is configured
      if (type === "sell") forwardSellRequest(record); // no-op until BACKEND_API_KEY is set
      return sendJson(res, 200, {
        message: "Thanks! Our team will reach out shortly.",
        reference: record.reference,
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

    // ---- seller offer page (/offer): look up / accept the emailed offer ----
    // The token comes from the email link's #fragment and is posted in the
    // body, so it never lands in URLs, logs or Referer headers.
    const OFFER_ACTIONS = {
      "/api/offer": "/seller-offers/lookup",
      "/api/offer/accept": "/seller-offers/accept",
      "/api/offer/paid": "/seller-offers/paid", // seller confirms the buyer paid them
      "/api/offer/revision": "/seller-offers/revision", // accept/decline a revised price
      "/api/offer/cancel": "/seller-offers/cancel",
      "/api/offer/checkin": "/seller-offers/checkin", // "did you sell?" after a missed handover
    };
    if (OFFER_ACTIONS[pathname] && req.method === "POST") {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      const contentType = String(req.headers["content-type"] || "").split(";")[0].trim();
      if (contentType !== "application/json") {
        return sendJson(res, 415, { message: "Unsupported content type." });
      }
      if (offerLimiter.hit(ip)) {
        return sendJson(res, 429, { message: "Too many requests. Please try again in a minute." });
      }
      if (!CONFIG.BACKEND_API_KEY) {
        return sendJson(res, 503, { message: "Offers aren't available online yet. Please call us." });
      }
      let input;
      try {
        input = JSON.parse((await readBody(req, 4096)) || "{}");
      } catch (e) {
        return sendJson(res, 400, { message: "Invalid request." });
      }
      const token = String((input && input.token) || "");
      if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
        return sendJson(res, 404, { code: "OFFER_NOT_FOUND", message: "This offer link isn't valid." });
      }
      // only these plain fields go on to the backend
      const forward = { token };
      ["decision", "reason", "note", "answer"].forEach((k) => {
        if (typeof input[k] === "string") forward[k] = input[k].slice(0, 500);
      });
      try {
        const { status, body } = await postBackend(OFFER_ACTIONS[pathname], forward);
        if (status === 200 && body && body.data) return sendJson(res, 200, { data: body.data });
        const error = (body && body.error) || {};
        if (status >= 400 && status < 500) {
          return sendJson(res, status, { code: error.code || "", message: error.message || "This offer can't be opened." });
        }
        console.error(`[offer] backend returned HTTP ${status}`);
      } catch (e) {
        console.error("[offer] backend unreachable:", e.message);
      }
      return sendJson(res, 502, { message: "We couldn't load your offer right now. Please try again shortly." });
    }

    // ---- admin dashboard ----
    const isAdmin = pathname === "/admin" || pathname === "/admin/";
    const adminPhoto = /^\/admin\/photos\/([^/]+)\/([a-z]+)\.jpg$/.exec(pathname);
    if (isAdmin || adminPhoto || pathname === "/api/admin/leads") {
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
      if (adminPhoto) {
        const [, leadId, slot] = adminPhoto;
        if (!LEAD_ID_RE.test(leadId) || !PHOTO_SLOTS.includes(slot)) return serve404(res);
        return fs.readFile(photoPath(leadId, slot), (err, jpeg) => {
          if (err) return serve404(res);
          res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": jpeg.length });
          res.end(req.method === "HEAD" ? undefined : jpeg);
        });
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
      "/for-vendors.html": "/for-buyers", // must stay above the generic .html redirect
      "/for-vendors": "/for-buyers",
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
