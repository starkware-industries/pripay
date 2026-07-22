const test = require('node:test');
const assert = require('node:assert');
const { toFields, fromFields } = require('../firestore-rest');

test('toFields/fromFields round-trips scalars and nested objects', () => {
  const obj = { name: 'Acme', nis: 1200, rate: 3.65, active: true, meta: { mode: 'shielded' }, tags: ['a', 'b'] };
  assert.deepStrictEqual(fromFields(toFields(obj)), obj);
});

test('fromFields on empty/undefined doc returns {}', () => {
  assert.deepStrictEqual(fromFields(undefined), {});
  assert.deepStrictEqual(fromFields({}), {});
});

test('toFields encodes integers and doubles distinctly', () => {
  const f = toFields({ count: 5, ratio: 2.5 });
  assert.deepStrictEqual(f.count, { integerValue: '5' });
  assert.deepStrictEqual(f.ratio, { doubleValue: 2.5 });
});

test('toFields/fromFields round-trips null', () => {
  assert.deepStrictEqual(fromFields(toFields({ x: null })), { x: null });
});
