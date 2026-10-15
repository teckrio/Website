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

  // ---------- header shadow once the page scrolls ----------
  var siteHeader = document.querySelector(".site-header");
  if (siteHeader) {
    var updateHeaderShadow = function () {
      siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    updateHeaderShadow();
    window.addEventListener("scroll", updateHeaderShadow, { passive: true });
  }

  // ---------- back-to-top button (injected, no template changes needed) ----------
  var backToTop = document.createElement("button");
  backToTop.className = "back-to-top";
  backToTop.type = "button";
  backToTop.setAttribute("aria-label", "Back to top");
  backToTop.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(backToTop);
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  window.addEventListener(
    "scroll",
    function () {
      backToTop.classList.toggle("show", window.scrollY > 600);
    },
    { passive: true }
  );
  backToTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
  });

  // ---------- sticky "sell" bar on phones (CSS hides it on wider screens) ----------
  // Shows once the visitor scrolls past the hero; hides again near the
  // page's own sell buttons (CTA band, footer) and never shows on /sell.
  if (!/^\/sell/.test(location.pathname)) {
    var sellBar = document.createElement("div");
    sellBar.className = "mobile-sell-bar";
    sellBar.setAttribute("role", "region");
    sellBar.setAttribute("aria-label", "Sell your device");
    sellBar.innerHTML =
      '<span>Get the best offer for your device</span><a href="/sell.html" class="btn btn-gold">Sell now</a>';
    sellBar.inert = true;
    document.body.appendChild(sellBar);
    var endZoneInView = false;
    var updateSellBar = function () {
      var show = window.scrollY > 480 && !endZoneInView;
      sellBar.classList.toggle("is-shown", show);
      sellBar.inert = !show;
      document.body.classList.toggle("has-sell-bar", show);
    };
    if ("IntersectionObserver" in window) {
      var endZones = document.querySelectorAll(".cta-band, .site-footer");
      var inView = new Set();
      var endObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) inView.add(entry.target);
          else inView.delete(entry.target);
        });
        endZoneInView = inView.size > 0;
        updateSellBar();
      });
      endZones.forEach(function (el) {
        endObserver.observe(el);
      });
    }
    window.addEventListener("scroll", updateSellBar, { passive: true });
    updateSellBar();
  }

  // ---------- scroll-reveal on repeated content (steps, cards, marks, etc.) ----------
  // Progressive enhancement only: every element below is already fully visible
  // without JS/CSS support, this just animates it into place as it scrolls in.
  if ("IntersectionObserver" in window && !reduceMotion.matches) {
    var revealTargets = document.querySelectorAll(
      ".section-head, .cta-band .container, .form-card, .story .section-head, .contact-grid, .two-col, .compare-wrap"
    );
    var revealGroups = document.querySelectorAll(
      ".steps, .marks-grid, .card-grid, .audience-grid"
    );
    // Positive bottom rootMargin fires the reveal while the content is still
    // just below the viewport, so it's already animating by the time it's seen
    // instead of waiting for it to sit mostly in view first.
    // Toggle (not a one-time add) so content keeps popping in every time it
    // scrolls into view, not just the first time the page loads.
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          entry.target.classList.toggle("is-visible", entry.isIntersecting);
        });
      },
      { threshold: 0.01, rootMargin: "0px 0px 180px 0px" }
    );
    revealTargets.forEach(function (el) {
      el.classList.add("reveal");
      revealObserver.observe(el);
    });
    revealGroups.forEach(function (el) {
      el.classList.add("reveal-group");
      revealObserver.observe(el);
    });
  }

  // Everything below is motion only. With reduced motion the markup's
  // finished state is what people see (all offers in, rail full, text lit).
  var motionOK = !reduceMotion.matches;
  function clamp01(n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // ---------- hero: buyer offers stack up, then the best one is picked ----------
  var offerCard = document.querySelector("[data-offer-stack]");
  if (offerCard && motionOK && "IntersectionObserver" in window) {
    var offerItems = offerCard.querySelectorAll(".dc-offer-item");
    var bestItem = offerCard.querySelector("[data-best]");
    var countEl = offerCard.querySelector("[data-offer-count]");
    var offerTimers = [];
    var offerPlaying = false;
    var later = function (fn, ms) {
      offerTimers.push(setTimeout(fn, ms));
    };
    var setCount = function (n) {
      if (countEl) countEl.textContent = n + (n === 1 ? " buyer" : " buyers");
    };
    var resetOffers = function () {
      offerItems.forEach(function (item) {
        item.classList.remove("is-in", "is-gone");
      });
      bestItem.classList.remove("is-best", "is-final");
      offerCard.classList.remove("is-picked");
      setCount(0);
    };
    var playOffers = function () {
      resetOffers();
      offerItems.forEach(function (item, i) {
        later(function () {
          item.classList.add("is-in");
          setCount(i + 1);
        }, 500 + i * 750);
      });
      // highlight the highest bid, then fold the rest away so the
      // customer is left with just the best offer
      var pickAt = 500 + offerItems.length * 750 + 400;
      later(function () {
        bestItem.classList.add("is-best");
      }, pickAt);
      later(function () {
        offerItems.forEach(function (item) {
          if (item !== bestItem) item.classList.add("is-gone");
        });
        bestItem.classList.add("is-final");
        offerCard.classList.add("is-picked");
      }, pickAt + 1300);
      // hold the finished card, clear it, and go again
      later(function () {
        bestItem.classList.remove("is-in");
      }, pickAt + 5300);
      later(playOffers, pickAt + 6000);
    };
    var stopOffers = function () {
      offerTimers.forEach(clearTimeout);
      offerTimers = [];
    };
    // pin the list at its full four-offer height so the card keeps its
    // size while bids fold away
    var offerList = offerCard.querySelector(".dc-offers");
    offerList.style.minHeight = offerList.offsetHeight + "px";
    offerCard.classList.add("is-animating");
    resetOffers();
    // only run while the hero is on screen and the tab is visible
    var offerVisible = false;
    var syncOffers = function () {
      var shouldPlay = offerVisible && !document.hidden;
      if (shouldPlay && !offerPlaying) playOffers();
      if (!shouldPlay && offerPlaying) stopOffers();
      offerPlaying = shouldPlay;
    };
    new IntersectionObserver(function (entries) {
      offerVisible = entries[0].isIntersecting;
      syncOffers();
    }).observe(offerCard);
    document.addEventListener("visibilitychange", syncOffers);
  }

  // ---------- brand strip: endless scroll ----------
  document.querySelectorAll("[data-marquee]").forEach(function (marquee) {
    if (!motionOK) return;
    var track = marquee.querySelector(".marquee-track");
    // second copy is for the seamless loop only; screen readers skip it
    Array.prototype.slice.call(track.children).forEach(function (li) {
      var copy = li.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      track.appendChild(copy);
    });
    marquee.classList.add("is-running");
  });

  // ---------- glow that follows the pointer on cards ----------
  if (window.matchMedia("(hover: hover)").matches) {
    document.querySelectorAll(".audience-col, .card-grid .card").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", e.clientX - r.left + "px");
        card.style.setProperty("--my", e.clientY - r.top + "px");
      });
    });
  }

  // ---------- scroll-linked: step timelines and the lit statement ----------
  var timelines = Array.prototype.slice.call(document.querySelectorAll(".steps-5"));
  var statements = Array.prototype.slice.call(document.querySelectorAll("[data-scroll-statement]"));

  timelines.forEach(function (steps) {
    steps.classList.add("has-rail");
    if (!motionOK) {
      steps.style.setProperty("--progress", 1);
      steps.querySelectorAll(".step").forEach(function (s) {
        s.classList.add("is-reached");
      });
    }
  });

  if (motionOK) {
    // split the statement into words so each one can light up in turn
    statements.forEach(function (el) {
      var words = el.textContent.trim().split(/\s+/);
      el.textContent = "";
      words.forEach(function (word, i) {
        var span = document.createElement("span");
        span.className = "sw";
        span.textContent = word;
        el.appendChild(span);
        if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
      });
    });

    var narrow = window.matchMedia("(max-width: 799px)");
    var wide = window.matchMedia("(min-width: 1100px)");
    var ticking = false;
    var updateScrollMotion = function () {
      ticking = false;
      var vh = window.innerHeight;

      timelines.forEach(function (steps) {
        var r = steps.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) return;
        var vertical = narrow.matches;
        if (!vertical && !wide.matches) {
          // tablet grid has no rail: every step counts as reached
          steps.querySelectorAll(".step").forEach(function (s) {
            s.classList.add("is-reached");
          });
          return;
        }
        // across: fill while the row climbs from 80% to 35% of the screen;
        // down: fill as the column passes the 70% line
        var p = vertical
          ? clamp01((vh * 0.7 - r.top) / r.height)
          : clamp01((vh * 0.8 - r.top) / (vh * 0.45));
        steps.style.setProperty("--progress", p.toFixed(3));
        steps.querySelectorAll(".step").forEach(function (s) {
          var at = vertical
            ? (s.offsetTop + 45) / steps.clientHeight
            : (s.offsetLeft + 25) / steps.clientWidth;
          s.classList.toggle("is-reached", p >= at);
        });
      });

      statements.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) return;
        // lit from when its top reaches 85% of the screen until its bottom reaches 55%
        var p = clamp01((vh * 0.85 - r.top) / (vh * 0.3 + r.height));
        var words = el.children;
        var n = words.length;
        for (var i = 0; i < n; i++) {
          words[i].style.setProperty("--lit", clamp01(p * n - i).toFixed(2));
        }
      });
    };
    var requestScrollMotion = function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateScrollMotion);
      }
    };
    window.addEventListener("scroll", requestScrollMotion, { passive: true });
    window.addEventListener("resize", requestScrollMotion);
    updateScrollMotion();
  }
})();
