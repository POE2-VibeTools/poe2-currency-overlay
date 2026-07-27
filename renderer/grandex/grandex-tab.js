// Grand Expedition tab: rumor -> island planner + prep guide for the league
// mechanic. Scaffold - the planner UI lands here once the research spec is
// signed off (rumor picking, island deduction, confirmed list, prep guide).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  function render() {
    const root = $('grandex-root');
    if (!root || root.classList.contains('hidden')) return;
    root.innerHTML = '';
    const wrap = el('div', 'gx-wrap');
    wrap.appendChild(el('div', 'gx-placeholder', 'Grand Expedition planner - under construction.'));
    root.appendChild(wrap);
  }

  window.GrandEx = { render };
})();
