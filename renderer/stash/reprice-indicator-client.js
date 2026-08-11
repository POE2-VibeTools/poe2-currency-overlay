'use strict';
// The badge shown over the game while reprice mode is on. It says two things: that the
// mode is live, and what the last read actually did - because "it did nothing" and "it
// read 95 and wrote 86" look identical from the game's side otherwise.
(function () {
  const ruleEl = document.getElementById('rule');
  const lastEl = document.getElementById('last');
  let clearTimer = null;

  window.api.onRepriceState((s) => {
    if (!s) return;
    if (typeof s.rule === 'string') ruleEl.textContent = s.rule;
    if (s.read) {
      // A result stays up briefly, then clears - a stale number on screen is worse than
      // no number, because it looks like it applies to the item now in front of you.
      lastEl.textContent = s.read.base + ' → ' + s.read.result;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { lastEl.textContent = ''; }, 2500);
    }
    if (s.miss) {
      lastEl.textContent = s.miss;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { lastEl.textContent = ''; }, 2000);
    }
  });
})();
