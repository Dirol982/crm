/*! CRM content — вывод публикаций, страниц и блоков из CRM на любом сайте.
 *  Подгружается автоматически кодом трекера t.js, если на странице есть контейнеры:
 *
 *  <div data-crm-posts data-limit="10" data-tag="новости"></div>
 *      лента публикаций; если в адресе есть ?post=slug — показывает саму статью
 *  <div data-crm-post data-slug="about" data-type="page"></div>
 *      одна статья или страница (slug по умолчанию берётся из ?post=)
 *  <div data-crm-block="header-banner"></div>
 *      блок (баннер, объявление) — показывается по расписанию из CRM
 *
 *  data-link="/blog/{slug}"  — свой шаблон ссылок на статьи (по умолчанию ?post={slug})
 *  data-no-style             — не подключать стандартные стили (на <script> трекера)
 */
(function (w, d) {
  'use strict';
  var script = d.currentScript || d.querySelector('script[data-crm-cms]');
  if (!script || w.__crmCms) return;
  w.__crmCms = true;
  var KEY = script.getAttribute('data-key');
  var BASE = script.src.replace(/\/cms\.js(\?.*)?$/, '');
  if (!KEY) return;
  var API = BASE + '/c/' + encodeURIComponent(KEY);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function get(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function fmtDate(s) {
    try { return new Date(s).toLocaleDateString(d.documentElement.lang || 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
  }
  function param(name) { return new URLSearchParams(location.search).get(name); }
  function linkFor(el, slug) {
    var tpl = el.getAttribute('data-link');
    if (tpl) return tpl.replace('{slug}', encodeURIComponent(slug));
    var u = new URL(location.href); u.searchParams.set('post', slug); u.hash = '';
    return u.pathname + u.search;
  }
  function track(name, props) { if (typeof w.crm === 'function') try { w.crm('event', name, props); } catch (e) {} }

  if (!script.hasAttribute('data-no-style') && !d.getElementById('crm-cms-style')) {
    var st = d.createElement('style');
    st.id = 'crm-cms-style';
    st.textContent =
      '.crm-list{display:grid;gap:24px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}' +
      '.crm-card{display:flex;flex-direction:column;gap:8px;color:inherit;text-decoration:none}' +
      '.crm-card img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px}' +
      '.crm-card h3{margin:0;font-size:1.15em;line-height:1.3}.crm-card:hover h3{text-decoration:underline}' +
      '.crm-meta{opacity:.65;font-size:.88em}.crm-excerpt{margin:0;opacity:.85}' +
      '.crm-more{margin-top:24px;padding:10px 18px;border-radius:8px;border:1px solid currentColor;background:none;color:inherit;font:inherit;cursor:pointer}' +
      '.crm-article{max-width:760px;margin:0 auto;line-height:1.65}.crm-article h1{line-height:1.2;margin:.2em 0 .4em}' +
      '.crm-article img,.crm-article iframe{max-width:100%;height:auto;border-radius:10px}.crm-article iframe{aspect-ratio:16/9;width:100%}' +
      '.crm-article blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid currentColor;opacity:.85}' +
      '.crm-cover{width:100%;border-radius:12px;margin:12px 0 20px}.crm-back{display:inline-block;margin-bottom:12px}' +
      '.crm-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:24px}.crm-tag{padding:2px 10px;border-radius:999px;background:rgba(127,127,127,.15);font-size:.85em}';
    d.head.appendChild(st);
  }

  function renderArticle(el, slug, type, withBack) {
    el.innerHTML = '<p class="crm-meta">Загрузка…</p>';
    get(API + '/posts/' + encodeURIComponent(slug) + '?type=' + type).then(function (p) {
      var back = '';
      if (withBack) { var u = new URL(location.href); u.searchParams.delete('post'); back = '<a class="crm-back" href="' + esc(u.pathname + u.search) + '">← Все публикации</a>'; }
      el.innerHTML = '<article class="crm-article">' + back +
        (type === 'post' ? '<div class="crm-meta">' + esc(fmtDate(p.published_at)) + '</div>' : '') +
        '<h1>' + esc(p.title) + '</h1>' +
        (p.cover_url ? '<img class="crm-cover" src="' + esc(p.cover_url) + '" alt="">' : '') +
        '<div class="crm-content">' + p.content + '</div>' + // HTML очищен на сервере CRM
        (p.tags && p.tags.length ? '<div class="crm-tags">' + p.tags.map(function (t) { return '<span class="crm-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
        '</article>';
      if (el.hasAttribute('data-crm-posts') || el.hasAttribute('data-seo')) {
        d.title = p.seo_title || p.title;
        var m = d.querySelector('meta[name="description"]');
        if (!m) { m = d.createElement('meta'); m.name = 'description'; d.head.appendChild(m); }
        m.content = p.seo_description || p.excerpt || '';
      }
      track('post_view', { slug: p.slug, type: type });
    }).catch(function () { el.innerHTML = '<p class="crm-meta">Публикация не найдена</p>'; });
  }

  function renderList(el) {
    var slug = param('post');
    if (slug) return renderArticle(el, slug, 'post', true);
    var limit = +(el.getAttribute('data-limit') || 10);
    var tag = el.getAttribute('data-tag');
    var offset = 0;
    el.innerHTML = '<div class="crm-list"></div>';
    var list = el.firstChild;
    function load() {
      var url = API + '/posts?limit=' + limit + '&offset=' + offset + (tag ? '&tag=' + encodeURIComponent(tag) : '');
      get(url).then(function (r) {
        var old = el.querySelector('.crm-more'); if (old) old.remove();
        if (!r.items.length && offset === 0) { list.innerHTML = '<p class="crm-meta">Публикаций пока нет</p>'; return; }
        r.items.forEach(function (p) {
          var a = d.createElement('a');
          a.className = 'crm-card';
          a.href = linkFor(el, p.slug);
          a.innerHTML = (p.cover_url ? '<img src="' + esc(p.cover_url) + '" alt="" loading="lazy">' : '') +
            '<div class="crm-meta">' + esc(fmtDate(p.published_at)) + '</div><h3>' + esc(p.title) + '</h3>' +
            (p.excerpt ? '<p class="crm-excerpt">' + esc(p.excerpt) + '</p>' : '');
          list.appendChild(a);
        });
        offset += r.items.length;
        if (offset < r.total) {
          var b = d.createElement('button');
          b.className = 'crm-more'; b.type = 'button'; b.textContent = 'Показать ещё';
          b.onclick = load;
          el.appendChild(b);
        }
      }).catch(function () { list.innerHTML = '<p class="crm-meta">Не удалось загрузить публикации</p>'; });
    }
    load();
  }

  function renderBlocks(els) {
    get(API + '/blocks').then(function (blocks) {
      els.forEach(function (el) {
        var html = blocks[el.getAttribute('data-crm-block')];
        if (html) { el.innerHTML = html; el.hidden = false; } else { el.hidden = true; }
      });
    }).catch(function () {});
  }

  function init() {
    Array.prototype.forEach.call(d.querySelectorAll('[data-crm-posts]'), renderList);
    Array.prototype.forEach.call(d.querySelectorAll('[data-crm-post]'), function (el) {
      var slug = el.getAttribute('data-slug') || param('post');
      if (slug) renderArticle(el, slug, el.getAttribute('data-type') === 'page' ? 'page' : 'post', false);
    });
    var blocks = d.querySelectorAll('[data-crm-block]');
    if (blocks.length) renderBlocks(Array.prototype.slice.call(blocks));
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
