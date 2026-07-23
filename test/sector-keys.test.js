/**
 * Tests for the MVP sector-key consistency assertion (sector-keys.js).
 * Offline, zero-dependency.
 *
 * Proof of fix for P0.4: the real configs are consistent (boot passes), and
 * removing a key from any set makes the boot assertion fail.
 */

const assert = require("node:assert");
const { MVP_SECTORS, diffSectorKeys, assertSectorKeyConsistency } = require("../sector-keys");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const asSet = (keys) => Object.fromEntries(keys.map((k) => [k, 1]));

test("MVP perimeter is exactly 13 sectors, without services_personne", () => {
  assert.strictEqual(MVP_SECTORS.length, 13);
  assert.ok(!MVP_SECTORS.includes("services_personne"));
  for (const k of ["pressing", "laverie", "retouche"]) assert.ok(MVP_SECTORS.includes(k));
  // Taxonomy extension: the 7 sectors added on top of the original perimeter.
  for (const k of ["cafe", "boucherie", "fleuriste"]) {
    assert.ok(MVP_SECTORS.includes(k), `${k} missing from the MVP perimeter`);
  }
  // Deferred: no Google type and broad-type discovery returned zero live results.
  for (const k of ["primeur", "fromagerie", "poissonnerie", "cordonnerie"]) {
    assert.ok(!MVP_SECTORS.includes(k), `${k} must stay out of the perimeter`);
  }
  // No duplicate keys (the list is grouped by family, easy to fat-finger).
  assert.strictEqual(new Set(MVP_SECTORS).size, MVP_SECTORS.length);
});

test("real configs are consistent: assertSectorKeyConsistency does not throw", () => {
  assert.doesNotThrow(() => assertSectorKeyConsistency());
});

test("removing a key from a set is detected", () => {
  const broken = asSet(MVP_SECTORS.filter((k) => k !== "retouche"));
  const problems = diffSectorKeys(MVP_SECTORS, [["SECTOR_CONFIG", broken]]);
  assert.strictEqual(problems.length, 1);
  assert.deepStrictEqual(problems[0].missing, ["retouche"]);
});

test("an extra (stale) key is detected", () => {
  const broken = asSet([...MVP_SECTORS, "services_personne"]);
  const problems = diffSectorKeys(MVP_SECTORS, [["SECTOR_TYPE_MAPPING", broken]]);
  assert.strictEqual(problems.length, 1);
  assert.deepStrictEqual(problems[0].extra, ["services_personne"]);
});

test("a fully aligned set reports no problem", () => {
  const problems = diffSectorKeys(MVP_SECTORS, [["ok", asSet(MVP_SECTORS)]]);
  assert.deepStrictEqual(problems, []);
});

console.log(`\n${passed} tests passed.`);
