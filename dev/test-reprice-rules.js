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
eq(R.apply(5, { combine: 'single', rules: [pct(10)] }), 5, '5 -10% rounds back to 5');
eq(R.apply(3, { combine: 'single', rules: [flat(10)] }), 1, 'never below 1');
eq(R.apply(1, { combine: 'single', rules: [pct(50)] }), 1, '1 -50% floors at 1');
eq(R.apply(101, { combine: 'single', rules: [pct(10)] }), 91, '90.9 rounds to 91');

console.log('bigger/smaller compare the CHANGE, not the price');
const pair = { rules: [pct(10), flat(2)] };
eq(R.apply(100, { combine: 'bigger', ...pair }), 90, '100: -10% (10) beats -2');
eq(R.apply(5, { combine: 'bigger', ...pair }), 3, '5: -2 beats -10% (0.5)');
eq(R.apply(100, { combine: 'smaller', ...pair }), 98, '100: smaller takes -2');
eq(R.apply(5, { combine: 'smaller', ...pair }), 5, '5: smaller takes -10%');

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

console.log('worked examples shown in settings');
const ex = R.examples({ combine: 'bigger', rules: [pct(10), flat(2)] });
eq(ex.length, 2, 'two examples');
eq(ex[0].base, 100, 'first example is 100');
eq(ex[1].result, 3, 'second example shows the pairing mattering');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
