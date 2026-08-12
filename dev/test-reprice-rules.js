// Tests for the reprice arithmetic. This decides the number that ends up on the
// clipboard and gets pasted into a trade, so it is worth pinning down.
//
//   node dev/test-reprice-rules.js
const R = require('../renderer/reprice-rules.js');

let pass = 0, fail = 0;
function eq(got, want, what) {
  const ok = got === want;
  if (ok) pass++; else { fail++; console.log(`  FAIL ${what}: got ${got}, want ${want}`); }
}

const pct = (v) => ({ op: 'subtract', value: v, mode: 'percent' });
const flat = (v) => ({ op: 'subtract', value: v, mode: 'flat' });
const flatUp = (v) => ({ op: 'add', value: v, mode: 'flat' });

console.log('single rule');
eq(R.apply(100, { combine: 'single', rules: [pct(10)] }), 90, '100 -10%');
eq(R.apply(100, { combine: 'single', rules: [flat(2)] }), 98, '100 -2');
eq(R.apply(100, { combine: 'single', rules: [flatUp(5)] }), 105, '100 +5');

console.log('rounding and floor');
// These three used to expect round-to-nearest. Percent rules round DOWN unless told
// otherwise now, so 4.5 is 4 and 90.9 is 90 - a default that rounds a price UP quietly
// asks more than the user set.
eq(R.apply(5, { combine: 'single', rules: [pct(10)] }), 4, '5 -10% is 4.5, down to 4');
eq(R.apply(3, { combine: 'single', rules: [flat(10)] }), 1, 'never below 1');
eq(R.apply(1, { combine: 'single', rules: [pct(50)] }), 1, '1 -50% floors at 1');
eq(R.apply(101, { combine: 'single', rules: [pct(10)] }), 90, '90.9 goes down to 90');

console.log('bigger/smaller compare the CHANGE, not the price');
const pair = { rules: [pct(10), flat(2)] };
eq(R.apply(100, { combine: 'bigger', ...pair }), 90, '100: -10% (10) beats -2');
eq(R.apply(5, { combine: 'bigger', ...pair }), 3, '5: -2 beats -10% (0.5)');
eq(R.apply(100, { combine: 'smaller', ...pair }), 98, '100: smaller takes -2');
eq(R.apply(5, { combine: 'smaller', ...pair }), 4, '5: smaller takes -10% (4.5 down to 4)');

console.log('threshold branches on the price');
const th = { combine: 'threshold', threshold: 20, rules: [pct(10), flat(2)] };
eq(R.apply(100, th), 90, '100 >= 20 -> rule A');
eq(R.apply(20, th), 18, '20 >= 20 -> rule A (inclusive)');
eq(R.apply(19, th), 17, '19 < 20 -> rule B');

console.log('guards');
eq(R.apply(0, { combine: 'single', rules: [pct(10)] }), null, 'zero');
eq(R.apply(-4, { combine: 'single', rules: [pct(10)] }), null, 'negative');
eq(R.apply('abc', { combine: 'single', rules: [pct(10)] }), null, 'not a number');
eq(R.apply(100, { combine: 'single', rules: [] }), null, 'no rules');
eq(R.apply(100, { combine: 'single', rules: [{ op: 'subtract', value: NaN, mode: 'flat' }] }), 100, 'NaN value is a no-op');

console.log('nested trees');
const tree = { tree: { if: 'currency', is: 'divine',
  a: { pick: 'smaller', a: pct(10), b: flat(1) },
  b: { pick: 'bigger', a: pct(10), b: flat(2) } } };
eq(R.apply(100, tree, { currency: 'divine' }), 99, 'divine -> smaller change');
eq(R.apply(100, tree, { currency: 'chaos' }), 90, 'chaos -> bigger change');
eq(R.apply(100, tree, {}), 90, 'unknown currency takes the else branch');
eq(R.apply(100, tree, { currency: 'DIVINE' }), 99, 'currency match is case-insensitive');

console.log('currency branch built from the settings controls');
const curCfg = { combine: 'currency', currency: 'divine', rules: [pct(10), flat(1)] };
eq(R.apply(100, curCfg, { currency: 'divine' }), 90, 'the chosen currency takes the first rule');
eq(R.apply(100, curCfg, { currency: 'chaos' }), 99, 'another currency takes the second');
// The icon reader returns null when it cannot identify the art. That has to land on the
// else branch, not on the branch the user picked - otherwise a failed read silently
// reprices as though it had recognised the currency.
eq(R.apply(100, curCfg, {}), 99, 'no currency read takes the else branch');
eq(R.apply(100, curCfg, { currency: null }), 99, 'an unidentified icon takes the else branch');
eq(R.apply(100, R.fromConfig({ repriceCombine: 'currency', repriceCurrency: 'chaos',
  repriceOp: 'subtract', repriceValue: 20, repriceMode: 'percent',
  repriceOp2: 'subtract', repriceValue2: 5, repriceMode2: 'percent' }),
  { currency: 'chaos' }), 80, 'fromConfig carries the currency through');

console.log('branch lists');
const br = (when, action) => ({ when, action });
const act = (combine, ...rules) => ({ combine, rules });
// the case that motivated branch lists: a different pairing per currency
const perCurrency = { branches: [
  br({ type: 'currency', is: 'divine' }, act('smaller', pct(10), flat(10))),
  br({ type: 'currency', is: 'chaos' }, act('smaller', pct(20), flat(1))),
  br({ type: 'always' }, act('single', pct(5))),
] };
eq(R.apply(500, perCurrency, { currency: 'divine' }), 490, 'divine: flat 10 is the smaller change');
eq(R.apply(50, perCurrency, { currency: 'divine' }), 45, 'divine: 10% is the smaller change');
eq(R.apply(500, perCurrency, { currency: 'chaos' }), 499, 'chaos uses its own pairing');
eq(R.apply(500, perCurrency, { currency: 'vaal' }), 475, 'an unlisted currency falls to the otherwise');
eq(R.apply(500, perCurrency, {}), 475, 'an unread currency falls to the otherwise');
// order matters: the first matching branch wins
const ordered = { branches: [
  br({ type: 'price>=', at: 100 }, act('single', flat(50))),
  br({ type: 'price>=', at: 10 }, act('single', flat(5))),
  br({ type: 'always' }, act('single', flat(1))),
] };
eq(R.apply(500, ordered), 450, 'first band');
eq(R.apply(50, ordered), 45, 'second band');
eq(R.apply(5, ordered), 4, 'otherwise');
// a list that ends on a condition would leave the price untouched; it gets a floor
const noElse = R.normaliseBranches([br({ type: 'currency', is: 'divine' }, act('single', pct(10)))]);
eq(noElse.length, 2, 'a missing otherwise is added');
eq(noElse[1].when.type, 'always', 'and it is the catch-all');
eq(R.apply(100, { branches: noElse }, { currency: 'chaos' }), 100, 'unmatched leaves the price alone');

console.log('old flat settings still work after the upgrade');
eq(R.apply(100, R.fromConfig({ repriceCombine: 'smaller', repriceOp: 'subtract',
  repriceValue: 10, repriceMode: 'percent', repriceOp2: 'subtract', repriceValue2: 2, repriceMode2: 'flat' })),
  98, 'a flat pairing migrates to one branch');
eq(R.apply(100, R.fromConfig({ repriceCombine: 'threshold', repriceThreshold: 50,
  repriceOp: 'subtract', repriceValue: 10, repriceMode: 'percent',
  repriceOp2: 'subtract', repriceValue2: 1, repriceMode2: 'flat' })), 90, 'threshold migrates: above');
eq(R.apply(10, R.fromConfig({ repriceCombine: 'threshold', repriceThreshold: 50,
  repriceOp: 'subtract', repriceValue: 10, repriceMode: 'percent',
  repriceOp2: 'subtract', repriceValue2: 1, repriceMode2: 'flat' })), 9, 'threshold migrates: below');
eq(R.apply(100, R.fromConfig({ repriceCombine: 'currency', repriceCurrency: 'chaos',
  repriceOp: 'subtract', repriceValue: 20, repriceMode: 'percent',
  repriceOp2: 'subtract', repriceValue2: 5, repriceMode2: 'percent' }), { currency: 'chaos' }),
  80, 'currency migrates');

console.log('rounding on percent lines');
const pctR = (v, r) => ({ op: 'subtract', value: v, mode: 'percent', round: r });
// 10% off 245 is 220.5 - the case that has to differ three ways
eq(R.apply(245, { combine: 'single', rules: [pctR(10, 'down')] }), 220, 'down');
eq(R.apply(245, { combine: 'single', rules: [pctR(10, 'nearest')] }), 221, 'nearest');
eq(R.apply(245, { combine: 'single', rules: [pctR(10, 'up')] }), 221, 'up');
// 10% off 255 is 229.5, where nearest and up agree the other way
eq(R.apply(255, { combine: 'single', rules: [pctR(10, 'down')] }), 229, 'down on .5');
eq(R.apply(255, { combine: 'single', rules: [pctR(10, 'nearest')] }), 230, 'nearest on .5');
// a rule with no rounding stated rounds DOWN - asking more than intended costs the user
eq(R.apply(245, { combine: 'single', rules: [{ op: 'subtract', value: 10, mode: 'percent' }] }),
  220, 'unstated means down');
// adding: rounding still applies to the resulting price, not to the size of the change
eq(R.apply(245, { combine: 'single', rules: [{ op: 'add', value: 10, mode: 'percent', round: 'down' }] }),
  269, 'add rounds the price down too');
// each rule rounds before they are compared, so the pick sees the real numbers
eq(R.apply(245, { combine: 'smaller', rules: [pctR(10, 'down'), { op: 'subtract', value: 30, mode: 'flat' }] }),
  220, 'smaller change wins after rounding');

console.log('worked examples shown in settings');
const ex = R.examples({ combine: 'bigger', rules: [pct(10), flat(2)] });
eq(ex.length, 2, 'two examples');
eq(ex[0].base, 100, 'first example is 100');
eq(ex[1].result, 3, 'second example shows the pairing mattering');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
