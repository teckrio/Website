/**
 * Google Analytics 4 loader.
 * The Measurement ID is written into this script tag's data-ga-id
 * attribute at build time from the TEKRIO_GA_ID env var (an attribute
 * rather than an inline script, so the Content-Security-Policy can
 * forbid inline scripts). Without it this file loads nothing, so the
 * site never calls out to an invalid property.
 */
(function () {
  var me = document.currentScript;
  var id = me && me.getAttribute("data-ga-id");
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
  // page URL without the seller offer link's private token: the email link
  // carries it in the #fragment, the SMS link in ?c=
  var params = new URLSearchParams(window.location.search);
  params.delete("c");
  var query = params.toString();
  window.gtag("config", id, {
    page_location: window.location.origin + window.location.pathname + (query ? "?" + query : ""),
  });
})();
