// 今晚吃什麼: a five-step funnel (形式 → 風味 → 偏好 → 距離 → 3 candidates) over places.json.
// What was eaten is kept in localStorage and, when configured, mirrored to the Apps Script sheet.
(function () {
  var L = DinnerLogic;
  var LS = { cfg: 'dp_cfg', history: 'dp_history', pending: 'dp_pending', mode: 'dp_mode' };
  var SOURCE_LABEL = { new: '新發現', common: '常吃', reviewed: '吃過好評', saved: '你存的' };
  var state = { mode: 'near', surprise: null, places: [], meta: null, history: [], step: 'home', sel: {}, shown: [], seen: {}, logged: {}, cfg: { url: '', secret: '' }, sync: '' };

  function load(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode: keep going in memory */ } }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { el.addEventListener(ev, attrs.on[ev]); });
      else if (k === 'class') el.className = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k]);
    });
    function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  }

  // ---- server sync (optional) ----
  function api(action, payload) {
    if (!state.cfg.url || !state.cfg.secret) return Promise.reject(new Error('未設定'));
    var body = JSON.stringify(Object.assign({ secret: state.cfg.secret, action: action }, payload || {}));
    return fetch(state.cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || '失敗'); return j; });
  }

  function flushPending() {
    var pending = load(LS.pending, []);
    if (!pending.length || !state.cfg.url) return Promise.resolve();
    return pending.reduce(function (chain, job) {
      return chain.then(function () { return api(job.action, job.payload); });
    }, Promise.resolve()).then(function () { save(LS.pending, []); });
  }

  function queue(action, payload) {
    return api(action, payload).catch(function () {
      var p = load(LS.pending, []); p.push({ action: action, payload: payload }); save(LS.pending, p);
      state.sync = '已存在手機，連上網路後會自動補傳';
    });
  }

  function syncHistory() {
    if (!state.cfg.url || !state.cfg.secret) return Promise.resolve();
    return flushPending().then(function () { return api('list'); }).then(function (j) {
      state.history = L.mergeHistory(state.history, j.meals);
      save(LS.history, state.history);
      state.sync = '';
    }).catch(function (e) { state.sync = '同步失敗：' + e.message; });
  }

  // ---- helpers ----
  function today() { return L.dateKey(new Date()); }
  function recent() { return L.recentNames(state.history, state.meta ? state.meta.avoid_recent_days : 7, today()); }
  function baseKm() { return L.MODES[state.mode].baseKm; }
  function fullSel() { return Object.assign({ maxKm: baseKm() }, state.sel, { exclude: recent() }); }
  function pool() { return L.filter(state.places, { maxKm: baseKm() }); }
  function defaultMode() { var d = new Date(), day = d.getDay(); return (day === 6 || day === 0 || (day === 5 && d.getHours() >= 15)) ? 'outing' : 'near'; }
  function setMode(m) { state.mode = m; save(LS.mode, m); render(); }
  function render() { var app = document.getElementById('app'); app.innerHTML = ''; app.appendChild(view()); }

  function reset() { state.sel = { tags: [] }; state.shown = []; state.seen = {}; state.logged = {}; state.step = 'home'; render(); }
  function go(step) { state.step = step; window.scrollTo(0, 0); render(); }

  // ---- views ----
  function header(title, back) {
    return h('header', { class: 'top' },
      back ? h('button', { class: 'iconbtn', 'aria-label': '上一步', on: { click: back } }, '←') : h('span', { class: 'iconbtn' }),
      h('h1', {}, title),
      h('button', { class: 'iconbtn', 'aria-label': '設定', on: { click: function () { go('settings'); } } }, '⚙'));
  }

  function crumbs() {
    var s = state.sel, items = [];
    if (s.form) items.push(s.form);
    if (s.cuisine) items.push(s.cuisine);
    (s.tags || []).forEach(function (t) { items.push(t); });
    if (s.maxKm != null && s.maxKm < 99) items.push('≤' + s.maxKm + ' 公里');
    if (state.mode === 'outing') items.unshift('出遊');
    return h('div', { class: 'crumbs' }, items.map(function (t) { return h('span', { class: 'chip' }, t); }));
  }

  function remaining() { return L.filter(state.places, fullSel()).length; }

  function modeSwitch() {
    return h('div', { class: 'seg' }, ['near', 'outing'].map(function (m) {
      return h('button', { class: 'segbtn' + (state.mode === m ? ' on' : ''), on: { click: function () { setMode(m); } } }, L.MODES[m].label);
    }));
  }

  function viewHome() {
    var hist = state.history.slice(0, 7);
    var ex = Object.keys(recent()).length;
    var n = pool().length;
    var sub = state.mode === 'near' ? '北投到石牌，' + n + ' 個選項' : '北投、石牌加全台北，' + n + ' 個選項';
    return h('div', {},
      header('今晚吃什麼', null),
      modeSwitch(),
      h('div', { class: 'hero' }, h('div', { class: 'big' }, state.mode === 'near' ? '🍜' : '🚇'),
        h('p', { class: 'sub' }, sub + (ex ? '（近 ' + (state.meta.avoid_recent_days) + ' 天吃過的 ' + ex + ' 間已先排除）' : ''))),
      h('button', { class: 'primary', on: { click: function () { state.sel = { tags: [] }; go('form'); } } }, '一步步幫我選'),
      h('div', { class: 'row' },
        h('button', { class: 'ghost', on: { click: function () { state.sel = { tags: [] }; state.step = 'results'; state.shown = []; state.seen = {}; drawMore(); render(); } } }, '直接給我 3 個'),
        h('button', { class: 'ghost surprise', on: { click: function () { state.sel = { tags: [] }; rollSurprise(); go('surprise'); } } }, '🎲 給我驚喜')),
      hist.length ? h('div', {}, h('p', { class: 'sub', style: 'margin-top:22px' }, '最近吃過'),
        h('ul', { class: 'hist' }, hist.map(function (m) { return h('li', {}, h('span', {}, m.name), h('span', { class: 'meta' }, m.date.slice(5))); }))) : null,
      state.sync ? h('p', { class: 'status err' }, state.sync) : null);
  }

  function optionsView(opts) {
    return h('div', { class: 'grid' }, opts);
  }

  function viewForm() {
    var counts = L.optionCounts(state.places, fullSel(), 'form');
    var order = L.FORMS;
    counts.sort(function (a, b) { return order.indexOf(a.value) - order.indexOf(b.value); });
    var btns = counts.map(function (o) {
      return h('button', { class: 'opt', on: { click: function () { state.sel.form = o.value; go('cuisine'); } } }, h('b', {}, o.value), h('small', {}, o.count + ' 個選項'));
    });
    btns.push(h('button', { class: 'opt wide', on: { click: function () { state.sel.form = null; go('cuisine'); } } }, h('b', {}, '都可以'), h('small', {}, '不限形式')));
    return h('div', {}, header('第 1 步', reset), crumbs(), h('p', { class: 'question' }, '想吃哪一種？'), h('p', { class: 'sub' }, '飯、麵、鍋物、肉、輕食（早午餐、漢堡、披薩）、小吃'), optionsView(btns));
  }

  function viewCuisine() {
    var counts = L.optionCounts(state.places, fullSel(), 'cuisine');
    var btns = counts.map(function (o) {
      return h('button', { class: 'opt', on: { click: function () { state.sel.cuisine = o.value; go('tags'); } } }, h('b', {}, o.value), h('small', {}, o.count + ' 個選項'));
    });
    btns.push(h('button', { class: 'opt wide', on: { click: function () { state.sel.cuisine = null; go('tags'); } } }, h('b', {}, '隨便'), h('small', {}, '不限風味')));
    return h('div', {}, header('第 2 步', function () { state.sel.cuisine = null; go('form'); }), crumbs(), h('p', { class: 'question' }, '什麼風味？'), h('p', { class: 'sub' }, '剩 ' + remaining() + ' 個選項'), optionsView(btns));
  }

  function viewTags() {
    var counts = L.optionCounts(state.places, fullSel(), 'tag');
    var on = state.sel.tags || [];
    var avail = {}; counts.forEach(function (o) { avail[o.value] = o.count; });
    var desc = { 健康: '低負擔、少油炸', 多菜: '蔬菜份量多', 清爽: '不油不膩', 重口: '想吃爽的' };
    var btns = L.TAGS.filter(function (t) { return avail[t] || on.indexOf(t) >= 0; }).map(function (t) {
      var sel = on.indexOf(t) >= 0;
      return h('button', { class: 'opt' + (sel ? ' on' : ''), on: { click: function () {
        state.sel.tags = sel ? on.filter(function (x) { return x !== t; }) : on.concat(t); render();
      } } }, h('b', {}, (sel ? '✓ ' : '') + t), h('small', {}, desc[t] + (avail[t] ? '・' + avail[t] + ' 個' : '')));
    });
    return h('div', {}, header('第 3 步', function () { state.sel.tags = []; go('cuisine'); }), crumbs(),
      h('p', { class: 'question' }, '有特別想要的嗎？'), h('p', { class: 'sub' }, '可複選，也可以不選'),
      optionsView(btns),
      h('div', { class: 'row' }, h('button', { class: 'primary', on: { click: function () { go('distance'); } } }, on.length ? '下一步' : '沒有，下一步')));
  }

  function viewDistance() {
    var btns = L.MODES[state.mode].bands.map(function (b) {
      var n = L.filter(state.places, Object.assign({}, fullSel(), { maxKm: b.maxKm })).length;
      return h('button', { class: 'opt' + (b.id === 'all' ? ' wide' : ''), disabled: n === 0 ? 'disabled' : false, on: { click: function () {
        state.sel.maxKm = Math.min(b.maxKm, baseKm()); state.shown = []; state.seen = {}; drawMore(); go('results');
      } } }, h('b', {}, b.label), h('small', {}, b.hint + '・' + n + ' 個'));
    });
    return h('div', {}, header('第 4 步', function () { go('tags'); }), crumbs(), h('p', { class: 'question' }, '要走多遠？'), optionsView(btns));
  }

  function drawMore() {
    var pool = L.filter(state.places, fullSel()).filter(function (p) { return !state.seen[p.id]; });
    if (pool.length < 3) { state.seen = {}; pool = L.filter(state.places, fullSel()); }
    state.shown = L.pick(pool, 3, Math.random);
    state.shown.forEach(function (p) { state.seen[p.id] = true; });
  }

  function logMeal(p) {
    var rec = L.mealRecord(p, today(), state.sel.form);
    state.history = L.mergeHistory(state.history, [rec]);
    save(LS.history, state.history);
    state.logged[p.id] = rec;
    queue('log', { meal: rec });
    render();
  }

  function undoMeal(p) {
    var rec = state.logged[p.id];
    state.history = state.history.filter(function (m) { return !(m.date === rec.date && m.name === rec.name); });
    save(LS.history, state.history);
    delete state.logged[p.id];
    queue('undo', { date: rec.date, name: rec.name });
    render();
  }

  function ratingLine(p) {
    if (p.rating == null) return h('div', { class: 'meta' }, p.cat || '');
    return h('div', { class: 'rate' }, h('span', { class: 'star' }, '★ ' + p.rating.toFixed(1)),
      p.reviews ? h('span', { class: 'meta' }, '（' + p.reviews.toLocaleString() + ' 則評論）') : null,
      p.cat ? h('span', { class: 'meta' }, '・' + p.cat) : null);
  }

  function emojiFor(p) {
    return p.forms.indexOf('麵') >= 0 ? '🍜' : p.forms.indexOf('鍋物') >= 0 ? '🍲' : p.forms.indexOf('肉') >= 0 ? '🥩'
      : p.forms.indexOf('輕食') >= 0 ? '🥪' : p.forms.indexOf('小吃') >= 0 ? '🥟' : '🍚';
  }

  function thumb(p, big) {
    var url = L.photoUrl(p.img, big ? 480 : 240, big ? 320 : 180);
    var cls = 'thumb' + (big ? ' big' : '');
    if (!url) return h('div', { class: cls }, h('div', { class: 'ph' }, emojiFor(p)));
    var img = h('img', { src: url, alt: p.name, loading: 'lazy', referrerpolicy: 'no-referrer' });
    var box = h('div', { class: cls }, img);
    img.addEventListener('error', function () { box.innerHTML = ''; box.appendChild(h('div', { class: 'ph' }, emojiFor(p))); });
    return box;
  }

  function distLine(p) {
    return p.km != null ? p.km + ' 公里' + (p.zone === 'far' ? '・出遊' : '') : '街邊／市場';
  }

  function mealButtons(p) {
    var done = state.logged[p.id];
    return h('div', { class: 'actions' },
      h('a', { class: 'ghost', href: p.url, target: '_blank', rel: 'noopener' }, '看地圖'),
      done ? h('button', { class: 'ghost', on: { click: function () { undoMeal(p); } } }, h('span', { class: 'done' }, '✓ 已記錄'), '（復原）')
           : h('button', { class: 'primary', on: { click: function () { logMeal(p); } } }, '今天吃這個'));
  }

  function card(p) {
    return h('div', { class: 'card' },
      thumb(p, false),
      h('div', { class: 'cbody' },
        h('h3', {}, p.name, h('span', { class: 'badge ' + p.source }, SOURCE_LABEL[p.source])),
        ratingLine(p),
        h('div', { class: 'meta' }, distLine(p) + (p.addr ? '・' + p.addr : '')),
        mealButtons(p)));
  }

  // ---- surprise ----
  function rollSurprise() {
    state.surprise = L.surprise(state.places, { maxKm: baseKm(), exclude: recent() }, Math.random);
  }

  function viewSurprise() {
    var p = state.surprise;
    var body = !p ? h('div', { class: 'empty' }, '找不到可以推薦的店。') :
      h('div', { class: 'card big' },
        thumb(p, true),
        h('p', { class: 'sub', style: 'margin:10px 0 2px' }, '🎉 今晚就吃這間！'),
        h('h3', {}, p.name, h('span', { class: 'badge ' + p.source }, SOURCE_LABEL[p.source])),
        ratingLine(p),
        h('div', { class: 'meta' }, distLine(p) + (p.addr ? '・' + p.addr : '')),
        mealButtons(p));
    return h('div', {}, header('給我驚喜', function () { go('home'); }), body,
      h('div', { class: 'row' },
        h('button', { class: 'ghost', on: { click: function () { rollSurprise(); render(); } } }, '🎲 再抽一次'),
        h('button', { class: 'ghost', on: { click: reset } }, '回首頁')));
  }

  function viewResults() {
    var total = remaining();
    return h('div', {}, header('今晚推薦', function () { go('distance'); }), crumbs(),
      state.shown.length ? h('div', {}, state.shown.map(card)) : h('div', { class: 'empty' }, '條件太嚴格，沒有符合的店。', h('br', {}), '回上一步放寬看看。'),
      h('p', { class: 'sub' }, '符合條件共 ' + total + ' 個' + (state.sync ? '・' + state.sync : '')),
      h('div', { class: 'row' },
        h('button', { class: 'ghost', on: { click: function () { drawMore(); render(); } } }, '換一批'),
        h('button', { class: 'ghost', on: { click: reset } }, '重新開始')));
  }

  function viewSettings() {
    var f = h('form', { class: 'settings', on: { submit: function (e) {
      e.preventDefault();
      state.cfg = { url: f.elements.url.value.trim(), secret: f.elements.secret.value };
      save(LS.cfg, state.cfg);
      state.sync = '同步中…'; go('home');
      syncHistory().then(render);
    } } },
      h('p', { class: 'sub' }, '填入後，吃過的紀錄會同步到你的 Google 試算表，換手機也不會丟。不填也能用，紀錄只存在這支手機。'),
      h('label', { for: 's-url' }, 'Apps Script 網址（/exec 結尾）'),
      h('input', { id: 's-url', name: 'url', type: 'url', value: state.cfg.url, autocomplete: 'off' }),
      h('label', { for: 's-secret' }, '暗號（APP_SECRET）'),
      h('input', { id: 's-secret', name: 'secret', type: 'password', value: state.cfg.secret, autocomplete: 'off' }),
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, '儲存並同步')),
      h('p', { class: 'status' }, '資料更新於 ' + (state.meta ? state.meta.built : '') + '・共 ' + state.places.length + ' 個選項（北投石牌 ' + state.places.filter(function (x) { return x.zone === 'near'; }).length + '、出遊 ' + state.places.filter(function (x) { return x.zone === 'far'; }).length + '）・近 ' + (state.meta ? state.meta.avoid_recent_days : 7) + ' 天吃過的不會再出現'));
    return h('div', {}, header('設定', function () { go('home'); }), f);
  }

  function view() {
    switch (state.step) {
      case 'form': return viewForm();
      case 'cuisine': return viewCuisine();
      case 'tags': return viewTags();
      case 'distance': return viewDistance();
      case 'results': return viewResults();
      case 'surprise': return viewSurprise();
      case 'settings': return viewSettings();
      default: return viewHome();
    }
  }

  // ---- boot ----
  state.cfg = load(LS.cfg, { url: '', secret: '' });
  state.history = load(LS.history, []);
  state.mode = load(LS.mode, null) || defaultMode();
  fetch('places.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
    state.places = d.places; state.meta = d.meta; state.sel = { tags: [] };
    render();
    syncHistory().then(render);
  }).catch(function () {
    document.getElementById('app').appendChild(h('p', { class: 'empty' }, '讀不到餐廳資料，請確認網路後重新開啟。'));
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache is optional */ });
})();
