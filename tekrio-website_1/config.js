/**
 * TEKRIO server configuration.
 * Values are read from environment variables with safe local defaults,
 * so `npm start` works out of the box for testing. Override via a
 * real .env / process manager (pm2, systemd, Docker) in production —
 * see README.md "Deployment" section.
 */
module.exports = {
  // Change these before deploying publicly.
  ADMIN_USER: process.env.TEKRIO_ADMIN_USER || "admin",
  ADMIN_PASSWORD: process.env.TEKRIO_ADMIN_PASSWORD || "tekrio-admin-2026",

  // ---- PENDING: TEKRIO app/API connection ----
  // Once the TEKRIO mobile app's backend exposes an API/webhook for
  // receiving leads and handling OTP login, set these and the server
  // will start forwarding every captured lead automatically (see
  // forwardToAppApi in server.js). Leaving them unset is safe — leads
  // still save locally to data/leads.json and remain visible in /admin.
  APP_API_WEBHOOK_URL: process.env.TEKRIO_APP_API_WEBHOOK_URL || "",
  APP_API_KEY: process.env.TEKRIO_APP_API_KEY || "",
};
