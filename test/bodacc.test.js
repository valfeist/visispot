/**
 * Tests for the BODACC rolling window (commercial-dynamics.js).
 * Zero-dependency, offline (no network): run with `node test/bodacc.test.js`.
 *
 * Proves the fix for P0.2: the window is anchored to complete calendar months,
 * so two runs a few days apart in the same month share identical bounds — the
 * cumulative counts can no longer shrink between close runs (the old bug).
 */

const assert = require("node:assert");
const { bodaccWindow } = require("../commercial-dynamics");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// 1. The regression itself: the two run dates from the audit (12 vs 18 June),
//    6 days apart in the SAME month, must now yield identical window bounds.
test("two runs 6 days apart in the same month give identical bounds", () => {
  const a = bodaccWindow(new Date("2026-06-12T09:00:00Z"), 24);
  const b = bodaccWindow(new Date("2026-06-18T23:00:00Z"), 24);
  assert.deepStrictEqual(a, b);
});

// 2. Anchoring: end = 1st of current month (exclusive), start = 24 months back,
//    inclusive end = last day of previous month.
test("window is anchored to complete calendar months", () => {
  const w = bodaccWindow(new Date("2026-07-22T12:00:00Z"), 24);
  assert.strictEqual(w.windowEnd, "2026-07-01"); // exclusive upper bound
  assert.strictEqual(w.windowStart, "2024-07-01");
  assert.strictEqual(w.windowEndInclusive, "2026-06-30");
  assert.strictEqual(w.months, 24);
});

// 3. Crossing a month boundary shifts the window by exactly one month (and
//    only then) — predictable, documented drift, not silent daily drift.
test("a different month shifts the window by one month", () => {
  const june = bodaccWindow(new Date("2026-06-30T12:00:00Z"), 24);
  const july = bodaccWindow(new Date("2026-07-01T00:00:00Z"), 24);
  assert.notDeepStrictEqual(june, july);
  assert.strictEqual(june.windowEnd, "2026-06-01");
  assert.strictEqual(july.windowEnd, "2026-07-01");
});

// 4. Year rollover: January anchors start into the correct earlier year.
test("year rollover is handled at the start bound", () => {
  const w = bodaccWindow(new Date("2026-01-15T12:00:00Z"), 24);
  assert.strictEqual(w.windowEnd, "2026-01-01");
  assert.strictEqual(w.windowStart, "2024-01-01");
  assert.strictEqual(w.windowEndInclusive, "2025-12-31");
});

// 5. Determinism: same input => same output, independent of wall-clock.
test("bodaccWindow is a pure deterministic function", () => {
  const now = new Date("2026-03-09T08:30:00Z");
  assert.deepStrictEqual(bodaccWindow(now, 24), bodaccWindow(now, 24));
});

console.log(`\n${passed} tests passed.`);
