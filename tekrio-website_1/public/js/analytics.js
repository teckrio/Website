/**
 * Google Analytics 4 loader.
 * PENDING: set the real Measurement ID on the <head> script tag
 * (window.__TEKRIO_GA_ID) once the GA4 property + Search Console
 * are created for www.tekrio.in. Until then this file loads nothing,
 * so the site never calls out to an invalid property.
 */
(function () {
  var id = window.__TEKRIO_GA_ID;
  if (!id || id.indexOf("XXXX") !== -1) return;

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
