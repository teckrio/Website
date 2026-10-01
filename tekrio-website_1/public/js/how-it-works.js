/**
 * How It Works: scroll story.
 * A sticky phone swaps screens as each step scrolls past a trigger
 * line (middle of the viewport on desktop, lower on phones where the
 * phone is pinned at the top). Also feeds two CSS variables:
 *   --enter    0..1  the phone rising into place as the section arrives
 *   --progress 0..1  how far through the five steps the reader is
 * Without JS the steps still read as a normal list.
 */
(function () {
  "use strict";
  var story = document.querySelector("[data-story]");
  if (!story) return;

  var steps = [].slice.call(story.querySelectorAll(".story-step"));
  var screens = [].slice.call(story.querySelectorAll(".story-screen"));
  var dots = [].slice.call(story.querySelectorAll(".story-dots i"));
  var phone = story.querySelector(".story-phone");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var current = -1;
  var ticking = false;

  story.classList.add("is-ready");

  // Screens are drawn at a fixed 600px-tall design size and scaled to
  // whatever height the phone has at this viewport.
  function measure() {
    story.style.setProperty("--s", (phone.clientHeight / 600).toFixed(4));
  }

  function clamp(n) { return Math.min(1, Math.max(0, n)); }

  function setActive(index) {
    if (index === current) return;
    current = index;
    steps.forEach(function (el, n) { el.classList.toggle("is-active", n === index); });
    screens.forEach(function (el, n) {
      el.classList.toggle("is-active", n === index);
      el.classList.toggle("is-past", n < index);
    });
    dots.forEach(function (el, n) { el.classList.toggle("is-active", n === index); });
  }

  function update() {
    ticking = false;
    var vh = window.innerHeight;
    var narrow = window.innerWidth < 900;
    var trigger = vh * (narrow ? 0.78 : 0.5);

    var index = 0;
    var tops = steps.map(function (el) { return el.getBoundingClientRect().top; });
    tops.forEach(function (top, n) { if (top < trigger) index = n; });
    setActive(index);

    var first = tops[0];
    var last = tops[tops.length - 1];
    var progress = last > first ? clamp((trigger - first) / (last - first)) : 0;
    var enter = reduceMotion.matches ? 1 : clamp((vh - story.getBoundingClientRect().top) / (vh * 0.7));

    story.style.setProperty("--progress", progress.toFixed(3));
    story.style.setProperty("--enter", enter.toFixed(3));
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () { measure(); onScroll(); });
  measure();
  update();
})();
