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
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const CONFIG = require("./config.js");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, "[]");

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
// each other's write to leads.json
// ---------------------------------------------------------------------
let writeChain = Promise.resolve();
function appendLead(record) {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        fs.readFile(LEADS_FILE, "utf8", (err, raw) => {
          if (err) return reject(err);
          let list = [];
          try {
            list = JSON.parse(raw || "[]");
          } catch (e) {
            list = [];
          }
          list.push(record);
          fs.writeFile(LEADS_FILE, JSON.stringify(list, null, 2), (err2) => {
            if (err2) return reject(err2);
            resolve(record);
          });
        });
      })
  );
  return writeChain;
}

// ---------------------------------------------------------------------
// simple per-IP rate limiter (in-memory) for the lead endpoints
// ---------------------------------------------------------------------
const hits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 10;
  const entry = hits.get(ip) || [];
  const recent = entry.filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

// ---------------------------------------------------------------------
// lead schema validation per form type — mirrors the Section 5 brief:
//   Customer: Name, Mobile, City, Phone Brand/Model
//   Retailer: Store Name, Owner Name, Mobile, City, GST (optional)
//   Vendor:   Business Name, Mobile, City, GST/PAN
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
  const schema = SCHEMAS[type];
  if (!schema) return { ok: false, message: "Unknown form type." };
  if (body._hp) return { ok: false, message: "Rejected." }; // honeypot tripped

  for (const field of schema.required) {
    if (!body[field] || !String(body[field]).trim()) {
      return { ok: false, message: `Missing required field: ${field}.` };
    }
  }
  if (body.mobile && !isValidMobile(body.mobile)) {
    return { ok: false, message: "Enter a valid 10-digit Indian mobile number." };
  }
  if (body.email && !isValidEmail(body.email)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const clean = {};
  [...schema.required, ...schema.optional].forEach((f) => {
    if (body[f] !== undefined) clean[f] = String(body[f]).trim().slice(0, 500);
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
// admin basic auth (credentials via config.js / env — see README)
// ---------------------------------------------------------------------
function checkBasicAuth(req) {
  const header = req.headers["authorization"] || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return (
    timingSafeEqual(user, CONFIG.ADMIN_USER) &&
    timingSafeEqual(pass, CONFIG.ADMIN_PASSWORD)
  );
}
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function requireAuth(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="TEKRIO Admin"',
    "Content-Type": "text/plain",
  });
  res.end("Authentication required.");
}

// ---------------------------------------------------------------------
// static file serving (with basic path traversal protection)
// ---------------------------------------------------------------------
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      // try adding .html for pretty URLs like /about
      const withHtml = filePath + ".html";
      fs.readFile(withHtml, (err2, content2) => {
        if (err2) return serve404(res);
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(content2);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
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

function readBody(req, maxBytes = 1e6) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
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
  const label = kind === "retailer" ? "Retailer" : "Vendor";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label} Login | TEKRIO</title>
<link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
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
    <p class="form-note" style="margin-top:20px;">Already registered and need help? Email <a href="mailto:support@tekrio.in">support@tekrio.in</a>.</p>
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
<link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
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
const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsed.pathname;
    const ip =
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";

    // ---- lead capture API ----
    if (pathname.startsWith("/api/leads/") && req.method === "POST") {
      const type = pathname.replace("/api/leads/", "").trim();
      if (isRateLimited(ip)) {
        return sendJson(res, 429, { message: "Too many submissions. Please try again in a minute." });
      }
      let raw;
      try {
        raw = await readBody(req);
      } catch (e) {
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
        ip: String(ip).split(",")[0].trim(),
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
      });
    }

    // ---- admin dashboard ----
    if (pathname === "/admin" || pathname === "/admin/") {
      if (!checkBasicAuth(req)) return requireAuth(res);
      const leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8") || "[]");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderAdminPage(leads));
    }
    if (pathname === "/api/admin/leads") {
      if (!checkBasicAuth(req)) return requireAuth(res);
      const leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8") || "[]");
      return sendJson(res, 200, leads);
    }

    // ---- portal placeholders (pending app/API + OTP login) ----
    if (pathname === "/portal/retailer-login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPortalPage("retailer"));
    }
    if (pathname === "/portal/vendor-login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPortalPage("vendor"));
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

server.listen(PORT, () => {
  console.log(`TEKRIO server running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin (user: ${CONFIG.ADMIN_USER})`);
});
