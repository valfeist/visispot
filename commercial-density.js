/**
 * PIPELINE STEP 8 — Commercial density (OpenStreetMap / Overpass)
 * --------------------------------------------------------------
 * Counts and classifies commercial POIs (shops + commercial amenities)
 * around the address, for the 300 m / 500 m / 1 km rings (report P4).
 *
 * Data source: Overpass API (OpenStreetMap) — free, no key.
 *
 * Run with:  node commercial-density.js
 */

// Public Overpass mirrors, tried in order — the main server is often busy (504).
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Concentric rings (meters). One Overpass call at the largest radius;
// smaller rings are derived locally by distance.
const RING_RADII = [300, 500, 1000];
const MAX_RADIUS = Math.max(...RING_RADII);

// Commercial amenities counted alongside every shop=* POI.
const COMMERCIAL_AMENITIES =
  "restaurant|cafe|fast_food|bar|pub|ice_cream|food_court|pharmacy|bank|post_office|marketplace";

// =====================================================================
// BLOCK 1 — Fetch commercial POIs from Overpass
// =====================================================================

// Runs an Overpass QL query, trying each mirror in order (the main server
// is often busy with 504s). Returns the parsed JSON. Reusable by other steps.
async function queryOverpass(query, { retries = 2, delayMs = 5000 } = {}) {
  let lastError = null;
  // Several passes over all mirrors; 504s ("server too busy") are transient.
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            // Overpass rejects requests without an identifying User-Agent (HTTP 406).
            "User-Agent": "VisiSpot/1.0 (commercial location analysis; contact: ops@visispot.fr)",
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!response.ok) {
          lastError = `${endpoint} -> HTTP ${response.status}`;
          continue;
        }
        return await response.json();
      } catch (error) {
        lastError = `${endpoint} -> ${error.message}`;
      }
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `All Overpass mirrors failed after ${retries + 1} attempts. Last error: ${lastError}`
  );
}

async function fetchCommercialPois(latitude, longitude) {
  const query = `
    [out:json][timeout:30];
    (
      nwr(around:${MAX_RADIUS},${latitude},${longitude})[shop];
      nwr(around:${MAX_RADIUS},${latitude},${longitude})[amenity~"^(${COMMERCIAL_AMENITIES})$"];
    );
    out tags center;
  `;

  const data = await queryOverpass(query);

  // Nodes carry lat/lon directly; ways/relations carry a `center`.
  return data.elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const category = el.tags?.shop ?? el.tags?.amenity ?? "unknown";
      return lat !== undefined && lon !== undefined ? { lat, lon, category } : null;
    })
    .filter(Boolean);
}

// =====================================================================
// BLOCK 2 — Distance from the address to a POI (meters)
// =====================================================================

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

// =====================================================================
// BLOCK 3 — Build density per ring (total + breakdown by category)
// =====================================================================

function buildDensity(latitude, longitude, pois) {
  // Distance once per POI.
  const withDistance = pois.map((p) => ({
    ...p,
    distance: haversineMeters(latitude, longitude, p.lat, p.lon),
  }));

  const rings = {};
  for (const radius of RING_RADII) {
    const inRing = withDistance.filter((p) => p.distance <= radius);
    const byCategory = {};
    for (const p of inRing) {
      byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
    }
    // Sort categories by count (descending) for readability.
    const sorted = Object.fromEntries(
      Object.entries(byCategory).sort((a, b) => b[1] - a[1])
    );
    rings[`r${radius}`] = { radiusMeters: radius, total: inRing.length, byCategory: sorted };
  }

  // OSM is community-maintained: flag thin coverage rather than asserting completeness.
  const quality = rings.r1000.total < 10 ? "partielle" : "complete";

  return {
    source: "OpenStreetMap / Overpass",
    center: { latitude, longitude },
    quality,
    rings,
  };
}

async function getCommercialDensity(latitude, longitude) {
  const pois = await fetchCommercialPois(latitude, longitude);
  return buildDensity(latitude, longitude, pois);
}

// =====================================================================
// BLOCK 4 — Run directly on the Bordeaux test address
// =====================================================================

if (require.main === module) {
  const { geocodeAddress } = require("./competitor-search");
  const order = { address: "65 Rue Judaïque, 33000 Bordeaux, France" };

  (async () => {
    const location = await geocodeAddress(order.address);
    const result = await getCommercialDensity(location.latitude, location.longitude);

    console.log("Source :", result.source, "| quality:", result.quality);
    for (const radius of RING_RADII) {
      const ring = result.rings[`r${radius}`];
      const top = Object.entries(ring.byCategory).slice(0, 6)
        .map(([cat, n]) => `${cat}:${n}`).join(", ");
      console.log(`\n${radius} m → ${ring.total} commerces`);
      console.log("  top: " + top);
    }
  })().catch((error) => {
    console.error("ERROR:", error.message);
    process.exit(1);
  });
}

module.exports = { getCommercialDensity, fetchCommercialPois, queryOverpass };
