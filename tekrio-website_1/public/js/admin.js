(function () {
  "use strict";

  // /admin leads dashboard: search, type filter and sort, all in the
  // browser. The page lists every lead without this script; the controls
  // only narrow and reorder that list. The current view is kept in the URL
  // (?q=&type=&sort=) so a refresh or a shared link shows the same thing.
  var tbody = document.getElementById("leadRows");
  var controls = document.getElementById("leadControls");
  if (!tbody || !controls) return;
  var search = document.getElementById("leadSearch");
  var type = document.getElementById("leadType");
  var sort = document.getElementById("leadSort");
  var count = document.getElementById("leadCount");
  var empty = document.getElementById("leadEmpty");
  var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr[data-type]"));
  if (!rows.length) return;
  controls.hidden = false;

  function byTime(dir) {
    return function (a, b) { return dir * (a.dataset.time - b.dataset.time); };
  }
  // text sort; leads with no value go last, ties fall back to newest first
  function byText(key, dir) {
    return function (a, b) {
      var x = a.dataset[key], y = b.dataset[key];
      if (!x !== !y) return x ? -1 : 1;
      return dir * x.localeCompare(y, "en", { sensitivity: "base" }) || b.dataset.time - a.dataset.time;
    };
  }
  var SORTS = {
    newest: byTime(-1),
    oldest: byTime(1),
    "name-az": byText("name", 1),
    "name-za": byText("name", -1),
    "city-az": byText("city", 1),
  };

  function apply() {
    // every word must appear somewhere in the lead, in any order
    var words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    var shown = 0;
    rows.sort(SORTS[sort.value] || SORTS.newest).forEach(function (row) {
      var match =
        (!type.value || row.dataset.type === type.value) &&
        words.every(function (w) { return row.dataset.search.indexOf(w) >= 0; });
      row.hidden = !match;
      if (match) shown++;
      tbody.appendChild(row);
    });
    count.textContent = "Showing " + shown + " of " + rows.length + " leads";
    empty.hidden = shown > 0;

    var params = new URLSearchParams();
    if (search.value.trim()) params.set("q", search.value.trim());
    if (type.value) params.set("type", type.value);
    if (sort.value !== "newest") params.set("sort", sort.value);
    var qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  var initial = new URLSearchParams(location.search);
  search.value = initial.get("q") || "";
  type.value = initial.get("type") || "";
  if (type.selectedIndex < 0) type.value = "";
  sort.value = initial.get("sort") || "newest";
  if (sort.selectedIndex < 0) sort.value = "newest";

  search.addEventListener("input", apply);
  type.addEventListener("change", apply);
  sort.addEventListener("change", apply);
  apply();
})();
