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
  var catalogLists = { storages: null, rams: null }; // restored when a picked model is cleared
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
    catalogLists = { storages: catalog.storages || [], rams: catalog.rams || [] };
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

  // ---------- brands and models ----------
  // The brand tiles in the page are a fixed fallback list. When the backend's
  // device catalog answers (via /api/device-brands on this server) they're
  // replaced by its brands and logos, and picking a brand lists its models,
  // whose storage/RAM variants then narrow the Storage and RAM choices.
  var brandGrid = form.querySelector("[data-brand-grid]");
  var modelGrid = form.querySelector("[data-model-grid]");
  var modelInput = form.elements.model;
  var models = []; // the chosen brand's models, [] when the backend has none
  var modelRequest = 0; // ignores a slow answer for a brand no longer chosen

  function brandTile(brand, index) {
    var label = document.createElement("label");
    label.className = "brand-tile";
    var input = document.createElement("input");
    input.type = "radio";
    input.name = "brand";
    input.value = brand.name;
    input.setAttribute("data-platform", brand.platform);
    input.setAttribute("data-brand-id", brand.id);
    if (index === 0) input.required = true;
    var logo = document.createElement("span");
    logo.className = "brand-logo";
    logo.setAttribute("aria-hidden", "true");
    if (brand.logo) {
      var img = document.createElement("img");
      img.src = brand.logo;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = function () { logo.textContent = brand.name.charAt(0); };
      logo.appendChild(img);
    } else {
      logo.textContent = brand.name.charAt(0);
    }
    var name = document.createElement("span");
    name.className = "brand-name";
    name.textContent = brand.name;
    label.appendChild(input);
    label.appendChild(logo);
    label.appendChild(name);
    return label;
  }
  fetch("/api/device-brands")
    .then(function (res) {
      if (!res.ok) throw new Error("brands " + res.status);
      return res.json();
    })
    .then(function (json) {
      var brands = (json.data || []).slice().sort(function (a, b) {
        // iPhone first, then Android brands A–Z
        if (a.platform !== b.platform) return a.platform === "apple" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      if (!brands.length || form.elements.brand.value) return; // keep a choice already made
      brandGrid.textContent = "";
      brands.forEach(function (b, i) { brandGrid.appendChild(brandTile(b, i)); });
    })
    .catch(function () { /* keep the fixed brand list */ });

  function setOptions(select, values, placeholder) {
    var keep = select.value;
    select.textContent = "";
    var first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);
    fillSelect(select, values);
    if (values.indexOf(keep) !== -1) select.value = keep;
  }
  function unique(list) {
    return list.filter(function (v, i) { return v && list.indexOf(v) === i; });
  }
  // a picked model offers only its own storage/RAM variants
  function applyVariants(model) {
    var storage = form.elements.storage;
    var ram = form.elements.ram;
    var variants = model ? model.variants : [];
    if (!variants.length && !catalogLists.storages) return; // catalog still loading
    var storages = unique(variants.map(function (v) { return v.storage; }));
    var rams = unique(variants.map(function (v) { return v.ram; }));
    setOptions(storage, storages.length ? storages : catalogLists.storages, "Select storage");
    setOptions(ram, rams.length ? rams : catalogLists.rams, "Select RAM");
  }
  function renderModels() {
    var q = modelInput.value.trim().toLowerCase();
    var exact = models.filter(function (m) { return m.name.toLowerCase() === q; })[0] || null;
    modelGrid.textContent = "";
    models.forEach(function (m) {
      // typing narrows the list; a picked model keeps the whole list in view
      if (q && !exact && m.name.toLowerCase().indexOf(q) === -1) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "model-tile" + (m === exact ? " is-selected" : "");
      button.setAttribute("aria-pressed", m === exact ? "true" : "false");
      var pic = document.createElement("span");
      pic.className = "model-pic";
      pic.setAttribute("aria-hidden", "true");
      if (m.image) {
        var img = document.createElement("img");
        img.src = m.image;
        img.alt = "";
        img.loading = "lazy";
        pic.appendChild(img);
      }
      var name = document.createElement("span");
      name.textContent = m.name;
      button.appendChild(pic);
      button.appendChild(name);
      button.addEventListener("click", function () {
        modelInput.value = m.name;
        renderModels();
        applyVariants(m);
        modelInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      modelGrid.appendChild(button);
    });
    modelGrid.hidden = !modelGrid.children.length;
    applyVariants(exact);
  }
  modelInput.addEventListener("input", function () { if (models.length) renderModels(); });

  function loadModels(brandId) {
    var request = ++modelRequest;
    models = [];
    modelGrid.hidden = true;
    applyVariants(null);
    if (!brandId) return;
    fetch("/api/device-models?brand=" + encodeURIComponent(brandId))
      .then(function (res) {
        if (!res.ok) throw new Error("models " + res.status);
        return res.json();
      })
      .then(function (json) {
        if (request !== modelRequest) return;
        models = json.data || [];
        renderModels();
      })
      .catch(function () { /* the model stays a typed answer */ });
  }

  // ---------- platform-specific fields ----------
  // The brand decides the platform: Apple is an iPhone, every other brand
  // is Android. RAM is asked for Android only, battery health for iPhone only.
  brandGrid.addEventListener("change", function (e) {
    var picked = e.target;
    var platform = picked.getAttribute("data-platform") || "";
    form.elements.platform.value = platform;
    form.querySelectorAll("[data-android-only]").forEach(function (el) { el.hidden = platform !== "android"; });
    form.querySelectorAll("[data-apple-only]").forEach(function (el) { el.hidden = platform !== "apple"; });
    modelInput.placeholder =
      platform === "apple" ? "e.g. iPhone 13" : platform === "android" ? "e.g. Galaxy S22" : "e.g. iPhone 13 or Galaxy S22";
    modelInput.value = "";
    loadModels(picked.getAttribute("data-brand-id"));
  });

  // ---------- city ----------
  // filled in from the city picked in the site-wide popup (main.js)
  var citySelect = form.elements.city;
  function applyCity(city) {
    if (city && !citySelect.value) citySelect.value = city;
  }
  try { applyCity(localStorage.getItem("tekrio.city")); } catch (e) { /* storage blocked */ }
  document.addEventListener("tekrio:city", function (e) { citySelect.value = e.detail; });

  // ---------- photos ----------
  // Each photo is redrawn as a JPEG no larger than MAX_EDGE px: small enough
  // to upload on mobile data, and redrawing drops the file's metadata (such
  // as the GPS location phones embed). FileReader gives a data: URL, which
  // the Content-Security-Policy allows for images (blob: URLs it doesn't).
  var MAX_EDGE = 1600;
  var photos = {}; // slot -> JPEG data: URL
  var busy = {}; // slot -> true while a photo is being shrunk
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject(new Error("not an image"));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("unreadable")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("undecodable")); };
        img.onload = function () {
          var scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  // iPhone and iPad: the tile opens iOS's own menu (Photo Library, Take Photo,
  // Choose File). Other phones: Android's picker often has no camera option,
  // so tapping a tile opens our sheet offering the camera or an existing
  // photo. Computers: clicking the tile opens the file picker.
  var ua = navigator.userAgent || "";
  var isAppleTouch = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var useSheet = !isAppleTouch && /Android|Mobi/i.test(ua);
  function photoButton(label, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "photo-action";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  // one shared sheet, filled in for the tile that was tapped
  var sheet = null;
  var sheetTitle, sheetCamera, sheetFiles, sheetReturn;
  function closeSheet() {
    sheet.hidden = true;
    document.body.classList.remove("sheet-open");
    if (sheetReturn) sheetReturn.focus();
  }
  function openSheet(title, camera, files, returnTo) {
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.className = "photo-sheet";
      sheet.hidden = true;
      sheet.innerHTML =
        '<div class="photo-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="photo-sheet-title">' +
        '<p class="photo-sheet-title" id="photo-sheet-title"></p></div>';
      var panel = sheet.firstChild;
      sheetTitle = panel.firstChild;
      panel.appendChild(photoButton("Open camera", function () { closeSheet(); sheetCamera.click(); }));
      panel.appendChild(photoButton("Choose from files", function () { closeSheet(); sheetFiles.click(); }));
      var cancel = photoButton("Cancel", closeSheet);
      cancel.classList.add("is-cancel");
      panel.appendChild(cancel);
      sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });
      sheet.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
      document.body.appendChild(sheet);
    }
    sheetTitle.textContent = title;
    sheetCamera = camera;
    sheetFiles = files;
    sheetReturn = returnTo;
    sheet.hidden = false;
    document.body.classList.add("sheet-open");
    sheet.querySelector("button").focus();
  }

  form.querySelectorAll("[data-photo]").forEach(function (slotEl) {
    var slot = slotEl.getAttribute("data-photo");
    var input = slotEl.querySelector("input[type=file]");
    var preview = slotEl.querySelector("img");
    var name = slotEl.querySelector(".photo-name");
    var what = name ? name.firstChild.textContent.trim().toLowerCase() : slot;
    var inputs = [input];
    if (useSheet) {
      var camera = document.createElement("input");
      camera.type = "file";
      camera.accept = "image/*";
      camera.setAttribute("capture", "environment");
      camera.className = "visually-hidden";
      camera.tabIndex = -1;
      slotEl.appendChild(camera);
      inputs.push(camera);
      // the tile is a <label>: stop it opening the picker and ask first. The
      // sheet's own input.click() also passes through here and must go on.
      slotEl.querySelector(".photo-tile").addEventListener("click", function (e) {
        if (e.target === input) return;
        e.preventDefault();
        var title = what.charAt(0).toUpperCase() + what.slice(1) + " photo";
        openSheet(title, camera, input, input);
      });
    }
    inputs.forEach(function (picker) { picker.addEventListener("change", function () { onPhoto(picker); }); });

    function onPhoto(input) {
      var file = input.files && input.files[0];
      if (!file) return;
      busy[slot] = true;
      slotEl.classList.add("is-busy");
      setFieldError(slotEl, "");
      shrink(file)
        .then(function (dataUrl) {
          photos[slot] = dataUrl;
          preview.src = dataUrl;
          preview.hidden = false;
          slotEl.classList.add("has-photo");
        })
        .catch(function () {
          setFieldError(slotEl, "This photo couldn't be read. Please try a JPEG or PNG photo.");
        })
        .finally(function () {
          busy[slot] = false;
          slotEl.classList.remove("is-busy");
          input.value = ""; // choosing the same file again still fires "change"
        });
    }
  });
  function validatePhotos(stepEl) {
    var valid = true;
    stepEl.querySelectorAll("[data-photo]").forEach(function (slotEl) {
      var slot = slotEl.getAttribute("data-photo");
      var message = "";
      if (busy[slot]) message = "Still preparing this photo. One moment.";
      else if (slotEl.hasAttribute("data-required") && !photos[slot]) message = "Add this photo to continue.";
      if (message) valid = false;
      if (message || photos[slot]) setFieldError(slotEl, message);
    });
    return valid;
  }

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
      } else if (value && rule === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        message = "Enter a valid email address.";
      } else if (value && rule === "pincode" && !/^[1-9]\d{5}$/.test(value)) {
        message = "Enter a valid 6-digit pincode.";
      } else if (value && rule === "battery" && !/^(100|[1-9]?\d)$/.test(value)) {
        message = "Enter a number between 0 and 100.";
      } else if (value && rule === "imei" && !/^\d{15}$/.test(value)) {
        message = "Enter all 15 digits of the IMEI.";
      } else if (value && rule === "imei" && input.name === "imei2" && value === (form.elements.imei1.value || "").trim()) {
        message = "IMEI 2 must be different from IMEI 1.";
      }
      if (message) valid = false;
      setFieldError(field, message);
    });
    if (stepEl.querySelector("[data-photo]") && !validatePhotos(stepEl)) valid = false;
    return valid;
  }

  // IMEIs: keep digits only, so pasted spaces or dashes don't fail validation
  form.querySelectorAll("[data-imei]").forEach(function (input) {
    input.addEventListener("input", function () {
      var digits = input.value.replace(/\D/g, "").slice(0, 15);
      if (digits !== input.value) input.value = digits;
    });
  });

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
  // form steps map onto the 5-step journey (the photo step is part of "Add Details")
  function showStep(n) {
    current = n;
    steps.forEach(function (s) { s.hidden = Number(s.getAttribute("data-step")) !== n; });
    markJourney(Number(steps[n - 1].getAttribute("data-journey")));
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
    payload.photos = photos;

    var submitBtn = form.querySelector('button[type="submit"]');
    var originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading photos...";

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
