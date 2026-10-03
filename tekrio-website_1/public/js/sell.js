(function () {
  "use strict";

  // "Sell Your Device" journey. Device options come from the TEKRIO app
  // backend's catalog (via /api/catalog on this server) so the website and
  // the retailer app describe devices the same way. FALLBACK is only used
  // if the catalog can't be reached, so the form never breaks.
  var FALLBACK = {
    version: "fallback",
    storages: ["64 GB", "128 GB", "256 GB", "512 GB", "1 TB"],
    rams: ["4 GB", "6 GB", "8 GB", "12 GB", "24 GB"],
    inspectionFields: [
      { key: "screenDamage", options: ["Excellent, no visible scratches", "Up to 5 scratches under 1 cm", "Heavy scratches or a nail-catching scratch", "Screen cracked or broken"] },
      { key: "bodyScratches", options: ["Excellent", "Up to 5 scratches under 1 cm", "Major paint peel or bubbles"] },
      { key: "deviceAge", options: ["Below 3 months", "3 to below 6 months", "6 to below 11 months", "11 months or older"] },
    ],
  };

  var form = document.getElementById("sellForm");
  if (!form) return;
  var steps = form.querySelectorAll(".sell-step");
  var journey = document.querySelectorAll("#journey [data-journey]");
  var statusEl = form.querySelector(".form-status");
  var current = 1;

  // ---------- catalog ----------
  function fillSelect(select, options) {
    options.forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    });
  }
  function applyCatalog(catalog) {
    form.elements.catalogVersion.value = catalog.version || "";
    form.querySelectorAll("[data-catalog-list]").forEach(function (sel) {
      fillSelect(sel, catalog[sel.getAttribute("data-catalog-list")] || []);
    });
    var byKey = {};
    (catalog.inspectionFields || []).forEach(function (f) { byKey[f.key] = f; });
    form.querySelectorAll("[data-catalog-field]").forEach(function (sel) {
      var field = byKey[sel.getAttribute("data-catalog-field")];
      fillSelect(sel, field ? field.options : []);
    });
  }
  fetch("/api/catalog")
    .then(function (res) {
      if (!res.ok) throw new Error("catalog " + res.status);
      return res.json();
    })
    .then(function (json) { applyCatalog(json.data); })
    .catch(function () { applyCatalog(FALLBACK); });

  // ---------- platform-specific fields ----------
  // The brand decides the platform: Apple is an iPhone, every other brand
  // is Android. RAM is asked for Android only, battery health for iPhone only.
  form.elements.brand.addEventListener("change", function () {
    var brand = form.elements.brand.value;
    var platform = !brand ? "" : brand === "Apple" ? "apple" : "android";
    form.elements.platform.value = platform;
    form.querySelectorAll("[data-android-only]").forEach(function (el) { el.hidden = platform !== "android"; });
    form.querySelectorAll("[data-apple-only]").forEach(function (el) { el.hidden = platform !== "apple"; });
    form.elements.model.placeholder =
      platform === "apple" ? "e.g. iPhone 13" : platform === "android" ? "e.g. Galaxy S22" : "e.g. iPhone 13 or Galaxy S22";
  });

  // ---------- validation ----------
  // show/clear a field's error and expose it to screen readers: the
  // control is marked invalid and points at its message
  var errorSeq = 0;
  function setFieldError(field, message) {
    field.classList.toggle("invalid", !!message);
    var err = field.querySelector(".field-error");
    if (!err) return;
    err.textContent = message || "";
    if (!err.id) err.id = "field-error-" + ++errorSeq;
    field.querySelectorAll("input, select, textarea").forEach(function (input) {
      if (input.type === "hidden") return;
      if (message) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", err.id);
      } else {
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
      }
    });
  }
  function validateStep(stepEl) {
    var valid = true;
    stepEl.querySelectorAll("[data-field]").forEach(function (field) {
      if (field.hidden) return setFieldError(field, "");
      var inputs = field.querySelectorAll("input, select, textarea");
      if (!inputs.length) return;
      var input = inputs[0];
      var value;
      if (input.type === "radio") {
        var checked = field.querySelector("input:checked");
        value = checked ? checked.value : "";
      } else {
        value = (input.value || "").trim();
      }
      var rule = field.getAttribute("data-rule");
      var message = "";
      if (input.hasAttribute("required") && !value) {
        message = input.type === "radio" ? "Please choose one." : "This field is required.";
      } else if (value && rule === "mobile" && !/^[6-9]\d{9}$/.test(value)) {
        message = "Enter a valid 10-digit Indian mobile number.";
      } else if (value && rule === "pincode" && !/^[1-9]\d{5}$/.test(value)) {
        message = "Enter a valid 6-digit pincode.";
      } else if (value && rule === "battery" && !/^(100|[1-9]?\d)$/.test(value)) {
        message = "Enter a number between 0 and 100.";
      }
      if (message) valid = false;
      setFieldError(field, message);
    });
    return valid;
  }

  // ---------- step navigation ----------
  // the tracker tells screen readers which step is current, not just colour
  function markJourney(n) {
    journey.forEach(function (li) {
      var j = Number(li.getAttribute("data-journey"));
      li.classList.toggle("is-active", j === n);
      li.classList.toggle("is-done", j < n);
      if (j === n) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
  }
  function showStep(n) {
    current = n;
    steps.forEach(function (s) { s.hidden = Number(s.getAttribute("data-step")) !== n; });
    markJourney(n);
    var focusable = steps[n - 1].querySelector("input:not([type=hidden]), select");
    if (focusable) focusable.focus({ preventScroll: true });
    document.getElementById("journey").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function focusFirstError(stepEl) {
    var bad = stepEl.querySelector("[aria-invalid=true]");
    if (bad) bad.focus();
  }
  form.querySelectorAll("[data-next]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (validateStep(steps[current - 1])) showStep(current + 1);
      else focusFirstError(steps[current - 1]);
    });
  });
  form.querySelectorAll("[data-back]").forEach(function (btn) {
    btn.addEventListener("click", function () { showStep(current - 1); });
  });

  // ---------- submit ----------
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    statusEl.className = "form-status";
    statusEl.textContent = "";
    if (!validateStep(steps[current - 1])) return focusFirstError(steps[current - 1]);

    var payload = {};
    new FormData(form).forEach(function (value, key) { payload[key] = value; });
    if (payload._hp) return;
    // the visitor may have switched platform: drop the other one's fields
    if (payload.platform === "apple") {
      delete payload.ram;
    } else {
      delete payload.batteryHealth;
    }
    ["box", "bill", "charger"].forEach(function (k) { payload[k] = payload[k] ? "Yes" : "No"; });

    var submitBtn = form.querySelector('button[type="submit"]');
    var originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    fetch("/api/leads/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          statusEl.textContent = (result.data && result.data.message) || "Something went wrong. Please try again.";
          statusEl.classList.add("show", "err");
          return;
        }
        document.getElementById("sellRef").textContent = result.data.reference || "";
        form.hidden = true;
        document.getElementById("sellDone").hidden = false;
        markJourney(3);
        document.getElementById("journey").scrollIntoView({ behavior: "smooth", block: "start" });
        if (window.gtag) window.gtag("event", "generate_lead", { lead_type: "sell" });
      })
      .catch(function () {
        statusEl.textContent = "Network error. Please check your connection and try again.";
        statusEl.classList.add("show", "err");
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      });
  });
})();
