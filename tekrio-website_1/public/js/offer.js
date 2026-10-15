(function () {
  "use strict";

  // Seller offer page. The emailed link is /offer#t=<token>: the token sits
  // in the #fragment so browsers never send it to any server in a URL or
  // Referer header. It's posted to this site's /api/offer endpoints, which
  // pass it on to the TEKRIO app backend.
  //
  // After accepting, the seller takes the phone to the winning buyer's shop
  // and is paid there by the buyer. This page then shows the shop, any lower
  // price the buyer proposes, and, once the seller confirms payment, the code
  // the buyer enters to complete the sale.
  var card = document.querySelector(".offer-card");
  if (!card) return;

  var match = /(?:^|[#&])t=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  var token = match ? match[1] : "";
  // keep the token out of history/bookmarks shared later
  if (token && window.history.replaceState) {
    window.history.replaceState(null, "", window.location.pathname);
  }

  function show(state) {
    card.querySelectorAll("[data-offer-state]").forEach(function (el) {
      el.hidden = el.getAttribute("data-offer-state") !== state;
    });
  }
  function fill(attr, text) {
    card.querySelectorAll("[" + attr + "]").forEach(function (el) { el.textContent = text; });
  }
  function rupees(paise) {
    return "₹" + Math.round((Number(paise) || 0) / 100).toLocaleString("en-IN");
  }
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }
  function closed(title, message) {
    fill("data-offer-title", title);
    fill("data-offer-message", message);
    show("closed");
  }

  var CLOSED = {
    expired: ["This offer has expired", "Offers are open for a limited time. If you'd still like to sell your device, you can list it again."],
    closed: ["This offer is no longer available", "This listing has been closed. If you'd still like to sell your device, you can list it again."],
    cancelled: ["This sale was cancelled", "Nothing more is needed from you. If you'd still like to sell your device, you can list it again."],
    OFFER_NOT_FOUND: ["We couldn't find this offer", "Please open the link exactly as it appears in your email, or contact us."],
  };

  function renderHandover(offer) {
    var h = offer.handover || {};
    var vendor = h.vendor || {};
    fill("data-offer-handover-amount", rupees(h.amountPaise));
    fill("data-offer-deadline", when(h.deadlineAt));
    fill("data-offer-vendor-name", vendor.name || "the buyer");
    fill("data-offer-vendor-address", [vendor.shopAddress, vendor.shopCity].filter(Boolean).join(", ") ||
      "Call the buyer for the shop address.");
    var phone = card.querySelector("[data-offer-vendor-phone]");
    if (phone) {
      phone.textContent = vendor.phone ? "Call " + vendor.phone : "";
      if (vendor.phone) phone.href = "tel:+91" + vendor.phone;
      else phone.removeAttribute("href");
    }
    var revision = card.querySelector("[data-offer-revision]");
    revision.hidden = !h.revision;
    if (h.revision) {
      fill("data-offer-revision-amount", rupees(h.revision.amountPaise));
      fill("data-offer-revision-reason", h.revision.reason || "");
    }
    var codeBox = card.querySelector("[data-offer-code-box]");
    codeBox.hidden = !h.code;
    fill("data-offer-code", h.code || "");
    // the "I've been paid" step waits for any revised price, then gives way to the code
    card.querySelector("[data-offer-pay-step]").hidden = Boolean(h.code || h.revision);
    // once paid, cancelling is done through TEKRIO, not this page
    card.querySelector("[data-offer-cancel-box]").hidden = Boolean(h.sellerPaidConfirmed);
  }

  function render(offer) {
    var device = offer.device || {};
    fill("data-offer-device", [device.brand !== "Apple" ? device.brand : "", device.model, device.storage, device.ram ? device.ram + " RAM" : ""]
      .filter(Boolean).join(" · "));
    fill("data-offer-amount", rupees(offer.amountPaise));
    fill("data-offer-ref", offer.reference || "");
    fill("data-offer-expires", when(offer.expiresAt));
    if (offer.handover) renderHandover(offer);
    if (offer.status === "awaiting_seller") return show("open");
    if (["accepted", "checkin", "completed", "review"].indexOf(offer.status) >= 0) return show(offer.status);
    var text = CLOSED[offer.status] || CLOSED.closed;
    closed(text[0], text[1]);
  }

  function call(path, extra) {
    var body = { token: token };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, body: data };
      });
    });
  }
  // backend error codes that mean the offer itself is gone
  function closedText(body) {
    var code = (body && body.code) || "";
    return CLOSED[code] || (code === "OFFER_EXPIRED" ? CLOSED.expired : code === "OFFER_CLOSED" ? CLOSED.closed : null);
  }
  function failed(result) {
    var text = closedText(result.body);
    if (text) return closed(text[0], text[1]);
    closed("Something went wrong", (result.body && result.body.message) || "We couldn't load your offer right now. Please try again shortly.");
  }

  if (!token) {
    closed(CLOSED.OFFER_NOT_FOUND[0], CLOSED.OFFER_NOT_FOUND[1]);
    return;
  }

  call("/api/offer")
    .then(function (result) { return result.ok ? render(result.body.data) : failed(result); })
    .catch(function () { closed("Something went wrong", "Please check your connection and reload this page."); });

  // Every action is an explicit button press (a POST), never the link itself:
  // email security scanners open links automatically and must not act.
  var CONFIRM = {
    paid: "Confirm that the buyer has paid you? You'll then get the code that completes the sale.",
    "revision:decline": "Decline the new price? The sale will be cancelled and you keep your phone.",
    "cancel:changed_mind": "Cancel this sale? You keep your phone and nothing more is needed.",
    "checkin:sold": "Confirm you sold the phone to this buyer?",
  };
  function act(button) {
    var action = button.getAttribute("data-offer-action") || "accept";
    var value = button.getAttribute("data-value") || "";
    var question = CONFIRM[action + (value ? ":" + value : "")] || CONFIRM[action];
    if (question && !window.confirm(question)) return;
    var section = button.closest("[data-offer-state]");
    var statusEl = section.querySelector("[data-offer-status]");
    var extra = {};
    if (action === "revision") extra.decision = value;
    if (action === "checkin") extra.answer = value;
    if (action === "cancel") {
      extra.reason = value;
      var note = card.querySelector("[data-offer-note]");
      if (value === "vendor_problem") {
        if (!note.value.trim()) {
          note.focus();
          if (statusEl) {
            statusEl.textContent = "Tell us briefly what went wrong.";
            statusEl.className = "form-status show err";
          }
          return;
        }
        extra.note = note.value.trim();
      }
    }
    var label = button.innerHTML;
    button.disabled = true;
    button.textContent = "Please wait...";
    if (statusEl) statusEl.className = "form-status";
    call(action === "accept" ? "/api/offer/accept" : "/api/offer/" + action, extra)
      .then(function (result) {
        if (result.ok) {
          render(result.body.data);
          if (window.gtag) window.gtag("event", "offer_" + action + (value ? "_" + value : ""));
          return;
        }
        if (closedText(result.body)) return failed(result);
        if (statusEl) {
          statusEl.textContent = (result.body && result.body.message) || "Something went wrong. Please try again.";
          statusEl.classList.add("show", "err");
        }
      })
      .catch(function () {
        if (statusEl) {
          statusEl.textContent = "Network error. Please check your connection and try again.";
          statusEl.classList.add("show", "err");
        }
      })
      .finally(function () {
        button.disabled = false;
        button.innerHTML = label;
      });
  }
  card.querySelectorAll("[data-offer-accept], [data-offer-action]").forEach(function (button) {
    button.addEventListener("click", function () { act(button); });
  });
})();
