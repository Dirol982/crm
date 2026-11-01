/*! CRM tracker — визиты, страницы, источники, время на сайте, точки выхода, события, заказы.
 *  Подключение: <script async src="https://YOUR-CRM/t.js" data-key="pk_..."></script>
 *  API:  crm('lead', {email, name, phone})       — заявка (создаст контакт)
 *        crm('identify', {email, name, phone})   — привязать посетителя к контакту
 *        crm('purchase', {id, amount, currency, items, email}) — покупка
 *        crm('event', 'name', {props}, value)    — произвольное событие
 *        crm('ids') -> {visitor, session}        — для передачи на сервер при оформлении заказа
 */
(function (w, d) {
  'use strict';
  var script = d.currentScript || d.querySelector('script[data-key]');
  if (!script) return;
  var KEY = script.getAttribute('data-key');
  var ENDPOINT = script.getAttribute('data-endpoint') || script.src.replace(/\/t\.js(\?.*)?$/, '/t');
  var SESSION_TTL = 30 * 60 * 1000;
  // Контент из CRM (публикации, страницы, блоки) показываем всем, включая поисковых роботов;
  // cms.js грузится, только если на странице есть контейнеры
  function loadCms() {
    if (!d.querySelector('[data-crm-posts],[data-crm-post],[data-crm-block]')) return;
    var s = d.createElement('script');
    s.async = true;
    s.src = script.src.replace(/\/t\.js(\?.*)?$/, '/cms.js');
    s.setAttribute('data-crm-cms', '');
    s.setAttribute('data-key', KEY);
    if (script.hasAttribute('data-no-style')) s.setAttribute('data-no-style', '');
    d.head.appendChild(s);
  }
  if (KEY) { if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', loadCms); else loadCms(); }

  if (!KEY || navigator.webdriver || /bot|crawl|spider|headless/i.test(navigator.userAgent)) return;
  if (navigator.doNotTrack === '1' && script.hasAttribute('data-respect-dnt')) return;

  function uid() {
    if (w.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  var mem = {};
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }

  var visitor = get('_crm_v');
  if (!visitor) { visitor = uid(); set('_crm_v', visitor); }

  // Новая сессия: нет активности 30 минут или пришли с новыми UTM-метками
  var params = new URLSearchParams(location.search);
  var utm = {};
  ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) {
    var v = params.get('utm_' + k);
    if (v) utm[k] = v;
  });
  if (!utm.source && params.get('yclid')) { utm.source = 'yandex'; utm.medium = 'cpc'; }
  if (!utm.source && params.get('gclid')) { utm.source = 'google'; utm.medium = 'cpc'; }

  var now = Date.now();
  var session = get('_crm_s');
  var last = +(get('_crm_t') || 0);
  if (!session || now - last > SESSION_TTL || utm.source) { session = uid(); set('_crm_s', session); }
  set('_crm_t', String(now));

  function send(data, beacon) {
    data.k = KEY; data.v = visitor; data.s = session;
    set('_crm_t', String(Date.now()));
    var body = JSON.stringify(data);
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
    }
    try {
      fetch(ENDPOINT, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors', credentials: 'omit' });
    } catch (e) {}
  }

  var pv = null, pvStart = 0, hiddenAt = 0, hiddenTotal = 0, firstPv = true;

  function visibleSec() {
    var ms = Date.now() - pvStart - hiddenTotal - (hiddenAt ? Date.now() - hiddenAt : 0);
    return Math.max(0, Math.round(ms / 1000));
  }
  // Время на странице запоминаем локально: если маяк при уходе не дошёл
  // (переход по ссылке), оно досылается со следующей страницы.
  function snapshot() { if (pv) set('_crm_pend', JSON.stringify({ p: pv.p, u: pv.u, s: session, d: visibleSec() })); }
  function flushPending() {
    var raw = get('_crm_pend');
    if (!raw) return;
    set('_crm_pend', '');
    try { var x = JSON.parse(raw); if (x && x.p && x.s === session && (!pv || x.p !== pv.p)) send({ t: 'leave', p: x.p, u: x.u, d: x.d }); } catch (e) {}
  }
  setInterval(function () { if (d.visibilityState === 'visible') snapshot(); }, 5000);

  function pageview() {
    var path = location.pathname + (location.hash.indexOf('#/') === 0 ? location.hash : '');
    if (pv && pv.u === path) return;
    leave(false);
    flushPending();
    pv = { p: uid(), u: path };
    pvStart = Date.now(); hiddenTotal = 0; hiddenAt = 0;
    var data = { t: 'pv', p: pv.p, u: path, ti: d.title, h: location.hostname };
    if (firstPv) { data.r = d.referrer; data.utm = utm; firstPv = false; }
    send(data);
  }

  function leave(beacon) {
    if (!pv) return;
    snapshot();
    send({ t: 'leave', p: pv.p, u: pv.u, d: visibleSec() }, beacon);
    if (!beacon) set('_crm_pend', '');
  }

  d.addEventListener('visibilitychange', function () {
    if (d.visibilityState === 'hidden') { hiddenAt = Date.now(); leave(true); }
    else if (hiddenAt) {
      hiddenTotal += Date.now() - hiddenAt; hiddenAt = 0;
      if (Date.now() - +(get('_crm_t') || 0) > SESSION_TTL) { session = uid(); set('_crm_s', session); firstPv = true; pv = null; pageview(); }
    }
  });
  w.addEventListener('pagehide', function () { leave(true); });

  // SPA: отслеживаем pushState/replaceState/popstate
  ['pushState', 'replaceState'].forEach(function (fn) {
    var orig = history[fn];
    history[fn] = function () { var r = orig.apply(this, arguments); setTimeout(pageview, 0); return r; };
  });
  w.addEventListener('popstate', pageview);
  w.addEventListener('hashchange', pageview);

  function who(o) {
    if (!o) return undefined;
    var r = {};
    if (o.email) r.email = String(o.email);
    if (o.name) r.name = String(o.name);
    if (o.phone) r.phone = String(o.phone);
    return (r.email || r.phone || r.name) ? r : undefined;
  }

  function api(cmd, a, b, c) {
    switch (cmd) {
      case 'event': return send({ t: 'ev', n: String(a), props: b || {}, val: typeof c === 'number' ? c : undefined, u: location.pathname });
      case 'lead': return send({ t: 'ev', n: 'lead', props: a || {}, who: who(a), u: location.pathname });
      case 'identify': return send({ t: 'id', who: who(a) });
      case 'purchase':
        a = a || {};
        return send({ t: 'order', u: location.pathname, who: who(a), order: { id: a.id ? String(a.id) : undefined, amount: +a.amount || 0, currency: a.currency, items: a.items } });
      case 'ids': return { visitor: visitor, session: session };
    }
  }

  // Очередь вызовов, сделанных до загрузки скрипта: window.crm = window.crm || function(){(crm.q=crm.q||[]).push(arguments)}
  var queued = (w.crm && w.crm.q) || [];
  w.crm = api;
  pageview();
  for (var i = 0; i < queued.length; i++) api.apply(null, queued[i]);

  // Автозахват форм с email/телефоном как заявок (отключается data-no-forms)
  if (!script.hasAttribute('data-no-forms')) {
    d.addEventListener('submit', function (e) {
      var f = e.target;
      if (!f || !f.elements || f.hasAttribute('data-crm-ignore')) return;
      var o = {};
      for (var j = 0; j < f.elements.length; j++) {
        var el = f.elements[j], n = ((el.name || '') + ' ' + (el.type || '')).toLowerCase();
        if (!el.value || el.type === 'password' || el.type === 'hidden') continue;
        if (!o.email && /mail/.test(n)) o.email = el.value;
        else if (!o.phone && /(phone|tel)/.test(n)) o.phone = el.value;
        else if (!o.name && /(name|имя|fio)/.test(n)) o.name = el.value;
      }
      if (o.email || o.phone) api('lead', o);
    }, true);
  }
})(window, document);
