#!/usr/bin/env node
/**
 * Build script for the TEKRIO static site.
 * Stitches templates/_shell.html + _header.html + _footer.html around
 * each page's content fragment in content/pages/*.html, resolves
 * per-page meta from pages.config.js, and writes finished HTML into
 * /public. Run: npm run build (also runs automatically before `npm run dev`).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEMPLATES = path.join(ROOT, "templates");
const CONTENT = path.join(ROOT, "content", "pages");
const PUBLIC = path.join(ROOT, "public");
const SITE_URL = "https://www.tekrio.in";

const pages = require("./pages.config.js");

const shell = fs.readFileSync(path.join(TEMPLATES, "_shell.html"), "utf8");
const headerTpl = fs.readFileSync(path.join(TEMPLATES, "_header.html"), "utf8");
const footerTpl = fs.readFileSync(path.join(TEMPLATES, "_footer.html"), "utf8");

function renderHeader(activeKey) {
  return headerTpl.replace(/\{\{active:([a-z]+)\}\}/g, (_, key) =>
    key === activeKey ? "active" : ""
  );
}

let builtCount = 0;

for (const page of pages) {
  const contentPath = path.join(CONTENT, page.file);
  if (!fs.existsSync(contentPath)) {
    console.error(`  MISSING content fragment: content/pages/${page.file}`);
    process.exitCode = 1;
    continue;
  }
  const content = fs.readFileSync(contentPath, "utf8");
  const canonical = SITE_URL + (page.out === "index.html" ? "/" : `/${page.out}`);

  let html = shell
    .replace("{{TITLE}}", page.title)
    .replace("{{DESC}}", page.description)
    .replace(/\{\{CANONICAL\}\}/g, canonical)
    .replace("{{ROBOTS}}", page.noindex ? "noindex, nofollow" : "index, follow")
    .replace("{{SCHEMA}}", page.schema || "")
    .replace("{{HEADER}}", renderHeader(page.active))
    .replace("{{FOOTER}}", footerTpl)
    .replace("{{CONTENT}}", content);

  const outPath = path.join(PUBLIC, page.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  builtCount++;
}

// sitemap.xml (skip noindex pages such as 404)
const urls = pages
  .filter((p) => !p.noindex)
  .map((p) => {
    const loc = SITE_URL + (p.out === "index.html" ? "/" : `/${p.out}`);
    return `  <url><loc>${loc}</loc><changefreq>weekly</changefreq></url>`;
  })
  .join("\n");
fs.writeFileSync(
  path.join(PUBLIC, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
);

fs.writeFileSync(
  path.join(PUBLIC, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${SITE_URL}/sitemap.xml\n`
);

console.log(`Built ${builtCount}/${pages.length} pages -> /public`);
