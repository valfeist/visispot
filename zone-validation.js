/**
 * PIPELINE STEP 2 — Zone validation (INSEE population threshold)
 * --------------------------------------------------------------
 * Confirms the address sits in a commune above the market's minimum
 * population (FR: 20 000). Below the threshold -> automatic refusal
 * with the market's official out-of-coverage message.
 *
 * Data source: geo.api.gouv.fr (free, no key) which serves the INSEE
 * legal population per commune.
 *
 * Run with:  node zone-validation.js
 */

// Load .env into process.env before any module reads an API key.
require("./load-env");

const { MARKET_CONFIG } = require("./market_config");

// =====================================================================
// BLOCK 1 — Reverse lookup: GPS coordinates -> commune
// =====================================================================
// geo.api.gouv.fr returns the commune whose boundary contains the point.
// Using coordinates (not the postal code) avoids the ambiguity of a
// postal code that spans several communes.

async function lookupCommune(latitude, longitude) {
  const url =
    `https://geo.api.gouv.fr/communes?lat=${latitude}&lon=${longitude}` +
    `&fields=nom,code,codesPostaux,population,departement&format=json`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Commune lookup failed (HTTP ${response.status}): ${await response.text()}`
    );
  }

  const communes = await response.json();
  // The point-in-polygon query returns the containing commune(s);
  // for a precise address there is normally exactly one.
  return communes[0] ?? null;
}

// =====================================================================
// BLOCK 2 — Validate the zone against the market population threshold
// =====================================================================

async function validateZone({ latitude, longitude, market = "FR" }) {
  const marketConfig = MARKET_CONFIG[market];
  if (!marketConfig) {
    throw new Error(
      `Market "${market}" not configured. Available markets: ${Object.keys(MARKET_CONFIG).join(", ")}`
    );
  }

  const threshold = marketConfig.min_population;
  const commune = await lookupCommune(latitude, longitude);

  // No commune found for these coordinates (e.g. outside the country).
  if (!commune) {
    return {
      covered: false,
      reason: "commune_not_found",
      threshold,
      market,
      commune: null,
      message: marketConfig.out_of_coverage_message,
    };
  }

  const population = commune.population ?? null;
  const covered = population !== null && population >= threshold;

  return {
    covered,
    reason: covered ? "above_threshold" : "below_threshold",
    threshold,
    market,
    commune: {
      name: commune.nom,
      inseeCode: commune.code,
      department: commune.departement?.nom ?? null,
      postalCodes: commune.codesPostaux ?? [],
      population,
    },
    // Refusal message only when the zone is not covered.
    message: covered ? null : marketConfig.out_of_coverage_message,
  };
}

// =====================================================================
// BLOCK 3 — Run directly: geocode the test address then validate
// =====================================================================

if (require.main === module) {
  // Reuse step 1's geocoder so the address -> coordinates logic lives in one place.
  const { geocodeAddress } = require("./competitor-search");

  const order = {
    market: "FR",
    address: "65 Rue Judaïque, 33000 Bordeaux, France",
  };

  (async () => {
    const location = await geocodeAddress(order.address);
    const result = await validateZone({
      latitude: location.latitude,
      longitude: location.longitude,
      market: order.market,
    });
    console.log(JSON.stringify(result, null, 2));
  })().catch((error) => {
    console.error("ERROR:", error.message);
    process.exit(1);
  });
}

module.exports = { validateZone, lookupCommune };
