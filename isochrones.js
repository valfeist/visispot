/**
 * PIPELINE STEP 4 — Walking isochrones (Openrouteservice)
 * -------------------------------------------------------
 * Computes the 5 min and 10 min walking areas around the address,
 * as polygons to be drawn on the report maps (P3).
 *
 * Data source: Openrouteservice API (free tier: 2000 req/day).
 * Requires a free API key from https://account.heigit.org/signup
 *
 * Run with:  node isochrones.js
 */

// Load .env into process.env before reading any API key.
require("./load-env");

// =====================================================================
// BLOCK 1 — Configuration: ORS key + isochrone parameters
// =====================================================================

const ORS_API_KEY = process.env.OPENROUTESERVICE_API_KEY;

// Walking profile and the two time rings, in seconds.
const ORS_PROFILE = "foot-walking";
const WALK_5_MIN_SECONDS = 300;
const WALK_10_MIN_SECONDS = 600;

// =====================================================================
// BLOCK 2 — Fetch isochrones from Openrouteservice
// =====================================================================
// ORS expects coordinates as [longitude, latitude] (note the order) and
// returns a GeoJSON FeatureCollection — one polygon feature per range.

async function fetchIsochrones(latitude, longitude) {
  const response = await fetch(
    `https://api.openrouteservice.org/v2/isochrones/${ORS_PROFILE}`,
    {
      method: "POST",
      headers: {
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locations: [[longitude, latitude]],
        range: [WALK_5_MIN_SECONDS, WALK_10_MIN_SECONDS],
        range_type: "time",
        // "area" -> polygon area in m²; lets us report each ring's size.
        attributes: ["area"],
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Isochrone request failed (HTTP ${response.status}): ${JSON.stringify(data)}`
    );
  }

  return data;
}

// =====================================================================
// BLOCK 3 — Structure the two rings (5 min / 10 min)
// =====================================================================
// Picks each ring out of the GeoJSON by its "value" (range in seconds)
// and keeps the polygon geometry + area for the report.

function buildRing(geojson, rangeSeconds) {
  const feature = geojson.features.find(
    (f) => f.properties.value === rangeSeconds
  );
  if (!feature) {
    return null;
  }
  // A polygon is an array of linear rings; the first is the outer boundary.
  const outerRing = feature.geometry.coordinates[0] ?? [];
  return {
    rangeSeconds,
    rangeMinutes: rangeSeconds / 60,
    areaSqMeters: feature.properties.area ?? null,
    vertexCount: outerRing.length,
    geometry: feature.geometry, // full GeoJSON polygon, for the map
  };
}

function buildIsochroneOutput(latitude, longitude, geojson) {
  return {
    profile: ORS_PROFILE,
    center: { latitude, longitude },
    rings: {
      walk5min: buildRing(geojson, WALK_5_MIN_SECONDS),
      walk10min: buildRing(geojson, WALK_10_MIN_SECONDS),
    },
  };
}

// Convenience wrapper: coordinates -> structured isochrones.
async function getIsochrones(latitude, longitude) {
  const geojson = await fetchIsochrones(latitude, longitude);
  return buildIsochroneOutput(latitude, longitude, geojson);
}

// =====================================================================
// BLOCK 4 — Run directly: geocode the test address then fetch isochrones
// =====================================================================

if (require.main === module) {
  // Reuse step 1's geocoder so the address -> coordinates logic lives in one place.
  const { geocodeAddress } = require("./competitor-search");

  const order = {
    address: "65 Rue Judaïque, 33000 Bordeaux, France",
  };

  (async () => {
    const location = await geocodeAddress(order.address);
    const result = await getIsochrones(location.latitude, location.longitude);

    // Readable summary (the full polygon geometry stays in the object).
    const { walk5min, walk10min } = result.rings;
    console.log("Profile :", result.profile);
    console.log("Center  :", result.center.latitude, result.center.longitude);
    for (const [label, ring] of [["5 min", walk5min], ["10 min", walk10min]]) {
      if (!ring) {
        console.log(`${label.padEnd(6)}: (no ring returned)`);
        continue;
      }
      const hectares = ring.areaSqMeters ? (ring.areaSqMeters / 10000).toFixed(1) : "?";
      console.log(
        `${label.padEnd(6)}: area ${hectares} ha | ${ring.vertexCount} polygon points`
      );
    }
  })().catch((error) => {
    console.error("ERROR:", error.message);
    process.exit(1);
  });
}

module.exports = { getIsochrones, fetchIsochrones, buildIsochroneOutput };
