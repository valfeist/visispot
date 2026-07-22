/**
 * Tests for the deterministic P1 scorer (scoring.js).
 * Zero-dependency: run with `node test/score.test.js` (exit 0 = all pass).
 *
 * Covers the proof-of-fix the audit asked for: a "viable location" fixture
 * that must score clearly above 6 — impossible to assert while the score was
 * an LLM number.
 */

const assert = require("node:assert");
const { computeScore, VERDICT_CUTOFF } = require("../scoring");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// Shared base: an unremarkable, covered location. Each test overrides parts.
const base = {
  businessType: "coiffure",
  zone: { covered: true },
  competition: { directPrimary: 2, chainPrimary: 0, densityGlobal1km: 600 },
  demographics: { medianIncome: 24000, ownerShare: 0.5, population: 12000 },
  risks: { vacancyPct300: 4, fastFood300: 0, worksUnknown: true, rentUnknown: true },
};
const withCompetition = (n) => ({ ...base, competition: { ...base.competition, directPrimary: n } });

// 1. The viable fixture the audit requires: score must clearly exceed 6.
test("viable location scores well above 6 and is VIABLE", () => {
  const r = computeScore({
    businessType: "coiffure",
    zone: { covered: true },
    competition: { directPrimary: 1, chainPrimary: 0, densityGlobal1km: 700 },
    demographics: { medianIncome: 27000, ownerShare: 0.55, population: 14000 },
    risks: { vacancyPct300: 3, fastFood300: 0, worksUnknown: true, rentUnknown: true },
  });
  assert.ok(r.score > 6, `expected score > 6, got ${r.score}`);
  assert.strictEqual(r.verdict, "VIABLE");
});

// 2. Dense competition + weak footfall => NON VIABLE via hard veto.
test("dense competition + weak flux triggers the veto and NON VIABLE", () => {
  const r = computeScore({
    businessType: "coiffure",
    zone: { covered: true },
    competition: { directPrimary: 17, chainPrimary: 0, densityGlobal1km: 40 },
    demographics: { medianIncome: 22000, ownerShare: 0.58, population: 20000 },
    risks: { vacancyPct300: 4, fastFood300: 0, worksUnknown: true, rentUnknown: true },
  });
  assert.strictEqual(r.verdict, "NON VIABLE");
  assert.ok(r.breakdown.vetoes.includes("concurrence_dense_et_flux_faible"));
});

// 3. Real Bordeaux bakery numbers: discriminant (not the old flat 4,5),
//    negative, and the breakdown is present + well-formed.
test("Bordeaux bakery is discriminant, negative, and exposes a breakdown", () => {
  const r = computeScore({
    businessType: "boulangerie",
    zone: { covered: true },
    competition: { directPrimary: 12, chainPrimary: 5, densityGlobal1km: 1643 },
    demographics: { medianIncome: 28448, ownerShare: 0.327, population: 42836 },
    risks: { vacancyPct300: 6, fastFood300: 3, worksUnknown: true, rentUnknown: true },
  });
  assert.strictEqual(r.verdict, "NON VIABLE");
  assert.ok(r.score < VERDICT_CUTOFF, `expected < ${VERDICT_CUTOFF}, got ${r.score}`);
  assert.strictEqual(r.breakdown.pillars.concurrence.category, "Dense");
  // breakdown is inspectable: 4 pillars, each with a weighted contribution.
  assert.deepStrictEqual(
    Object.keys(r.breakdown.pillars).sort(),
    ["concurrence", "demographie", "flux", "risques"]
  );
  for (const p of Object.values(r.breakdown.pillars)) {
    assert.strictEqual(typeof p.weighted, "number");
  }
});

// 4. Determinism: same input twice => identical score (no randomness/LLM).
test("scoring is deterministic (same input => same score)", () => {
  const a = computeScore(withCompetition(3));
  const b = computeScore(withCompetition(3));
  assert.strictEqual(a.score, b.score);
  assert.deepStrictEqual(a.keyMetrics, b.keyMetrics);
});

// 5. Monotonicity: adding a direct competitor never RAISES the competition
//    sub-score (the pillar must be non-increasing in competitor count).
test("competition sub-score is monotonic non-increasing in competitors", () => {
  let prev = Infinity;
  for (let n = 0; n <= 20; n++) {
    const raw = computeScore(withCompetition(n)).breakdown.pillars.concurrence.raw;
    assert.ok(raw <= prev + 1e-9, `raw rose at n=${n}: ${raw} > ${prev}`);
    prev = raw;
  }
});

// 6. Uncovered zone forces NON VIABLE regardless of an otherwise good score.
test("uncovered zone vetoes to NON VIABLE", () => {
  const r = computeScore({ ...base, zone: { covered: false }, competition: { directPrimary: 0, chainPrimary: 0, densityGlobal1km: 1500 } });
  assert.strictEqual(r.verdict, "NON VIABLE");
  assert.ok(r.breakdown.vetoes.includes("zone_non_couverte"));
});

console.log(`\n${passed} tests passed.`);
