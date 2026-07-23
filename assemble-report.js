/**
 * PIPELINE STEP 11 (orchestrator) — Assemble the full report
 * ----------------------------------------------------------
 * Runs every pipeline step for one address, calls the 4 LLM tasks,
 * downloads the 3 maps, and writes a self-contained 6-page HTML report
 * into output/<report-folder>/report.html (open it → Cmd+P → Save as PDF).
 *
 * Run with:  node assemble-report.js
 */

require("./load-env");

const fs = require("node:fs");
const path = require("node:path");

const { geocodeAddress, searchCompetitors,
  searchCompetitorsForSector, classifyCompetitors, includedTypesForSector, detectContamination } =
  require("./competitor-search");
const { validateZone } = require("./zone-validation");
const { getIsochrones } = require("./isochrones");
const { findIrisWeightsInPolygon } = require("./iris-geometry");
const { loadIrisData, aggregateDemographics } = require("./demographics");
const { getCommercialDensity } = require("./commercial-density");
const { getStreetContext } = require("./street-context");
const { getCommercialDynamics } = require("./commercial-dynamics");
const { getCommercialSaleReference } = require("./market-reference");
const { SECTOR_CONFIG } = require("./sector_config");
const { EXCLUSION_LISTS } = require("./exclusion-lists");
const { MVP_SECTORS, assertSectorKeyConsistency } = require("./sector-keys");
const {
  reportFolderName,
  buildLocationMapUrl,
  buildIsochroneMapUrl,
  buildCompetitorsMapUrl,
  downloadMap,
} = require("./static-maps");
const { competitiveSynthesis, sectorAdequacy, riskSignals, writeVerdictSummary, zoneSynthesis } =
  require("./llm-synthesis");
const { computeScore } = require("./scoring");
const { buildReportHtml } = require("./report-builder");

const OUTPUT_DIR = path.join(__dirname, "output");

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Adds distanceMeters to each competitor and sorts nearest-first.
function withDistanceSorted(list, lat, lon) {
  return list
    .map((c) => ({
      ...c,
      distanceMeters:
        c.latitude != null && c.longitude != null
          ? Math.round(haversineMeters(lat, lon, c.latitude, c.longitude))
          : null,
    }))
    .sort((a, b) => (a.distanceMeters ?? 1e9) - (b.distanceMeters ?? 1e9));
}

// Simulated order (would come from the form).
// CLI overrides:  node assemble-report.js "<adresse>" <secteur> [surface_m2] [loyer_€/mois]
const order = {
  address: process.argv[2] || "65 Rue Judaïque, 33000 Bordeaux, France",
  businessType: process.argv[3] || "boulangerie",
  // Optional fields — edit here (or pass via CLI) to vary the test.
  surfaceSqm: process.argv[4] ? Number(process.argv[4]) : 80,
  monthlyRent: process.argv[5] ? Number(process.argv[5]) : 2500,
  targetAudience: ["Résidents du quartier", "Familles"],
  knownCompetitors: null, // Champ 4 (texte libre) — laissé vide hors démo.
};

// Boot assertion: every sector-keyed config must share the exact MVP perimeter,
// otherwise a selectable sector could run without a whitelist/benchmark.
assertSectorKeyConsistency();

// Guard: the business sector must be one we support across the pipeline.
if (!MVP_SECTORS.includes(order.businessType)) {
  console.error(
    `Secteur "${order.businessType}" non géré.\nSecteurs valides : ${MVP_SECTORS.join(", ")}`
  );
  process.exit(1);
}

async function main() {
  console.log(`Analyse : ${order.address} · secteur "${order.businessType}"\n`);
  // --- 1. Geocode + zone validation ---------------------------------
  const loc = await geocodeAddress(order.address);
  const zone = await validateZone({
    latitude: loc.latitude,
    longitude: loc.longitude,
    market: "FR",
  });

  // --- 2. Competitors -----------------------------------------------
  const radii = SECTOR_CONFIG[order.businessType];
  const types = includedTypesForSector(order.businessType);
  const entries = EXCLUSION_LISTS[order.businessType] ?? [];
  const primaryRaw = await searchCompetitorsForSector(loc.latitude, loc.longitude, radii.radius_primary, order.businessType);
  const secondaryRaw = await searchCompetitorsForSector(loc.latitude, loc.longitude, radii.radius_secondary, order.businessType);

  // Contamination guard-rail: flag any raw result whose primaryType is outside
  // the sector whitelist (cross-sector bleed detector, all sectors).
  const contamination = detectContamination(primaryRaw, order.businessType);
  if (contamination.length) {
    console.warn(`⚠️  Contamination filtrée (${contamination.length}) : ` +
      contamination.map((c) => `${c.name} [${c.primaryType}]`).join(", "));
  }

  const primary = classifyCompetitors(primaryRaw, order.businessType, entries);
  const secondary = classifyCompetitors(secondaryRaw, order.businessType, entries);
  const placesStatus = primary.direct.length + primary.chain.length < 3 ? "partielle" : "complete";

  // --- 3. Isochrones + demographics ---------------------------------
  const isochrones = await getIsochrones(loc.latitude, loc.longitude);
  const irisData = loadIrisData();
  const iris5 = await findIrisWeightsInPolygon(isochrones.rings.walk5min.geometry);
  const iris10 = await findIrisWeightsInPolygon(isochrones.rings.walk10min.geometry);
  const agg5 = aggregateDemographics(iris5, irisData);
  const agg10 = aggregateDemographics(iris10, irisData);

  // --- 4. Commercial density + street context (P2) ------------------
  const density = await getCommercialDensity(loc.latitude, loc.longitude);
  const streetContext = await getStreetContext(loc.latitude, loc.longitude);

  // P6 best-effort signals: BODACC dynamics (by postal code) + DVF sale ref.
  const postalCode = (order.address.match(/\b(\d{5})\b/) || [])[1] || zone.commune?.postalCodes?.[0];
  const bodacc = await getCommercialDynamics(postalCode);
  const saleReference = await getCommercialSaleReference(zone.commune?.inseeCode);
  const vacant300 = density.rings.r300.byCategory.vacant ?? 0;
  const densityGlobal = {
    r300: density.rings.r300.total,
    r500: density.rings.r500.total,
    r1000: density.rings.r1000.total,
  };

  // Flux is qualitative (BestTime coverage is thin here): proxy from density.
  const fluxQualitative = `Estimation directe indisponible (BestTime). Densité commerciale élevée (${density.rings.r1000.total} commerces à 1 km), suggérant un flux de rue moyen à élevé — à confirmer par observation terrain.`;

  // Sorted competitor lists (with distance) for the P4 numbered map + legend.
  const directSorted = withDistanceSorted(primary.direct, loc.latitude, loc.longitude);
  const chainSorted = withDistanceSorted(primary.chain, loc.latitude, loc.longitude);

  // --- 5. Demographic shares helper ---------------------------------
  const ageShares = (agg) => ({
    "0-17": agg.ageBreakdown["0-17"].share,
    "18-39": agg.ageBreakdown["18-39"].share,
    "40-64": agg.ageBreakdown["40-64"].share,
    "65+": agg.ageBreakdown["65+"].share,
  });

  // --- 6. LLM tasks (P4, P5, P6, then P1) ---------------------------
  console.log("Appel LLM P4 (synthèse concurrentielle)...");
  const p4Synthesis = (await competitiveSynthesis({
    businessType: order.businessType,
    placesStatus,
    catchmentArea: {
      radiusMeters: radii.radius_primary,
      directCount: primary.direct.length,
      chainCount: primary.chain.length,
      topDirect: primary.direct.slice(0, 6).map((c) => ({ name: c.name, googleRating: c.googleRating })),
      chains: primary.chain.map((c) => c.name),
    },
    sectorProfile: {
      radiusMeters: radii.radius_secondary,
      directCount: secondary.direct.length,
      chainCount: secondary.chain.length,
    },
    commercialDensityByCategory: density.rings.r500.byCategory,
  })).json;

  console.log("Appel LLM P3 (synthèse de zone)...");
  const p3llm = (await zoneSynthesis({
    commune: zone.commune?.name,
    density: densityGlobal,
    demographics: {
      population: agg10.population.total,
      ageBreakdown: ageShares(agg10),
      ownerShare: agg10.housing.ownerShare,
      medianIncome: agg10.income.medianEuros,
    },
  })).json;

  // P1 runs BEFORE P5 so its verdict + signals can feed the P5/P1 liaison.
  // The score/verdict/keyMetrics are computed DETERMINISTICALLY (scoring.js);
  // the LLM only writes the executive prose from that breakdown.
  const p1Input = {
    businessType: order.businessType,
    targetAudience: order.targetAudience,
    zone: { commune: zone.commune?.name, population: zone.commune?.population, covered: zone.covered },
    dataQuality: { places: placesStatus, iris: agg10.quality, besttime: "insuffisant" },
    competition: {
      radiusPrimary: radii.radius_primary,
      directPrimary: primary.direct.length,
      chainPrimary: primary.chain.length,
      directSecondary: secondary.direct.length,
      densityGlobal1km: density.rings.r1000.total,
    },
    demographics: {
      population: agg10.population.total,
      ageBreakdown: ageShares(agg10),
      ownerShare: agg10.housing.ownerShare,
      medianIncome: agg10.income.medianEuros,
    },
    risks: {
      vacancyPct300: density.rings.r300.total > 0 ? Math.round((vacant300 / density.rings.r300.total) * 100) : 0,
      fastFood300: density.rings.r300.byCategory.fast_food ?? 0,
      restaurant300: density.rings.r300.byCategory.restaurant ?? 0,
      worksUnknown: true,
      rentUnknown: true,
    },
  };

  const scored = computeScore(p1Input);
  console.log(`Score déterministe : ${scored.score}/10 · ${scored.verdict}` + (scored.breakdown.vetoes.length ? ` (vetos : ${scored.breakdown.vetoes.join(", ")})` : ""));

  console.log("Appel LLM P1 (rédaction du verdict)...");
  const p1Prose = (await writeVerdictSummary({ ...p1Input, ...scored })).json;
  const p1 = {
    score: scored.score,
    verdict: scored.verdict,
    keyMetrics: scored.keyMetrics,
    scoreBreakdown: scored.breakdown,
    ...p1Prose,
  };

  console.log("Appel LLM P5 (adéquation sectorielle)...");
  const p5 = (await sectorAdequacy({
    businessType: order.businessType,
    surfaceSqm: order.surfaceSqm,
    targetAudience: order.targetAudience,
    fluxEstimate: { quality: "insuffisant" },
    demographics: {
      population: agg10.population.total,
      ageBreakdown: ageShares(agg10),
      ownerShare: agg10.housing.ownerShare,
      medianIncome: agg10.income.medianEuros,
    },
    p1Verdict: p1.verdict,
    p1Signals: p1.keyMetrics,
  })).json;

  console.log("Appel LLM P6 (signaux de risque)...");
  const p6 = (await riskSignals({
    businessType: order.businessType,
    vacancy: {
      vacant300,
      total300: density.rings.r300.total,
      pct300: density.rings.r300.total > 0 ? Math.round((vacant300 / density.rings.r300.total) * 100) : 0,
      vacant1000: density.rings.r1000.byCategory.vacant ?? 0,
      total1000: density.rings.r1000.total,
      pct1000:
        density.rings.r1000.total > 0
          ? Math.round(((density.rings.r1000.byCategory.vacant ?? 0) / density.rings.r1000.total) * 100)
          : 0,
    },
    bodacc,
    density: {
      fastFood300: density.rings.r300.byCategory.fast_food ?? 0,
      restaurant300: density.rings.r300.byCategory.restaurant ?? 0,
    },
    worksDataAvailable: false,
  })).json;

  // --- 7. Maps ------------------------------------------------------
  const folder = reportFolderName(order.address);
  const dir = path.join(OUTPUT_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });

  console.log("Génération des cartes...");
  await downloadMap(
    buildLocationMapUrl(loc.latitude, loc.longitude, streetContext, isochrones.rings.walk5min.geometry),
    path.join(folder, "p2-location.png")
  );
  await downloadMap(
    buildIsochroneMapUrl(loc.latitude, loc.longitude, isochrones.rings.walk5min.geometry, isochrones.rings.walk10min.geometry),
    path.join(folder, "p3-isochrones.png")
  );
  await downloadMap(
    buildCompetitorsMapUrl(loc.latitude, loc.longitude, directSorted, chainSorted),
    path.join(folder, "p4-competitors.png")
  );

  // --- 8. Assemble report data + write HTML -------------------------
  const now = new Date();
  const reportData = {
    meta: {
      service: "VisiSpot",
      // Use the geocoded (normalized) address for the title/header: it is the
      // address actually analyzed and is always well-formed (commune + country),
      // unlike the raw input which may omit ", France".
      address: loc.formattedAddress,
      businessType: order.businessType,
      dateLabel: now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
    },
    order: {
      geocodedAddress: loc.formattedAddress,
      businessType: order.businessType,
      targetAudience: order.targetAudience,
      knownCompetitors: order.knownCompetitors,
      monthlyRent: order.monthlyRent,
    },
    // Per-source quality signals for the P1 "Sources utilisées" footer.
    dataQuality: {
      googlePlaces: placesStatus,
      inseeIris: agg10.quality,
      openStreetMap: density.quality,
      bestTime: "insuffisant",
      mapbox: "complete",
      openrouteservice: "complete",
      // Cross-sector contamination filtered out of the primary radius (guard-rail).
      contaminationFiltered: contamination.length,
      contaminationSample: contamination.slice(0, 8),
    },
    p1,
    p2: {
      geocodedAddress: loc.formattedAddress,
      commune: `${zone.commune?.name} (${zone.commune?.population?.toLocaleString("fr-FR")} hab.)`,
      fluxQualitative,
      streetContext,
      mapFile: "p2-location.png",
    },
    p3: {
      pop5: agg5.population.total,
      pop10: agg10.population.total,
      ageBreakdown: ageShares(agg10),
      ownerShare: agg10.housing.ownerShare,
      medianIncome: agg10.income.medianEuros,
      densityRings: [300, 500, 1000].map((r) => ({
        radius: r,
        total: density.rings[`r${r}`].total,
        byCategory: density.rings[`r${r}`].byCategory,
      })),
      densityInterpretation: p3llm.densityInterpretation,
      zoneSummary: p3llm.zoneSummary,
      methodNote: agg10.population.methodNote,
      mapFile: "p3-isochrones.png",
    },
    p4: {
      radiusPrimary: radii.radius_primary,
      directPrimary: directSorted,
      chainPrimary: chainSorted,
      complementarities: p4Synthesis.complementarities,
      synthesis: p4Synthesis.synthesis,
      vacancy: vacant300, // kept in context (now interpreted in P6), not rendered in P4
      mapFile: "p4-competitors.png",
    },
    p5,
    p6: {
      ...p6,
      rentAnalysis: {
        monthlyRent: order.monthlyRent ?? null,
        surfaceSqm: order.surfaceSqm ?? null,
        rentPerSqmYear:
          order.monthlyRent && order.surfaceSqm
            ? Math.round((order.monthlyRent * 12) / order.surfaceSqm)
            : null,
        saleReference,
      },
    },
  };

  // Save the assembled data so the HTML can be rebuilt without re-running
  // the pipeline (fast/free template iteration via rebuild-report.js).
  fs.writeFileSync(path.join(dir, "report-data.json"), JSON.stringify(reportData, null, 2));

  const html = buildReportHtml(reportData);
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(htmlPath, html);

  console.log("\n✅ Rapport généré :");
  console.log("  HTML :", htmlPath);
  console.log("  Verdict :", p1.verdict, "· Score :", p1.score + "/10");
  console.log("\nOuvre le HTML dans un navigateur puis Cmd+P → « Enregistrer en PDF ».");
}

main().catch((error) => {
  console.error("ERROR:", error.message);
  process.exit(1);
});
