'use strict';
// The reprice arithmetic, in ONE place. The settings screen uses it to draw its worked
// examples and main uses it to produce the number that reaches the clipboard, so the
// preview can never promise something the feature does not do.
//
// A rule is { op: 'subtract'|'add', value: number, mode: 'flat'|'percent' }.
// A config is { combine, rules: [ruleA, ruleB], threshold }.
//
//   combine 'single'    -> rule A, always
//   combine 'bigger'    -> whichever rule moves the price FURTHER from where it started
//   combine 'smaller'   -> whichever moves it least
//   combine 'threshold' -> rule A when price >= threshold, rule B when it is under
//
// "bigger" compares the SIZE OF THE CHANGE, not the resulting price. On a 100 item,
// -10% moves it by 10 and -2 moves it by 2, so it takes the 10. On a 5 item those are
// 0.5 and 2, so it takes the 2. That is the point of the pairing: percent governs the
// expensive listings, flat governs the cheap ones, without you switching modes by hand.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RepriceRules = api;
})(typeof self !== 'undefined' ? self : this, function () {

  function applyRule(base, rule) {
    const v = Number(rule && rule.value);
    if (!Number.isFinite(v) || v < 0) return base;
    const delta = rule.mode === 'percent' ? base * (v / 100) : v;
    return rule.op === 'add' ? base + delta : base - delta;
  }

  // A listing of 0 is not a listing, and the game wants a whole number.
  function settle(n) {
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.round(n));
  }

  // A NODE is either a leaf rule, or a branch that chooses between two nodes:
  //   leaf      { op, value, mode }
  //   bigger    { pick: 'bigger'|'smaller', a: node, b: node }
  //   price     { if: 'price>=', at: number,   a: node, b: node }
  //   currency  { if: 'currency', is: 'chaos', a: node, b: node }
  // Branches nest, so "if Divine then whichever is smaller [x,y] else [...]" is just a
  // currency branch whose a is a pick branch. Evaluation is recursive; the UI decides
  // how much of this it is willing to expose, and today it exposes one level.
  function evaluate(base, node, ctx) {
    if (!node) return base;
    if (node.pick) {
      const ra = evaluate(base, node.a, ctx), rb = evaluate(base, node.b, ctx);
      const da = Math.abs(base - ra), db = Math.abs(base - rb);
      return node.pick === 'smaller' ? (da <= db ? ra : rb) : (da >= db ? ra : rb);
    }
    if (node.if === 'price>=') {
      const at = Number(node.at);
      if (!Number.isFinite(at)) return evaluate(base, node.a, ctx);
      return evaluate(base, base >= at ? node.a : node.b, ctx);
    }
    if (node.if === 'currency') {
      // ctx.currency is whatever the reader identified, or null when it could not tell.
      // Unknown takes the ELSE branch: guessing a currency would silently misprice.
      const cur = ctx && ctx.currency ? String(ctx.currency).toLowerCase() : null;
      return evaluate(base, cur && cur === String(node.is || '').toLowerCase() ? node.a : node.b, ctx);
    }
    return applyRule(base, node); // leaf
  }

  function apply(base, cfg, ctx) {
    base = Number(base);
    if (!Number.isFinite(base) || base <= 0) return null;
    const node = cfg && cfg.tree ? cfg.tree
      : (cfg && cfg.branches ? treeFromBranches(cfg.branches) : treeFromFlat(cfg));
    if (!node) return null;
    return settle(evaluate(base, node, ctx || {}));
  }

  // The settings screen still speaks the flat shape (one combine + two rules). Turn it
  // into a tree so there is exactly one evaluator.
  function treeFromFlat(cfg) {
    const rules = (cfg && cfg.rules) || [];
    const a = rules[0], b = rules[1];
    if (!a) return null;
    const combine = (cfg && cfg.combine) || 'single';
    if (combine === 'single' || !b) return a;
    if (combine === 'threshold') return { if: 'price>=', at: cfg.threshold, a, b };
    // An unidentified currency takes the else branch - see evaluate(). That is why this
    // reads "if the currency is X" and not "if it is not X": the fallback has to be the
    // safe side, and the safe side is the branch that does not assume.
    if (combine === 'currency') return { if: 'currency', is: cfg.currency, a, b };
    return { pick: combine === 'smaller' ? 'smaller' : 'bigger', a, b };
  }

  // ---------- branch lists ----------
  //
  // What the settings screen actually edits: an ordered list of branches, read top to
  // bottom, the last one being the catch-all.
  //
  //   branch = { when: {type:'always'} | {type:'currency', is} | {type:'price>=', at},
  //              action: { combine: 'single'|'bigger'|'smaller', rules: [ruleA, ruleB] } }
  //
  // A LIST rather than a free-form tree on purpose. Every case anyone described - a
  // different pairing per currency, a different pairing per price band - is a sequence of
  // tests with an otherwise at the end, and a list makes that shape impossible to get
  // wrong. Conditions nested inside conditions would be strictly more expressive and much
  // easier to build something unreadable with.
  //
  // Folding right is what turns the list into the if/else-if chain the evaluator wants:
  // each branch's else is everything below it.
  function actionTree(action) {
    const a = action && action.rules && action.rules[0];
    if (!a) return null;
    const b = action.rules[1];
    const combine = (action && action.combine) || 'single';
    if (combine === 'single' || !b) return a;
    return { pick: combine === 'smaller' ? 'smaller' : 'bigger', a, b };
  }

  function treeFromBranches(branches) {
    const list = Array.isArray(branches) ? branches.filter(Boolean) : [];
    if (!list.length) return null;
    let node = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const br = list[i];
      const act = actionTree(br.action);
      if (!act) continue;
      const w = br.when || { type: 'always' };
      if (w.type === 'currency') node = { if: 'currency', is: w.is, a: act, b: node };
      else if (w.type === 'price>=') node = { if: 'price>=', at: Number(w.at), a: act, b: node };
      else node = act;   // always - anything below it is unreachable, which is correct
    }
    return node;
  }

  // A branch whose else is missing would return the price unchanged, so a list that ends
  // on a condition still needs a floor. Guarantee one rather than trusting the UI.
  function normaliseBranches(branches) {
    const list = (Array.isArray(branches) ? branches : []).filter((b) => b && b.action);
    if (!list.length) return [];
    const last = list[list.length - 1];
    if (!last.when || last.when.type !== 'always') {
      list.push({ when: { type: 'always' }, action: { combine: 'single', rules: [{ op: 'subtract', value: 0, mode: 'flat' }] } });
    }
    return list;
  }

  // Two worked examples at different magnitudes. One example cannot show what a paired
  // rule does, because the whole reason to pair rules is that they disagree by size.
  function examples(cfg) {
    const bases = [100, 5];
    return bases.map((b) => ({ base: b, result: apply(b, cfg) })).filter((e) => e.result != null);
  }

  // The single flat rule the app stored before branch lists existed, as a one or two
  // branch list. Runs for anyone upgrading, so their existing setting survives untouched
  // instead of being replaced by a default.
  function flatToBranches(c) {
    const rules = [
      { op: c.repriceOp || 'subtract', value: Number(c.repriceValue), mode: c.repriceMode || 'flat' },
      { op: c.repriceOp2 || 'subtract', value: Number(c.repriceValue2), mode: c.repriceMode2 || 'flat' },
    ];
    const combine = c.repriceCombine || 'single';
    // threshold and currency were if/else in one control; as branches they become two
    // entries, which is the same thing written out
    if (combine === 'threshold') {
      return [
        { when: { type: 'price>=', at: Number.isFinite(Number(c.repriceThreshold)) ? Number(c.repriceThreshold) : 20 },
          action: { combine: 'single', rules: [rules[0]] } },
        { when: { type: 'always' }, action: { combine: 'single', rules: [rules[1]] } },
      ];
    }
    if (combine === 'currency') {
      return [
        { when: { type: 'currency', is: c.repriceCurrency || 'divine' },
          action: { combine: 'single', rules: [rules[0]] } },
        { when: { type: 'always' }, action: { combine: 'single', rules: [rules[1]] } },
      ];
    }
    return [{ when: { type: 'always' }, action: { combine, rules } }];
  }

  // Pull a config out of overlay-config.json. Branch lists are the current shape; the old
  // flat keys are migrated on read.
  function fromConfig(c) {
    c = c || {};
    const branches = Array.isArray(c.repriceBranches) && c.repriceBranches.length
      ? normaliseBranches(c.repriceBranches)
      : flatToBranches(c);
    return { branches };
  }

  return { apply, applyRule, evaluate, treeFromFlat, treeFromBranches, normaliseBranches,
    actionTree, flatToBranches, examples, fromConfig };
});
