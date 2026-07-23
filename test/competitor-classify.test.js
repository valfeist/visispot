/**
 * Tests for competitor classification, dedup and the contamination guard-rail
 * (competitor-search.js + sector-type-mapping.js). Offline, zero-dependency.
 *
 * Proof of fix for P0.3: on a coiffure scan, nail bars / instituts / spas /
 * sourcils must NOT land in direct competitors, and a shop returned twice a
 * few meters apart must be counted once.
 */

const assert = require("node:assert");
const { classifyCompetitors, dedupeCompetitors, detectContamination, includedTypesForSector } =
  require("../competitor-search");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// A place near Bordeaux. lat offset of ~0.00005 deg ≈ 5.5 m (within dedup 25 m).
const P = (name, primaryType, i = 0, extra = {}) => ({
  name,
  placeId: extra.placeId ?? `id-${name}-${i}`,
  primaryType,
  types: extra.types ?? [primaryType],
  latitude: 44.84 + i * 0.00005,
  longitude: -0.58,
});

// The coiffure fixture that mirrors the real Judaïque contamination.
const coiffurePlaces = [
  P("Salon Coiffure A", "hair_salon", 0),
  P("Salon Coiffure A", "hair_salon", 1, { placeId: "other-id" }), // near-dup, different id
  P("Barber B", "barber_shop", 0),
  P("Vietnails", "nail_salon", 0, { types: ["nail_salon", "beauty_salon"] }),
  P("The Spa In The Black", "spa", 0),
  P("Oh My Cream", "cosmetics_store", 0),
  P("L'Atelier du Sourcil - Bordeaux", "beauty_salon", 0, { placeId: "sourcil-a" }),
  P("L'Atelier du Sourcil - Bordeaux", "beauty_salon", 1, { placeId: "sourcil-b" }), // dup 559/565 m case
];

test("coiffure keeps only hair salons as direct competitors", () => {
  const { direct } = classifyCompetitors(coiffurePlaces, "coiffure", []);
  const names = direct.map((d) => d.name).sort();
  assert.deepStrictEqual(names, ["Barber B", "Salon Coiffure A"]);
  // Explicitly: none of the contaminants leaked in.
  for (const bad of ["Vietnails", "The Spa In The Black", "Oh My Cream", "L'Atelier du Sourcil - Bordeaux"]) {
    assert.ok(!direct.some((d) => d.name === bad), `${bad} leaked into direct`);
  }
});

test("near-duplicate shop (same name, <25 m) is counted once", () => {
  const deduped = dedupeCompetitors(coiffurePlaces);
  assert.strictEqual(deduped.filter((c) => c.name === "Salon Coiffure A").length, 1);
  assert.strictEqual(deduped.filter((c) => c.name.startsWith("L'Atelier du Sourcil")).length, 1);
});

test("contamination guard-rail flags every off-whitelist primaryType", () => {
  const flagged = detectContamination(coiffurePlaces, "coiffure").map((c) => c.primaryType).sort();
  // nail_salon, spa, cosmetics_store, beauty_salon x2 (sourcils)
  assert.deepStrictEqual(flagged, ["beauty_salon", "beauty_salon", "cosmetics_store", "nail_salon", "spa"]);
});

test("coiffure includedTypes no longer request beauty_salon", () => {
  const types = includedTypesForSector("coiffure");
  assert.ok(types.includes("hair_salon"));
  assert.ok(!types.includes("beauty_salon"), "beauty_salon must not be sent to Google for coiffure");
});

test("boulangerie filters cafes, keeps bakeries", () => {
  const places = [P("Boulangerie du Coin", "bakery", 0), P("Miah Café", "cafe", 0)];
  const { direct, filteredOut } = classifyCompetitors(places, "boulangerie", []);
  assert.deepStrictEqual(direct.map((d) => d.name), ["Boulangerie du Coin"]);
  assert.ok(filteredOut.some((f) => f.name === "Miah Café"));
});

test("garment-care: pressing kept, laverie filtered by name heuristic on laundry", () => {
  const places = [
    P("Pressing Net Service", "laundry", 0),
    P("Laverie Lavomatic", "laundry", 2),
  ];
  const { direct } = classifyCompetitors(places, "pressing", []);
  assert.deepStrictEqual(direct.map((d) => d.name), ["Pressing Net Service"]);
});

// --- Taxonomy extension (17 sectors) -----------------------------------------

test("snacking keeps fast_food_restaurant (MATCH:*_restaurant no longer evicts it)", () => {
  const places = [
    P("Snack du Coin", "fast_food_restaurant", 0),
    P("Chez Hot Dog", "hot_dog_restaurant", 2),
    P("Le Bistrot Assis", "italian_restaurant", 4),
  ];
  const { direct } = classifyCompetitors(places, "snacking", []);
  const names = direct.map((d) => d.name).sort();
  // The two snacking types are kept; the sit-down restaurant is still rejected.
  assert.deepStrictEqual(names, ["Chez Hot Dog", "Snack du Coin"]);
});

test("epicerie_fine no longer counts a butcher as a direct competitor", () => {
  const places = [
    P("Épicerie Fine du Marché", "grocery_store", 0),
    P("Boucherie Martin", "butcher_shop", 2),
  ];
  const { direct } = classifyCompetitors(places, "epicerie_fine", []);
  assert.deepStrictEqual(direct.map((d) => d.name), ["Épicerie Fine du Marché"]);
});

test("epicerie_fine name_denylist rejects a loosely typed specialised trade", () => {
  // Google types some specialised shops as grocery_store; the name must win.
  const places = [P("Fromagerie Dubois", "grocery_store", 0)];
  const { direct } = classifyCompetitors(places, "epicerie_fine", []);
  assert.strictEqual(direct.length, 0, "a fromagerie must not count as épicerie fine");
});



test("epicerie_fine declares text_queries (Nearby alone returns zero live)", () => {
  const { SECTOR_TYPE_MAPPING } = require("../sector-type-mapping");
  const q = SECTOR_TYPE_MAPPING.epicerie_fine.text_queries;
  assert.ok(Array.isArray(q) && q.length > 0, "epicerie_fine needs keyword queries");
  // The types those searches return must already be whitelisted, otherwise the
  // extra calls would be filtered out again.
  for (const t of ["grocery_store", "deli", "food_store"]) {
    assert.ok(SECTOR_TYPE_MAPPING.epicerie_fine.google_include.includes(t), `${t} must stay whitelisted`);
  }
});

test("every name-classified sector declares text_queries", () => {
  const { SECTOR_TYPE_MAPPING } = require("../sector-type-mapping");
  for (const [key, cfg] of Object.entries(SECTOR_TYPE_MAPPING)) {
    if (cfg.classify_by !== "name") continue;
    assert.ok(cfg.google_include.length === 0, `${key}: google_include must stay empty`);
    assert.ok(cfg.text_queries?.length > 0, `${key}: no text_queries -> zero discovery`);
    assert.ok(cfg.name_include?.length > 0, `${key}: name gate is the only filter`);
  }
});

console.log(`\n${passed} tests passed.`);
