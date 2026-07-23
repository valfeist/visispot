/**
 * PIPELINE STEP 10a — Deterministic location score (P1).
 * ------------------------------------------------------
 * Pure function: no I/O, no API call, no randomness. Replaces the former
 * LLM-emitted score (which was non-deterministic, non-inspectable, and
 * clustered around 4,5/10 regardless of context).
 *
 * `computeScore(input)` returns:
 *   - score      : note /10 (one decimal)
 *   - verdict    : "VIABLE" | "NON VIABLE"
 *   - keyMetrics : the 4 report categories, derived from explicit thresholds
 *   - breakdown  : inspectable sub-scores, weights, contributions, vetoes
 *
 * The LLM only WRITES the P1 prose (executive summary, justification) from
 * this breakdown; it can no longer change the number.
 *
 * Run with:  node scoring.js   (prints the score for a few fixtures)
 */

// =====================================================================
// Calibration (the inspectable knobs). Validated weights/cutoff.
// =====================================================================

const WEIGHTS = { concurrence: 0.35, demographie: 0.30, flux: 0.20, risques: 0.15 };
const VERDICT_CUTOFF = 5.5; // score >= cutoff AND no veto => VIABLE

// Direct-competitor count (primary radius) at which competition becomes
// "Dense" for the sector. Chains count for half a direct competitor.
// NOTE: to be re-checked after P0.3 (contamination inflates these counts).
const DEFAULT_DENSE_MIN = 5;
const COMPETITION_DENSE_MIN = {
  boulangerie: 5,
  restauration: 8,
  snacking: 8,
  coiffure: 6,
  beaute: 6,
  epicerie_fine: 5,
  caviste: 4,
  pressing: 4,
  laverie: 4,
  retouche: 4,
  // Taxonomy extension. Specialised trades saturate faster than a generalist
  // shop: fewer same-trade competitors are needed to call a zone dense.
  cafe: 8,
  boucherie: 4,
  poissonnerie: 3,
  primeur: 4,
  fromagerie: 3,
  cordonnerie: 3,
  fleuriste: 4,
};

// How much the local purchasing power (median income) weighs in the
// demographic pillar, per sector. A product-weighting choice, not external
// data. high => income-driven sectors (CSP+); low => convenience sectors.
const INCOME_SENSITIVITY = {
  caviste: "high",
  epicerie_fine: "high",
  beaute: "high",
  coiffure: "medium",
  restauration: "medium",
  boulangerie: "medium",
  pressing: "medium",
  retouche: "medium",
  snacking: "low",
  laverie: "low",
  // Taxonomy extension.
  fleuriste: "medium",
  boucherie: "medium",
  primeur: "medium",
  fromagerie: "high",
  poissonnerie: "high",
  cordonnerie: "low",
  cafe: "medium",
};
const DEMO_WEIGHTS = {
  high: { income: 0.55, stability: 0.20, population: 0.25 },
  medium: { income: 0.40, stability: 0.30, population: 0.30 },
  low: { income: 0.25, stability: 0.35, population: 0.40 },
};

// FR reference for "niveau de vie médian" (annual €). Around the national
// median; income sub-score is centered here.
const INCOME_REFERENCE = 22000;

// =====================================================================
// Helpers
// =====================================================================

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round1 = (x) => Math.round(x * 10) / 10;

// =====================================================================
// Pillar 1 — Competition (35%)
// =====================================================================
// Based on direct independent competitors in the primary radius; chains
// weigh half. Score decreases monotonically as competitors increase, with
// a floor at 1 (dense competition must hurt, but never zero out the rest).

function scoreConcurrence(input, sector) {
  const directPrimary = input.competition.directPrimary ?? 0;
  const chainPrimary = input.competition.chainPrimary ?? 0;
  const denseMin = COMPETITION_DENSE_MIN[sector] ?? DEFAULT_DENSE_MIN;
  const effective = directPrimary + 0.5 * chainPrimary;

  let category;
  let raw;
  if (effective === 0) {
    category = "Absente";
    raw = 10;
  } else if (effective < denseMin) {
    category = "Modérée";
    // 8 at 1 competitor, down to ~5 at the top of the moderate band.
    raw = 8 - ((effective - 1) / Math.max(1, denseMin - 1)) * 3;
  } else {
    category = "Dense";
    // 4 at the dense threshold, down to a floor of 1 at twice the threshold.
    raw = clamp(4 - ((effective - denseMin) / denseMin) * 3, 1, 4);
  }

  return {
    weight: WEIGHTS.concurrence,
    raw: round1(raw),
    category,
    inputs: { directPrimary, chainPrimary, effective, denseMin },
  };
}

// =====================================================================
// Pillar 2 — Demographics (30%)
// =====================================================================
// Blends local purchasing power, residential stability (owner share) and
// catchment population. Sector sets how much income weighs.

function scoreIncome(medianIncome) {
  if (medianIncome == null) return 5; // neutral when unknown
  // 5 at the national reference, +1 point per ~1500 € above (and symmetric).
  return round1(clamp(5 + (medianIncome - INCOME_REFERENCE) / 1500, 0, 10));
}

function scoreStability(ownerShare) {
  if (ownerShare == null) return 5;
  return round1(clamp(ownerShare * 14, 0, 10)); // ~0.36 => 5, ~0.71 => 10
}

function scorePopulation(pop) {
  if (pop == null) return 5;
  if (pop >= 15000) return 9;
  if (pop >= 8000) return 7;
  if (pop >= 4000) return 6;
  if (pop >= 2000) return 4;
  return 2;
}

function scoreDemographie(input, sector) {
  const d = input.demographics ?? {};
  const sensitivity = INCOME_SENSITIVITY[sector] ?? "medium";
  const w = DEMO_WEIGHTS[sensitivity];

  const income = scoreIncome(d.medianIncome);
  const stability = scoreStability(d.ownerShare);
  const population = scorePopulation(d.population);
  const raw = w.income * income + w.stability * stability + w.population * population;

  let category;
  if (raw >= 7) category = "Aligné";
  else if (raw >= 4) category = "Neutre";
  else category = "Inadapté";

  return {
    weight: WEIGHTS.demographie,
    raw: round1(raw),
    category,
    inputs: {
      sensitivity,
      medianIncome: d.medianIncome ?? null,
      ownerShare: d.ownerShare ?? null,
      population: d.population ?? null,
      components: { income, stability, population },
    },
  };
}

// =====================================================================
// Pillar 3 — Foot traffic (20%)
// =====================================================================
// BestTime is insufficient locally, so we proxy from the 1 km commercial
// density (same thresholds as the P3 density reading). Flagged as a proxy.

function scoreFlux(input) {
  const density = input.competition.densityGlobal1km ?? 0;

  let category;
  let raw;
  if (density > 1000) {
    category = "Élevé";
    raw = clamp(7 + (density - 1000) / 2000, 7, 9);
  } else if (density >= 300) {
    category = "Moyen";
    raw = 5 + ((density - 300) / 700) * 2;
  } else {
    category = "Faible";
    raw = 2 + (density / 300) * 2;
  }

  return {
    weight: WEIGHTS.flux,
    raw: round1(raw),
    category,
    inputs: { densityGlobal1km: density, source: "proxy densité 1 km (BestTime insuffisant)" },
  };
}

// =====================================================================
// Pillar 4 — Risk signals (15%)
// =====================================================================
// Starts at 10, subtracts for genuine risk signals. Missing works/rent
// data are treated as DATA GAPS, not risks (not penalized) — otherwise
// every location would read "Plusieurs" (the old failure mode).

function scoreRisques(input, sector) {
  const r = input.risks ?? {};
  const vacancy = r.vacancyPct300 ?? 0;
  const fastFood = r.fastFood300 ?? 0;

  let raw = 10;
  const signals = [];

  if (vacancy > 15) {
    raw -= 4;
    signals.push("vacance élevée (>15%)");
  } else if (vacancy >= 5) {
    raw -= 1.5;
  }

  // Fast-food saturation only competes for the meal-oriented sectors.
  const mealSectors = ["restauration", "snacking", "boulangerie"];
  if (mealSectors.includes(sector) && fastFood >= 8) {
    raw -= 2;
    signals.push("forte densité de restauration rapide");
  }

  raw = clamp(raw, 0, 10);

  let category;
  if (signals.length === 0) category = "Aucun";
  else if (signals.length === 1) category = "1 signal";
  else category = "Plusieurs";

  return {
    weight: WEIGHTS.risques,
    raw: round1(raw),
    category,
    inputs: {
      vacancyPct300: vacancy,
      fastFood300: fastFood,
      signals,
      dataGaps: [r.worksUnknown ? "travaux de voirie non vérifiés" : null, r.rentUnknown ? "loyer de marché non comparé" : null].filter(Boolean),
    },
  };
}

// =====================================================================
// Verdict — derived from the score + hard vetoes
// =====================================================================

function computeVetoes(pillars, input) {
  const vetoes = [];
  if (input.zone && input.zone.covered === false) vetoes.push("zone_non_couverte");
  if (pillars.concurrence.category === "Dense" && pillars.flux.category === "Faible") {
    vetoes.push("concurrence_dense_et_flux_faible");
  }
  if (pillars.demographie.category === "Inadapté") vetoes.push("demographie_inadaptee");
  return vetoes;
}

// =====================================================================
// Orchestrator
// =====================================================================

function computeScore(input) {
  const sector = input.businessType;

  const pillars = {
    concurrence: scoreConcurrence(input, sector),
    demographie: scoreDemographie(input, sector),
    flux: scoreFlux(input),
    risques: scoreRisques(input, sector),
  };

  let score = 0;
  for (const key of Object.keys(pillars)) {
    const p = pillars[key];
    p.weighted = round1(p.weight * p.raw);
    score += p.weight * p.raw;
  }
  score = round1(score);

  const vetoes = computeVetoes(pillars, input);
  const verdict = score >= VERDICT_CUTOFF && vetoes.length === 0 ? "VIABLE" : "NON VIABLE";

  const keyMetrics = {
    flux: pillars.flux.category,
    demographicProfile: pillars.demographie.category,
    directCompetition: pillars.concurrence.category,
    risks: pillars.risques.category,
  };

  return {
    score,
    verdict,
    cutoff: VERDICT_CUTOFF,
    keyMetrics,
    breakdown: { score, verdict, cutoff: VERDICT_CUTOFF, weights: WEIGHTS, pillars, vetoes },
  };
}

// =====================================================================
// Direct run: print a few fixtures
// =====================================================================

if (require.main === module) {
  const fixtures = {
    "coiffure viable (peu de concurrence, zone aisée)": {
      businessType: "coiffure",
      zone: { covered: true },
      competition: { directPrimary: 1, chainPrimary: 0, densityGlobal1km: 600 },
      demographics: { medianIncome: 26000, ownerShare: 0.55, population: 12000 },
      risks: { vacancyPct300: 3, fastFood300: 0, worksUnknown: true, rentUnknown: true },
    },
    "boulangerie Bordeaux (hyper-concurrence, flux élevé)": {
      businessType: "boulangerie",
      zone: { covered: true },
      competition: { directPrimary: 12, chainPrimary: 5, densityGlobal1km: 1643 },
      demographics: { medianIncome: 28448, ownerShare: 0.327, population: 42836 },
      risks: { vacancyPct300: 6, fastFood300: 3, worksUnknown: true, rentUnknown: true },
    },
    "coiffure Carbon-Blanc (concurrence dense, flux faible)": {
      businessType: "coiffure",
      zone: { covered: true },
      competition: { directPrimary: 17, chainPrimary: 0, densityGlobal1km: 38 },
      demographics: { medianIncome: 22204, ownerShare: 0.585, population: 20840 },
      risks: { vacancyPct300: 4, fastFood300: 0, worksUnknown: true, rentUnknown: true },
    },
  };

  for (const [label, input] of Object.entries(fixtures)) {
    const r = computeScore(input);
    console.log(`\n=== ${label}`);
    console.log(`score ${r.score}/10 · ${r.verdict}` + (r.breakdown.vetoes.length ? ` · vetoes: ${r.breakdown.vetoes.join(", ")}` : ""));
    console.log("keyMetrics:", JSON.stringify(r.keyMetrics));
    for (const [k, p] of Object.entries(r.breakdown.pillars)) {
      console.log(`  ${k.padEnd(12)} raw ${String(p.raw).padStart(4)} × ${p.weight} = ${p.weighted}  (${p.category})`);
    }
  }
}

module.exports = { computeScore, WEIGHTS, VERDICT_CUTOFF, COMPETITION_DENSE_MIN };
