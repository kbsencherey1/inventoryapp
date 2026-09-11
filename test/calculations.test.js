const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateStatus, normalizeCount, summarizeLines } = require('../src/calculations');

test('calculates receiving statuses, including an uncounted line', () => {
  assert.equal(calculateStatus(10, 10), 'COMPLETE');
  assert.equal(calculateStatus(10, 8), 'SHORT');
  assert.equal(calculateStatus(10, 12), 'EXCESS');
  assert.equal(calculateStatus(10, null), 'NOT COUNTED');
  assert.equal(normalizeCount('4'), 4);
  assert.equal(normalizeCount(''), null);
  assert.equal(normalizeCount('-1'), null);
});

test('summarizes line outcomes and quantities', () => {
  const summary = summarizeLines([
    { expectedQty: 4, countedQty: 4 },
    { expectedQty: 5, countedQty: 3 },
    { expectedQty: 2, countedQty: 4 },
    { expectedQty: 1, countedQty: null }
  ]);
  assert.deepEqual(summary, { COMPLETE: 1, SHORT: 1, EXCESS: 1, 'NOT COUNTED': 1, expected: 11, counted: 11 });
});
