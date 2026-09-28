(function () {
  "use strict";

  // ---------- mobile nav ----------
  var toggle = document.getElementById("navToggle");
  var panel = document.getElementById("mobilePanel");
  if (toggle && panel) {
    toggle.addEventListener("click", function () {
      var open = panel.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    // Escape closes the open menu and returns focus to the toggle
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("open")) {
        panel.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
    panel.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        panel.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // ---------- Register dropdown ----------
  // close it on an outside click, on Escape, or after choosing an option
  document.querySelectorAll(".reg-menu").forEach(function (menu) {
    document.addEventListener("click", function (e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    menu.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });
    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { menu.open = false; });
    });
  });

  // ---------- footer year ----------
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ---------- FAQ accordion ----------
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q");
    var a = item.querySelector(".faq-a");
    if (!q || !a) return;
    q.addEventListener("click", function () {
      var isOpen = item.classList.contains("open");
      // close siblings within the same list for a cleaner read
      var list = item.closest(".faq-list");
      if (list) {
        list.querySelectorAll(".faq-item.open").forEach(function (openItem) {
          if (openItem !== item) {
            openItem.classList.remove("open");
            openItem.querySelector(".faq-a").style.maxHeight = null;
            openItem.querySelector(".faq-q").setAttribute("aria-expanded", "false");
          }
        });
      }
      item.classList.toggle("open", !isOpen);
      q.setAttribute("aria-expanded", (!isOpen).toString());
      a.style.maxHeight = !isOpen ? a.scrollHeight + "px" : null;
    });
  });

  // ---------- lead forms ----------
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

  function validateForm(form) {
    var valid = true;
    form.querySelectorAll("[data-field]").forEach(function (field) {
      var input = field.querySelector("input, select, textarea");
      if (!input) return;
      var value = (input.value || "").trim();
      var rule = field.getAttribute("data-rule");
      var required = input.hasAttribute("required");
      var message = "";

      if (required && !value) {
        message = "This field is required.";
      } else if (value && rule === "mobile" && !/^[6-9]\d{9}$/.test(value)) {
        message = "Enter a valid 10-digit Indian mobile number.";
      } else if (value && rule === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        message = "Enter a valid email address.";
      } else if (value && rule === "gst" && !/^[0-9A-Z]{15}$/i.test(value)) {
        message = "GSTIN should be 15 characters (letters and numbers).";
      } else if (value && rule === "pan" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(value)) {
        message = "PAN should be in the format ABCDE1234F.";
      }

      if (message) valid = false;
      setFieldError(field, message);
    });
    return valid;
  }

  document.querySelectorAll("form[data-lead-form]").forEach(function (form) {
    var statusEl = form.querySelector(".form-status");
    var submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (statusEl) {
        statusEl.className = "form-status";
        statusEl.textContent = "";
      }

      if (!validateForm(form)) {
        if (statusEl) {
          statusEl.textContent = "Please fix the highlighted fields.";
          statusEl.classList.add("show", "err");
        }
        var firstBad = form.querySelector("[aria-invalid=true]");
        if (firstBad) firstBad.focus();
        return;
      }

      var leadType = form.getAttribute("data-lead-form");
      var payload = {};
      new FormData(form).forEach(function (value, key) {
        payload[key] = value;
      });
      // honeypot check (client-side convenience; server re-checks)
      if (payload._hp) return;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = "Submitting...";
      }

      fetch("/api/leads/" + leadType, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok) {
            form.reset();
            if (statusEl) {
              statusEl.textContent =
                result.data.message ||
                "Thanks! Our team will reach out shortly.";
              statusEl.classList.add("show", "ok");
            }
            if (window.gtag) {
              window.gtag("event", "generate_lead", { lead_type: leadType });
            }
          } else {
            if (statusEl) {
              statusEl.textContent =
                (result.data && result.data.message) ||
                "Something went wrong. Please try again or WhatsApp us.";
              statusEl.classList.add("show", "err");
            }
          }
        })
        .catch(function () {
          if (statusEl) {
            statusEl.textContent =
              "Network error. Please check your connection and try again.";
            statusEl.classList.add("show", "err");
          }
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtn.dataset.originalText;
          }
        });
    });
  });
})();
