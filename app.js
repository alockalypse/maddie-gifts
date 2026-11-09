(function () {
  'use strict';

  var cfg = window.REGISTRY_CONFIG || {};
  var DEMO = !cfg.API_URL;
  var CREDS_KEY = 'registry.creds';

  var state = {
    creds: null,
    displayName: '',
    gifts: [],
    busy: {},          // giftId -> true while a request is in flight
    category: 'All',
    view: 'all',       // all | needed | mine
    layout: 'list',    // list (default) | grid, remembered per device
    budget: null,      // max price, or null for any
    sort: 'suggested', // suggested | price-asc | price-desc | name
    pollTimer: null,
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- storage (wrapped: can throw in some contexts) ---------- */
  function loadCreds() { try { return JSON.parse(localStorage.getItem(CREDS_KEY)); } catch (e) { return null; } }
  function saveCreds(c) { try { localStorage.setItem(CREDS_KEY, JSON.stringify(c)); } catch (e) {} }
  function clearCreds() { try { localStorage.removeItem(CREDS_KEY); } catch (e) {} }

  /* ---------- API ---------- */
  function api(action, extra) {
    var body = Object.assign({ action: action }, state.creds || {}, extra || {});
    if (DEMO) return demoApi(body);
    return fetch(cfg.API_URL, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script can't answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    }).then(function (res) { return res.text(); })
      .then(function (txt) {
        try { return JSON.parse(txt); }
        catch (e) { return { ok: false, error: 'Unexpected response from server' }; }
      });
  }

  /* ---------- demo backend (only used when API_URL is empty) ---------- */
  var demo = {
    users: [{ username: 'test', password: 'oak-penguin-42', displayName: 'Test User' }],
    gifts: [
      { id: 'g1', name: 'Baby bodysuits (6-12m)', description: 'Any plain colours', link: 'https://example.com', price: '£12', imageUrl: '', category: 'Clothes', qtyWanted: 6, sortOrder: 1 },
      { id: 'g2', name: 'Board book set', description: 'Touch-and-feel books', link: '', price: '£20', imageUrl: '', category: 'Books', qtyWanted: 1, sortOrder: 2 },
      { id: 'g3', name: 'Bath thermometer', description: '', link: '', price: '£8', imageUrl: '', category: 'Bath time', qtyWanted: 1, sortOrder: 3 },
      { id: 'g4', name: 'Soft play mat', description: 'Something washable', link: '', price: '£35', imageUrl: '', category: 'Play', qtyWanted: 1, sortOrder: 4 },
    ],
    claims: [{ giftId: 'g2', username: 'someone-else', qty: 1 }],
  };
  function demoList(u) {
    return demo.gifts.map(function (g) {
      var total = 0, mine = 0;
      demo.claims.forEach(function (c) { if (c.giftId === g.id) { total += c.qty; if (c.username === u) mine += c.qty; } });
      return Object.assign({}, g, { remaining: Math.max(0, g.qtyWanted - total), myQty: mine });
    });
  }
  function demoApi(b) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var u = demo.users.find(function (x) { return x.username === String(b.username || '').trim().toLowerCase() && x.password === b.password; });
        if (!u) return resolve({ ok: false, error: 'Invalid username or password' });
        var name = u.username;
        if (b.action === 'login') return resolve({ ok: true, displayName: u.displayName });
        if (b.action === 'list') return resolve({ ok: true, displayName: u.displayName, gifts: demoList(name) });
        if (b.action === 'claim') {
          var g = demoList(name).find(function (x) { return x.id === b.giftId; });
          var q = Math.max(1, parseInt(b.qty, 10) || 1);
          if (!g || q > g.remaining) return resolve({ ok: false, error: 'Someone just claimed this', gifts: demoList(name) });
          demo.claims.push({ giftId: b.giftId, username: name, qty: q });
          return resolve({ ok: true, gifts: demoList(name) });
        }
        if (b.action === 'unclaim') {
          demo.claims = demo.claims.filter(function (c) { return !(c.giftId === b.giftId && c.username === name); });
          return resolve({ ok: true, gifts: demoList(name) });
        }
        resolve({ ok: false, error: 'Unknown action' });
      }, 350);
    });
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtPrice(p) {
    if (p === '' || p == null) return '';
    if (typeof p === 'number') {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: p % 1 ? 2 : 0 }).format(p);
    }
    return String(p);
  }
  function priceNum(p) {
    if (typeof p === 'number') return p;
    var m = String(p == null ? '' : p).replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function money(n) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function show(view) {
    $('login-view').hidden = view !== 'login';
    $('list-view').hidden = view !== 'list';
    $('loading').hidden = view !== 'loading';
    $('user-box').hidden = view !== 'list';
  }

  /* ---------- rendering ---------- */
  function isDone(g) { return g.remaining === 0 && g.myQty === 0; }

  function renderCategories() {
    var cats = ['All'];
    state.gifts.forEach(function (g) { if (g.category && cats.indexOf(g.category) === -1) cats.push(g.category); });
    if (cats.indexOf(state.category) === -1) state.category = 'All';
    var box = $('categories');
    box.hidden = cats.length <= 2;
    box.innerHTML = cats.map(function (c) {
      return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === state.category) + '">' + esc(c) + '</button>';
    }).join('');
  }

  function giftCard(g) {
    var cls = 'card gift' + (g.myQty > 0 ? ' is-mine' : '') + (isDone(g) ? ' is-done' : '');
    var img = safeUrl(g.imageUrl)
      ? '<img src="' + esc(safeUrl(g.imageUrl)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span aria-hidden="true">🎁</span>';
    var link = safeUrl(g.link)
      ? '<a class="shop-link" href="' + esc(safeUrl(g.link)) + '" target="_blank" rel="noopener noreferrer">View item ↗</a>'
      : '';
    var multi = g.qtyWanted > 1;
    var need = multi ? '<span class="tag">' + g.remaining + ' of ' + g.qtyWanted + ' left</span>' : '';
    var busy = !!state.busy[g.id];
    var dis = busy ? ' disabled' : '';

    var actions = '';
    if (g.myQty > 0) {
      actions += '<span class="status mine">✓ You\'re getting ' + (multi ? g.myQty : 'this') + '</span>' +
        '<button type="button" class="btn secondary" data-action="unclaim" data-id="' + esc(g.id) + '"' + dis + '>Undo</button>';
    }
    if (g.remaining > 0) {
      if (multi) {
        var opts = '';
        for (var i = 1; i <= g.remaining; i++) opts += '<option value="' + i + '">' + i + '</option>';
        actions += '<select class="qty" aria-label="How many" data-qty-for="' + esc(g.id) + '"' + dis + '>' + opts + '</select>';
      }
      actions += '<button type="button" class="btn" data-action="claim" data-id="' + esc(g.id) + '"' + dis + '>' +
        (busy ? 'Saving…' : (g.myQty > 0 ? 'Add more' : 'I\'ll get this')) + '</button>';
    } else if (g.myQty === 0) {
      actions += '<span class="status done">Already sorted ✓</span>';
    }

    return '<article class="' + cls + '">' +
      '<div class="gift-img' + (safeUrl(g.imageUrl) ? '' : ' no-img') + '">' + img + '</div>' +
      '<div class="gift-body">' +
        '<div class="gift-top"><h3 class="gift-name">' + esc(g.name) + '</h3>' +
          (fmtPrice(g.price) ? '<span class="price">' + esc(fmtPrice(g.price)) + '</span>' : '') + '</div>' +
        (g.description ? '<p class="desc">' + esc(g.description) + '</p>' : '') +
        '<div class="meta">' + (g.category ? '<span class="tag">' + esc(g.category) + '</span>' : '') + need + link + '</div>' +
        '<div class="actions">' + actions + '</div>' +
      '</div></article>';
  }

  function renderBudget() {
    var prices = state.gifts.map(function (g) { return priceNum(g.price); }).filter(function (n) { return n != null; });
    var box = $('budget-box');
    if (prices.length < 2) { box.hidden = true; state.budget = null; return; }
    var max = Math.ceil(Math.max.apply(null, prices));
    var min = Math.floor(Math.min.apply(null, prices));
    if (max <= min) { box.hidden = true; state.budget = null; return; }
    box.hidden = false;
    var slider = $('budget');
    slider.min = String(min);
    slider.max = String(max);
    if (state.budget != null && state.budget >= max) state.budget = null;
    slider.value = String(state.budget == null ? max : Math.max(min, state.budget));
    $('budget-out').textContent = state.budget == null ? 'Any' : 'Up to ' + money(state.budget);
  }

  function renderLayout() {
    $('gifts').classList.toggle('as-list', state.layout === 'list');
    Array.prototype.forEach.call(document.querySelectorAll('[data-layout]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-layout') === state.layout));
    });
  }

  function compareGifts(a, b) {
    var byOrder = (a.sortOrder || 0) - (b.sortOrder || 0);
    if (state.sort === 'name') return String(a.name).localeCompare(String(b.name), 'en-GB', { sensitivity: 'base' }) || byOrder;
    if (state.sort === 'price-asc' || state.sort === 'price-desc') {
      var pa = priceNum(a.price), pb = priceNum(b.price);
      if (pa == null && pb == null) return byOrder;
      if (pa == null) return 1;   // unpriced gifts go last either way
      if (pb == null) return -1;
      return (state.sort === 'price-asc' ? pa - pb : pb - pa) || byOrder;
    }
    return byOrder;
  }

  function render() {
    renderCategories();
    renderBudget();
    renderLayout();
    var list = state.gifts
      .filter(function (g) { return state.category === 'All' || g.category === state.category; })
      .filter(function (g) {
        if (state.budget == null) return true;
        var n = priceNum(g.price);
        return n == null || n <= state.budget;
      })
      .filter(function (g) {
        if (state.view === 'mine') return g.myQty > 0;
        if (state.view === 'needed') return g.remaining > 0;
        return true;
      })
      .slice()
      .sort(function (a, b) { return (isDone(a) - isDone(b)) || compareGifts(a, b); });

    $('gifts').innerHTML = list.map(giftCard).join('');
    $('empty').hidden = list.length > 0;
    $('empty').textContent = state.view === 'mine'
      ? 'You haven\'t picked anything yet.'
      : state.budget != null ? 'Nothing in that budget. Try nudging the slider up.'
      : state.view === 'needed' ? 'Everything here is sorted!' : 'Nothing to show here.';
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === state.view));
    });

    var open = state.gifts.filter(function (g) { return g.remaining > 0; }).length;
    var mine = state.gifts.filter(function (g) { return g.myQty > 0; }).length;
    $('summary').textContent = open + ' of ' + state.gifts.length + ' gifts still available' +
      (mine ? ' · you\'re getting ' + mine : '');
  }

  /* ---------- flows ---------- */
  function applyGifts(res) {
    if (res && Array.isArray(res.gifts)) { state.gifts = res.gifts; render(); }
  }

  function refresh(quiet) {
    if (!state.creds) return Promise.resolve();
    return api('list').then(function (res) {
      if (!res.ok) {
        if (/invalid username or password/i.test(res.error || '')) return logout('Your login no longer works. Please sign in again.');
        if (!quiet) toast(res.error || 'Could not load the list');
        return;
      }
      state.displayName = res.displayName || state.displayName;
      $('greeting').textContent = 'Hi, ' + state.displayName;
      applyGifts(res);
    }).catch(function () { if (!quiet) toast('Network problem. Retrying shortly.'); });
  }

  function startPolling() {
    stopPolling();
    var secs = Math.max(5, Number(cfg.pollSeconds) || 10);
    state.pollTimer = setInterval(function () {
      if (document.visibilityState === 'visible' && Object.keys(state.busy).length === 0) refresh(true);
    }, secs * 1000);
  }
  function stopPolling() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }

  function enterList() {
    show('loading');
    return refresh(false).then(function () {
      if (state.creds) { show('list'); startPolling(); }
    });
  }

  function logout(msg) {
    stopPolling();
    state.creds = null;
    state.gifts = [];
    clearCreds();
    $('password').value = '';
    $('login-error').textContent = msg || '';
    show('login');
  }

  function act(action, id) {
    if (state.busy[id]) return;
    var extra = { giftId: id };
    if (action === 'claim') {
      var sel = document.querySelector('[data-qty-for="' + CSS.escape(id) + '"]');
      extra.qty = sel ? Number(sel.value) : 1;
    }
    // Optimistic update: show the change immediately, then reconcile with the server
    var before = state.gifts.map(function (g) { return Object.assign({}, g); });
    state.gifts = state.gifts.map(function (g) {
      if (g.id !== id) return g;
      var n = Object.assign({}, g);
      if (action === 'claim') { var q = Math.min(extra.qty, n.remaining); n.remaining -= q; n.myQty += q; }
      else { n.remaining = Math.min(n.qtyWanted, n.remaining + n.myQty); n.myQty = 0; }
      return n;
    });
    state.busy[id] = true;
    render();
    api(action, extra).then(function (res) {
      delete state.busy[id];
      if (!res.ok) toast(res.error || 'Something went wrong');
      else if (action === 'claim') toast('Thank you! Marked as yours.');
      if (res.gifts) applyGifts(res); else { state.gifts = before; render(); refresh(true); }
    }).catch(function () {
      delete state.busy[id];
      state.gifts = before;
      render();
      toast('Network problem. Please try again.');
    });
  }

  /* ---------- events ---------- */
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var creds = { username: $('username').value.trim(), password: $('password').value };
    var btn = $('login-btn');
    btn.disabled = true;
    $('login-error').textContent = '';
    state.creds = creds;
    api('login').then(function (res) {
      btn.disabled = false;
      if (!res.ok) { state.creds = null; $('login-error').textContent = res.error || 'Could not sign in'; return; }
      state.displayName = res.displayName;
      saveCreds(creds);
      enterList();
    }).catch(function () {
      btn.disabled = false;
      state.creds = null;
      $('login-error').textContent = 'Network problem. Please try again.';
    });
  });

  $('logout').addEventListener('click', function () { logout(); });

  $('gifts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-action]');
    if (b) act(b.getAttribute('data-action'), b.getAttribute('data-id'));
  });

  $('categories').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cat]');
    if (b) { state.category = b.getAttribute('data-cat'); render(); }
  });

  $('views').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (b) { state.view = b.getAttribute('data-view'); render(); }
  });

  $('layouts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-layout]');
    if (!b) return;
    state.layout = b.getAttribute('data-layout');
    try { localStorage.setItem('registry.layout', state.layout); } catch (err) {}
    render();
  });

  $('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    try { localStorage.setItem('registry.sort', state.sort); } catch (err) {}
    render();
  });

  $('budget').addEventListener('input', function (e) {
    var v = Number(e.target.value);
    state.budget = v >= Number(e.target.max) ? null : v;
    render();
  });

  try { if (localStorage.getItem('registry.layout') === 'grid') state.layout = 'grid'; } catch (e) {}
  try {
    var savedSort = localStorage.getItem('registry.sort');
    if (['suggested', 'price-asc', 'price-desc', 'name'].indexOf(savedSort) !== -1) state.sort = savedSort;
  } catch (e) {}
  $('sort').value = state.sort;

  /* ---------- theme ---------- */
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }
  function syncThemeButton() {
    var dark = currentTheme() === 'dark';
    var b = $('theme-toggle');
    b.textContent = dark ? '☀️' : '🌙';
    b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  $('theme-toggle').addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('registry.theme', next); } catch (e) {}
    syncThemeButton();
  });
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', syncThemeButton);
  syncThemeButton();

  window.addEventListener('focus', function () { if (state.creds) refresh(true); });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.creds) refresh(true);
  });

  /* ---------- boot ---------- */
  if (cfg.title) { $('title').textContent = cfg.title; document.title = cfg.title; }
  if (cfg.subtitle) $('subtitle').textContent = cfg.subtitle;
  $('demo-banner').hidden = !DEMO;

  var saved = loadCreds();
  if (saved && saved.username && saved.password) {
    state.creds = saved;
    $('username').value = saved.username;
    enterList();
  } else {
    show('login');
  }
})();
