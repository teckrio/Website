/**
 * TEKRIO server configuration.
 * Values are read from environment variables with safe local defaults,
 * so `npm start` works out of the box for testing. Override via a
 * real .env / process manager (pm2, systemd, Docker) in production —
 * see README.md "Deployment" section.
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

module.exports = {
  IS_PRODUCTION,

  // /admin credentials. In production there is no default password: if
  // TEKRIO_ADMIN_PASSWORD is unset, /admin stays disabled rather than
  // falling back to a publicly documented password.
  ADMIN_USER: process.env.TEKRIO_ADMIN_USER || "admin",
  ADMIN_PASSWORD:
    process.env.TEKRIO_ADMIN_PASSWORD || (IS_PRODUCTION ? "" : "tekrio-admin-dev"),

  // Where leads.json lives. Point this at a persistent disk/volume on hosts
  // whose app filesystem is wiped on redeploy (Railway, Render, Docker).
  DATA_DIR: process.env.TEKRIO_DATA_DIR || "",

  // Set to "true" only when running behind a reverse proxy you control
  // (Nginx, Caddy, a platform load balancer) so the client IP used for rate
  // limiting is read from X-Forwarded-For. Otherwise that header is ignored,
  // since any client can set it to dodge the limit.
  TRUST_PROXY: process.env.TEKRIO_TRUST_PROXY === "true",

  // TEKRIO app backend (same backend the Store Manager and Buyer apps use).
  // The public /catalog endpoint drives the device options on the website's
  // "Sell Your Device" journey so both stay in sync.
  BACKEND_API_BASE_URL:
    process.env.TEKRIO_BACKEND_API_BASE_URL ||
    "https://backend-production-17e07.up.railway.app/api/v1",

  // ---- PENDING: TEKRIO app/API connection ----
  // Once the TEKRIO mobile app's backend exposes an API/webhook for
  // receiving leads and handling OTP login, set these and the server
  // will start forwarding every captured lead automatically (see
  // forwardToAppApi in server.js). Leaving them unset is safe — leads
  // still save locally to data/leads.json and remain visible in /admin.
  APP_API_WEBHOOK_URL: process.env.TEKRIO_APP_API_WEBHOOK_URL || "",
  APP_API_KEY: process.env.TEKRIO_APP_API_KEY || "",
};
