'use strict';
// The badge shown over the game while reprice mode is on. It says two things: that the
// mode is live, and what the last read actually did - because "it did nothing" and "it
// read 95 and wrote 86" look identical from the game's side otherwise.
(function () {
  const ruleEl = document.getElementById('rule');
  const lastEl = document.getElementById('last');

  window.api.onRepriceState((s) => {
    if (!s) return;
    if (typeof s.rule === 'string') ruleEl.textContent = s.rule;
    // The last result STAYS until another one replaces it.
    //
    // It used to clear itself after a couple of seconds, on the reasoning that a stale
    // number reads as though it applies to whatever is in front of you now. In practice
    // that is backwards: the number is the receipt for what went on your clipboard, and
    // the clipboard does not expire either. Glancing up after pasting and finding the
    // badge already blank tells you nothing about what you just pasted.
    // Every outcome updates the badge, including "nothing changed". A badge frozen on an
    // older result is worse than an unhelpful one: it looks like the click never happened.
    if (s.read) {
      lastEl.textContent = s.read.unchanged
        ? s.read.base + ' → unchanged'
        : s.read.base + ' → ' + s.read.result;
    }
    if (s.miss) lastEl.textContent = s.miss;
    report();
  });

  // The result no longer clears itself, so the badge has to be wide enough to hold it
  // indefinitely rather than briefly. A fixed width was survivable when the text vanished
  // after two seconds; permanently clipped is not.
  function report() {
    try {
      const wrap = document.getElementById('wrap');
      if (window.api.reportWidth && wrap) window.api.reportWidth(Math.ceil(wrap.scrollWidth) + 2);
    } catch { }
  }
  report();
})();
