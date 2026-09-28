/**
 * Google Analytics 4 loader.
 * The Measurement ID is injected into window.__TEKRIO_GA_ID at build time
 * from the TEKRIO_GA_ID env var. Without it this file loads nothing, so the
 * site never calls out to an invalid property.
 */
(function () {
  var id = window.__TEKRIO_GA_ID;
  if (!/^G-[A-Z0-9]+$/.test(id || "")) return;

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id);
})();
