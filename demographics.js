/**
 * PIPELINE STEP 5 — Demographics (INSEE IRIS, preloaded CSV)
 * ---------------------------------------------------------
 * Aggregates population, age structure, median income and housing
 * tenure over a set of IRIS codes (zero API — local CSV only).
 *
 * Data files (in ./data, downloaded from insee.fr, 2021 vintage):
 *   - base-ic-evol-struct-pop-2021.CSV   (population + age)
 *   - base-ic-logement-2021.CSV          (housing tenure)
 *   - BASE_TD_FILO_IRIS_2021_DISP.csv    (Filosofi median income)
 *
 * The IRIS codes themselves come from the geometry step (point -> IRIS
 * and isochrone -> IRIS); this module only consumes a list of codes.
 *
 * Run with:  node demographics.js
 */

const fs = require("node:fs");
const path = require("node:path");

// TODO (data freshness): currently on 2021 vintage for report testing.
// 2022 is already available; 2023 expected within weeks. Update the three
// CSVs (and their column-year prefixes, e.g. P21_* -> P23_*) once 2023 ships.
const DATA_DIR = path.join(__dirname, "data");
const POPULATION_CSV = path.join(DATA_DIR, "base-ic-evol-struct-pop-2021.CSV");
const HOUSING_CSV = path.join(DATA_DIR, "base-ic-logement-2021.CSV");
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
      total: parseNumber(c[4]),       // P21_POP
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
      principalResidences: parseNumber(c[5]), // P21_RP
      owners: parseNumber(c[62]),             // P21_RP_PROP
      renters: parseNumber(c[63]),            // P21_RP_LOC
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

function aggregateDemographics(irisCodes, data) {
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

  for (const iris of irisCodes) {
    const pop = data.population.get(iris);
    if (!pop) {
      missing.push(iris);
      continue;
    }
    found.push(iris);

    popTotal += pop.total ?? 0;
    age["0-17"] += pop.age0_17;
    age["18-39"] += pop.age18_39;
    age["40-64"] += pop.age40_64;
    age["65+"] += pop.age65p;

    const housing = data.housing.get(iris);
    if (housing) {
      principalResidences += housing.principalResidences ?? 0;
      owners += housing.owners ?? 0;
    }

    const inc = data.income.get(iris);
    if (inc && inc.medianEuros !== null) {
      const weight = housing?.principalResidences ?? pop.total ?? 0;
      incomeWeightedSum += inc.medianEuros * weight;
      incomeWeight += weight;
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
    irisRequested: irisCodes.length,
    irisFound: found.length,
    irisMissing: missing,
    population: {
      total: round(popTotal),
      // Disclaimer to surface in report P3 (whole-IRIS counting).
      methodNote:
        "Population des IRIS recoupant la zone, comptés entiers (granularité IRIS ~2000 hab. — sur-estime les petites zones).",
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
