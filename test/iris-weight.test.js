/**
 * Tests for the surfacic IRIS weighting (iris-geometry.js) and its use in the
 * demographic aggregation (demographics.js). Offline, zero-dependency,
 * deterministic (synthetic square/L-shaped polygons — no network).
 *
 * Proof of fix for P1: an IRIS half inside the isochrone contributes half its
 * population, instead of being counted whole (small-commune over-count).
 */

const assert = require("node:assert");
const { irisAreaWeight } = require("../iris-geometry");
const { aggregateDemographics } = require("../demographics");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// GeoJSON square from (x0,y0) to (x1,y1). Coordinates are [lng, lat].
const square = (x0, y0, x1, y1) => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});
const iris = square(0, 0, 1, 1);
const near = (a, b, tol = 0.03) => Math.abs(a - b) <= tol;

test("IRIS fully inside the isochrone -> weight ~1", () => {
  const w = irisAreaWeight(iris, square(-1, -1, 2, 2));
  assert.ok(near(w, 1), `expected ~1, got ${w}`);
});

test("IRIS half inside -> weight ~0.5", () => {
  const w = irisAreaWeight(iris, square(0, 0, 0.5, 1));
  assert.ok(near(w, 0.5), `expected ~0.5, got ${w}`);
});

test("IRIS a quarter inside -> weight ~0.25", () => {
  const w = irisAreaWeight(iris, square(0, 0, 0.5, 0.5));
  assert.ok(near(w, 0.25), `expected ~0.25, got ${w}`);
});

test("IRIS disjoint from the isochrone -> weight 0", () => {
  const w = irisAreaWeight(iris, square(5, 5, 6, 6));
  assert.strictEqual(w, 0);
});

test("non-convex (L-shaped) isochrone is handled", () => {
  // L-shape covering 3 of the 4 quadrants of the unit square => ~0.75.
  const L = {
    type: "Polygon",
    coordinates: [[[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1], [0, 0]]],
  };
  const w = irisAreaWeight(iris, L);
  assert.ok(near(w, 0.75), `expected ~0.75, got ${w}`);
});

test("no geometry -> weight 1 (whole-count fallback)", () => {
  assert.strictEqual(irisAreaWeight(null, iris), 1);
});

test("weight is deterministic", () => {
  const iso = square(0, 0, 0.5, 1);
  assert.strictEqual(irisAreaWeight(iris, iso), irisAreaWeight(iris, iso));
});

// --- Aggregation applies the weight -------------------------------------
const data = {
  population: new Map([["A", { total: 1000, age0_17: 200, age18_39: 300, age40_64: 300, age65p: 200 }]]),
  housing: new Map([["A", { principalResidences: 400, owners: 200 }]]),
  income: new Map([["A", { medianEuros: 24000 }]]),
};

test("bare code counts the IRIS whole (backward compatible)", () => {
  const agg = aggregateDemographics(["A"], data);
  assert.strictEqual(agg.population.total, 1000);
  assert.strictEqual(agg.housing.principalResidences, 400);
});

test("weight 0.5 halves population and households, keeps ratios and median", () => {
  const agg = aggregateDemographics([{ code: "A", weight: 0.5 }], data);
  assert.strictEqual(agg.population.total, 500);
  assert.strictEqual(agg.housing.principalResidences, 200);
  assert.strictEqual(agg.housing.ownerShare, 0.5); // 100 / 200, unchanged
  assert.strictEqual(agg.income.medianEuros, 24000); // single IRIS mean, unchanged
  assert.strictEqual(agg.ageBreakdown["0-17"].share, 0.2); // ratio unchanged
});

console.log(`\n${passed} tests passed.`);
