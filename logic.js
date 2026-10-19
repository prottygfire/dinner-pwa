// Pure functions for the dinner picker: filtering, option counts, weighted picking, recent-meal exclusion.
// No DOM, no network. Tested in Node (tests/logic.test.js) and loaded as a plain script in the browser.
var DinnerLogic = (function () {
  var FORMS = ['飯', '麵', '鍋物', '肉', '輕食', '小吃'];
  var TAGS = ['健康', '多菜', '清爽', '重口'];
  var DISTANCE_BANDS = [
    { id: 'near', label: '很近', hint: '步行 15 分鐘內（約 1.2 公里）', maxKm: 1.2 },
    { id: 'mid', label: '騎車可到', hint: '騎車約 10 分鐘（2.5 公里內）', maxKm: 2.5 },
    { id: 'all', label: '都可以', hint: '北投到石牌（4 公里內）', maxKm: 99 }
  ];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function daysBetween(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  }

  // Names eaten in the last `days` days (today counts), so the picker can hide them.
  function recentNames(history, days, today) {
    var out = {};
    (history || []).forEach(function (m) {
      var age = daysBetween(m.date, today);
      if (age >= 0 && age < days) out[m.name] = true;
    });
    return out;
  }

  // sel: { form, cuisine, tags: [], maxKm, exclude: {name:true} }. Missing/empty fields mean "any".
  // Entries with no address (street food, dishes) have km === null and pass every distance limit.
  function matches(p, sel) {
    if (sel.exclude && sel.exclude[p.name]) return false;
    if (sel.form && p.forms.indexOf(sel.form) < 0) return false;
    if (sel.cuisine && p.cuisines.indexOf(sel.cuisine) < 0) return false;
    if (sel.tags && sel.tags.length) {
      for (var i = 0; i < sel.tags.length; i++) if (p.tags.indexOf(sel.tags[i]) < 0) return false;
    }
    if (sel.maxKm != null && p.km != null && p.km > sel.maxKm) return false;
    return true;
  }

  function filter(places, sel) {
    return places.filter(function (p) { return matches(p, sel); });
  }

  // For one funnel step: how many places each option would leave, given the other choices already made.
  // field: 'form' | 'cuisine' | 'tag'. Returns [{value, count}] sorted by count desc, zero-count options dropped.
  function optionCounts(places, sel, field) {
    var base = {};
    Object.keys(sel).forEach(function (k) { base[k] = sel[k]; });
    var counts = {};
    if (field === 'tag') {
      TAGS.forEach(function (t) {
        var s = Object.assign({}, base, { tags: (base.tags || []).concat(t) });
        counts[t] = filter(places, s).length;
      });
    } else {
      var key = field === 'form' ? 'form' : 'cuisine';
      var pool = filter(places, Object.assign({}, base, { form: key === 'form' ? null : base.form, cuisine: key === 'cuisine' ? null : base.cuisine }));
      pool.forEach(function (p) {
        (key === 'form' ? p.forms : p.cuisines).forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
      });
    }
    return Object.keys(counts).filter(function (v) { return counts[v] > 0; })
      .map(function (v) { return { value: v, count: counts[v] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // Weight favours well-rated, well-reviewed places. Unrated entries (street food) get an average weight.
  function weight(p) {
    var r = p.rating == null ? 4.2 : p.rating;
    var w = Math.pow(Math.max(r - 3, 0.2), 2);
    if (p.reviews >= 100) w *= 1.15;
    return w;
  }

  // Weighted sampling without replacement. rng() returns [0,1).
  function pick(places, n, rng) {
    var pool = places.slice(), out = [];
    while (out.length < n && pool.length) {
      var total = pool.reduce(function (s, p) { return s + weight(p); }, 0);
      var r = rng() * total, idx = 0;
      for (; idx < pool.length - 1; idx++) { r -= weight(pool[idx]); if (r < 0) break; }
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  // Meals to ask the server to keep: just the fields the sheet stores.
  function mealRecord(p, date, form) {
    return { date: date, name: p.name, source: p.source, form: form || (p.forms[0] || ''), cuisine: p.cuisines[0] || '' };
  }

  // Merge local and server history; one record per (date, name).
  function mergeHistory(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (m) {
      var k = m.date + '|' + m.name;
      if (!seen[k]) { seen[k] = true; out.push(m); }
    });
    return out.sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : 0; });
  }

  return {
    FORMS: FORMS, TAGS: TAGS, DISTANCE_BANDS: DISTANCE_BANDS,
    dateKey: dateKey, daysBetween: daysBetween, recentNames: recentNames,
    matches: matches, filter: filter, optionCounts: optionCounts, weight: weight, pick: pick,
    mealRecord: mealRecord, mergeHistory: mergeHistory
  };
})();
if (typeof module !== 'undefined') module.exports = DinnerLogic;
