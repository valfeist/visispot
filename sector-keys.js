/**
 * Single source of truth for the MVP sector perimeter, and a startup assertion
 * that every sector-keyed config shares exactly these keys.
 *
 * Why: a sector that is selectable but missing from the type mapping would run
 * an UNFILTERED competitor scan (contamination comes back), and one missing
 * from the benchmarks crashes the P5 task. The boot assertion fails loudly
 * instead of shipping a silently degraded report.
 *
 * MVP perimeter (10): services_personne retired; pressing split into pressing +
 * laverie; retouche (tailor) added.
 */

const MVP_SECTORS = [
  "boulangerie",
  "restauration",
  "snacking",
  "coiffure",
  "beaute",
  "epicerie_fine",
  "caviste",
  "pressing",
  "laverie",
  "retouche",
];

// Pure: compares each named set's keys to `expected`, returns the divergences.
function diffSectorKeys(expected, namedSets) {
  const expectedSet = new Set(expected);
  const problems = [];
  for (const [name, obj] of namedSets) {
    const keys = Object.keys(obj);
    const missing = expected.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !expectedSet.has(k));
    if (missing.length || extra.length) problems.push({ set: name, missing, extra });
  }
  return problems;
}

// Throws (loudly) if any strict config diverges from the MVP perimeter.
function assertSectorKeyConsistency() {
  const { SECTOR_CONFIG } = require("./sector_config");
  const { SECTOR_TYPE_MAPPING } = require("./sector-type-mapping");
  const { SECTOR_BENCHMARKS } = require("./sector-benchmarks");
  const { EXCLUSION_LISTS } = require("./exclusion-lists");

  const problems = diffSectorKeys(MVP_SECTORS, [
    ["dropdown étape 1 (MVP_SECTORS)", Object.fromEntries(MVP_SECTORS.map((k) => [k, 1]))],
    ["SECTOR_CONFIG", SECTOR_CONFIG],
    ["SECTOR_TYPE_MAPPING", SECTOR_TYPE_MAPPING],
    ["SECTOR_BENCHMARKS", SECTOR_BENCHMARKS],
    ["EXCLUSION_LISTS", EXCLUSION_LISTS],
  ]);

  if (problems.length) {
    const lines = problems.map(
      (p) => `  - ${p.set}: manquants [${p.missing.join(", ") || "—"}], en trop [${p.extra.join(", ") || "—"}]`
    );
    throw new Error(
      `Incohérence des clés secteur (périmètre MVP = ${MVP_SECTORS.length} secteurs) :\n${lines.join("\n")}\n` +
        `Aligne les configs sur : ${MVP_SECTORS.join(", ")}`
    );
  }
}

module.exports = { MVP_SECTORS, diffSectorKeys, assertSectorKeyConsistency };
