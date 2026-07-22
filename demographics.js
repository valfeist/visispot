/**
 * PIPELINE STEP 5 — Demographics (INSEE IRIS, preloaded CSV)
 * ---------------------------------------------------------
 * Aggregates population, age structure, median income and housing
 * tenure over a set of IRIS codes (zero API — local CSV only).
 *
 * Data files (in ./data, downloaded from insee.fr). Vintage is picked per
 * dimension: the freshest one that INSEE still publishes at the IRIS level.
 *   - base-ic-evol-struct-pop-2022.CSV   (population + age)   — RP 2022
 *   - base-ic-logement-2022.CSV          (housing tenure)     — RP 2022
 *   - BASE_TD_FILO_IRIS_2021_DISP.csv    (Filosofi median income) — 2021
 *
 * The IRIS codes themselves come from the geometry step (point -> IRIS
 * and isochrone -> IRIS); this module only consumes a list of codes.
 *
 * Run with:  node demographics.js
 */

const fs = require("node:fs");
const path = require("node:path");

// Data freshness (verified 2026-07): we take the newest IRIS-level vintage
// available per dimension, not a single uniform year.
//   - Population & housing: RP 2022 (geography as of 01/01/2024). The 2022 CSV
//     columns are positionally identical to 2021, only the prefix changed
//     (P21_* -> P22_*), so the indices below are unchanged.
//   - Income: Filosofi stays 2021. INSEE skipped the 2022 vintage (quality),
//     and Filosofi 2 (2023, a methodology break) is NOT published at the IRIS
//     level — communes and above only. 2021 is therefore the freshest income
//     available at this grain. Do not blend it with commune-level 2023: the two
//     methodologies are not comparable.
const DATA_DIR = path.join(__dirname, "data");
const POPULATION_CSV = path.join(DATA_DIR, "base-ic-evol-struct-pop-2022.CSV");
const HOUSING_CSV = path.join(DATA_DIR, "base-ic-logement-2022.CSV");
const INCOME_CSV = path.join(DATA_DIR, "BASE_TD_FILO_IRIS_2021_DISP.csv");

// =====================================================================
// BLOCK 1 — CSV helpers
// =====================================================================
// INSEE files: ";" separated, CRLF, decimal point ".". Empty cells
// (confidentiality or no data) become null.

function parseNumber(value) {
  if (value === undefined || value === "") return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

// Reads a CSV and returns { header: string[], rows: string[][] }.
function readCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0].split(";");
  const rows = lines.slice(1).map((line) => line.split(";"));
  return { header, rows };
}

// =====================================================================
// BLOCK 2 — Loaders: one Map per dataset, keyed by IRIS code
// =====================================================================

// Age buckets validated against INSEE fine bands (exact, no estimation):
//   0-17  = 0-2 + 3-5 + 6-10 + 11-17
//   18-39 = 18-24 + 25-39
//   40-64 = 40-54 + 55-64
//   65+   = 65-79 + 80+
function loadPopulation() {
  const { rows } = readCsv(POPULATION_CSV);
  const map = new Map();
  for (const c of rows) {
    const iris = c[0];
    const sum = (...idx) => idx.reduce((t, i) => t + (parseNumber(c[i]) ?? 0), 0);
    map.set(iris, {
      total: parseNumber(c[4]),       // P22_POP
      age0_17: sum(5, 6, 7, 8),       // 0002,0305,0610,1117
      age18_39: sum(9, 10),           // 1824,2539
      age40_64: sum(11, 12),          // 4054,5564
      age65p: sum(13, 14),            // 6579,80P
    });
  }
  return map;
}

function loadHousing() {
  const { rows } = readCsv(HOUSING_CSV);
  const map = new Map();
  for (const c of rows) {
    map.set(c[0], {
      principalResidences: parseNumber(c[5]), // P22_RP
      owners: parseNumber(c[62]),             // P22_RP_PROP
      renters: parseNumber(c[63]),            // P22_RP_LOC
    });
  }
  return map;
}

function loadIncome() {
  const { rows } = readCsv(INCOME_CSV);
  const map = new Map();
  for (const c of rows) {
    map.set(c[0], {
      medianEuros: parseNumber(c[4]),    // DISP_MED21
      reliability: parseNumber(c[2]),    // DISP_INCERT21
    });
  }
  return map;
}

// Loads all three datasets once.
function loadIrisData() {
  return {
    population: loadPopulation(),
    housing: loadHousing(),
    income: loadIncome(),
  };
}

// =====================================================================
// BLOCK 3 — Aggregate demographics over a set of IRIS codes
// =====================================================================

function round(n) {
  return n === null ? null : Math.round(n);
}

// Accepts either bare IRIS codes (weight 1) or { code, weight } entries. The
// weight is the surfacic share of the IRIS inside the zone (iris-geometry.js):
// each IRIS's counts are multiplied by it instead of being counted whole.
function aggregateDemographics(irisEntries, data) {
  const entries = irisEntries.map((e) =>
    typeof e === "string" ? { code: e, weight: 1 } : { code: e.code, weight: e.weight ?? 1 }
  );

  const found = [];
  const missing = [];

  let popTotal = 0;
  const age = { "0-17": 0, "18-39": 0, "40-64": 0, "65+": 0 };
  let principalResidences = 0;
  let owners = 0;

  // Income medians cannot be summed: we keep a household-weighted mean
  // of the per-IRIS medians, plus the observed range.
  let incomeWeightedSum = 0;
  let incomeWeight = 0;
  let incomeMin = null;
  let incomeMax = null;
  let irisWithIncome = 0;

  for (const { code, weight } of entries) {
    const pop = data.population.get(code);
    if (!pop) {
      missing.push(code);
      continue;
    }
    found.push(code);

    popTotal += (pop.total ?? 0) * weight;
    age["0-17"] += pop.age0_17 * weight;
    age["18-39"] += pop.age18_39 * weight;
    age["40-64"] += pop.age40_64 * weight;
    age["65+"] += pop.age65p * weight;

    const housing = data.housing.get(code);
    if (housing) {
      principalResidences += (housing.principalResidences ?? 0) * weight;
      owners += (housing.owners ?? 0) * weight;
    }

    const inc = data.income.get(code);
    if (inc && inc.medianEuros !== null) {
      // Weight the income mean by (households × surfacic share).
      const w = (housing?.principalResidences ?? pop.total ?? 0) * weight;
      incomeWeightedSum += inc.medianEuros * w;
      incomeWeight += w;
      irisWithIncome += 1;
      incomeMin = incomeMin === null ? inc.medianEuros : Math.min(incomeMin, inc.medianEuros);
      incomeMax = incomeMax === null ? inc.medianEuros : Math.max(incomeMax, inc.medianEuros);
    }
  }

  // Age shares (fractions of the located population).
  const ageBreakdown = {};
  for (const [bucket, count] of Object.entries(age)) {
    ageBreakdown[bucket] = {
      count: round(count),
      share: popTotal > 0 ? Number((count / popTotal).toFixed(3)) : null,
    };
  }

  // Quality signal (brief, step 6): no IRIS data -> "absente";
  // some IRIS or income missing -> "partielle"; otherwise "complete".
  let quality;
  if (found.length === 0) {
    quality = "absente";
  } else if (missing.length > 0 || irisWithIncome < found.length) {
    quality = "partielle";
  } else {
    quality = "complete";
  }

  return {
    quality,
    irisRequested: entries.length,
    irisFound: found.length,
    irisMissing: missing,
    population: {
      total: round(popTotal),
      // Disclaimer to surface in report P3 (surfacic weighting).
      methodNote:
        "Population pondérée par la part surfacique de chaque IRIS incluse dans la zone (intersection IRIS × isochrone). Un IRIS sans géométrie est compté entier.",
    },
    ageBreakdown,
    housing: {
      principalResidences: round(principalResidences),
      ownerShare: principalResidences > 0 ? Number((owners / principalResidences).toFixed(3)) : null,
    },
    income: {
      medianEuros: incomeWeight > 0 ? round(incomeWeightedSum / incomeWeight) : null,
      rangeEuros: { min: round(incomeMin), max: round(incomeMax) },
      irisWithIncome,
      method: "household-weighted mean of per-IRIS medians",
    },
  };
}

// =====================================================================
// BLOCK 4 — Run directly: aggregate over all IRIS of Bordeaux (33063)
// =====================================================================

if (require.main === module) {
  const data = loadIrisData();

  // All IRIS whose code starts with the Bordeaux commune code.
  const bordeauxIris = [...data.population.keys()].filter((iris) =>
    iris.startsWith("33063")
  );

  const result = aggregateDemographics(bordeauxIris, data);
  console.log("Bordeaux (commune 33063) — aggregated demographics");
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { loadIrisData, aggregateDemographics };
