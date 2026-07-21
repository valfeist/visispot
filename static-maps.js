/**
 * PIPELINE STEP 9 — Static maps (Mapbox Static Images API)
 * --------------------------------------------------------
 * Generates the 3 report maps as PNG files:
 *   - location   (P2): address marker
 *   - isochrone  (P3): 5 & 10 min walking polygons
 *   - competitors(P4): competitor markers around the address
 *
 * Data source: Mapbox Static Images API (free tier: 50k req/month).
 * Requires a public token (pk.*) from https://account.mapbox.com/
 *
 * Run with:  node static-maps.js
 */

require("./load-env");

const fs = require("node:fs");
const path = require("node:path");

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
// Neutral, institutional basemap (per report design guidelines).
const STYLE_BASE = "https://api.mapbox.com/styles/v1/mapbox/light-v11/static";
const SIZE = "800x600@2x";
const OUTPUT_DIR = path.join(__dirname, "output");

// =====================================================================
// BLOCK 1 — Helpers
// =====================================================================

// Shorten coordinates to keep the request URL within Mapbox's length limit.
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// Turns "65 Rue Judaïque, 33000 Bordeaux" into "65-rue-judaique-33000-bordeaux".
function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// One folder per report: "<YYYY-MM-DD>_<address-slug>".
function reportFolderName(addressLabel, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return `${day}_${slugify(addressLabel)}`;
}

function roundGeometry(geometry) {
  const roundRing = (ring) => ring.map(([x, y]) => [round5(x), round5(y)]);
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map(roundRing) };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((poly) => poly.map(roundRing)),
    };
  }
  return geometry;
}

// A GeoJSON feature with Mapbox "simplestyle" properties (fill/stroke).
function styledFeature(geometry, color, fillOpacity) {
  return {
    type: "Feature",
    properties: {
      stroke: color,
      "stroke-width": 2,
      "stroke-opacity": 0.9,
      fill: color,
      "fill-opacity": fillOpacity,
    },
    geometry: roundGeometry(geometry),
  };
}

function geojsonOverlay(featureCollection) {
  return `geojson(${encodeURIComponent(JSON.stringify(featureCollection))})`;
}

// =====================================================================
// BLOCK 2 — URL builders (one per report map)
// =====================================================================

// Enriched P2 map: 5-min isochrone overlay + transport/parking pins + the
// central address marker. streetContext and isochrone5 are optional.
const TRANSPORT_PIN_COLOR = { "métro": "e63946", bus: "457b9d", tram: "2d6a4f", train: "457b9d", station: "457b9d" };

function buildLocationMapUrl(latitude, longitude, streetContext = null, isochrone5 = null) {
  const overlays = [];

  // Isochrone first so the pins render on top of it.
  if (isochrone5) {
    const fc = { type: "FeatureCollection", features: [styledFeature(isochrone5, "#1a4fa3", 0.2)] };
    overlays.push(geojsonOverlay(fc));
  }
  // Numbered transport pins (1..N), matching the P2 transport list order.
  (streetContext?.transports ?? []).slice(0, 12).forEach((t, i) => {
    if (t.lat == null || t.lon == null) return;
    const color = TRANSPORT_PIN_COLOR[t.type] ?? "457b9d";
    overlays.push(`pin-s-${i + 1}+${color}(${round5(t.lon)},${round5(t.lat)})`);
  });
  for (const p of (streetContext?.parking?.items ?? []).slice(0, 6)) {
    if (p.lat == null || p.lon == null) continue;
    overlays.push(`pin-s+888888(${round5(p.lon)},${round5(p.lat)})`);
  }
  // Central marker (address) last → drawn on top.
  overlays.push(`pin-l+1a4fa3(${round5(longitude)},${round5(latitude)})`);

  return `${STYLE_BASE}/${overlays.join(",")}/auto/${SIZE}?access_token=${MAPBOX_TOKEN}`;
}

function buildIsochroneMapUrl(latitude, longitude, geometry5min, geometry10min) {
  // Draw the wider 10 min ring first so the 5 min ring sits on top.
  const fc = {
    type: "FeatureCollection",
    features: [
      styledFeature(geometry10min, "#f5a623", 0.15),
      styledFeature(geometry5min, "#1a73e8", 0.25),
    ],
  };
  const marker = `pin-s+e02d2d(${round5(longitude)},${round5(latitude)})`;
  // "auto" frames the overlays automatically.
  return `${STYLE_BASE}/${geojsonOverlay(fc)},${marker}/auto/${SIZE}?access_token=${MAPBOX_TOKEN}`;
}

// Numbered pins: direct competitors red (1..N), chains orange (1..M),
// central address marker a black star. Lists must already be sorted
// (same order as the report legend). Mapbox number labels go up to 99.
function buildCompetitorsMapUrl(latitude, longitude, direct = [], chain = []) {
  const overlays = [];
  const pin = (c, label, color) =>
    c.latitude != null && c.longitude != null
      ? `pin-s-${label}+${color}(${round5(c.longitude)},${round5(c.latitude)})`
      : null;

  // Direct = red, numbered 1..N ; chains = orange, numbered CONTINUING (N+1..).
  direct.slice(0, 30).forEach((c, i) => { const p = pin(c, i + 1, "e02d2d"); if (p) overlays.push(p); });
  chain.slice(0, 20).forEach((c, i) => { const p = pin(c, direct.length + i + 1, "f5a623"); if (p) overlays.push(p); });
  // Central marker last → drawn on top.
  overlays.push(`pin-l-star+000000(${round5(longitude)},${round5(latitude)})`);

  return `${STYLE_BASE}/${overlays.join(",")}/auto/${SIZE}?access_token=${MAPBOX_TOKEN}`;
}

// =====================================================================
// BLOCK 3 — Download a map URL to output/<filename>
// =====================================================================

// relativePath is relative to output/, e.g. "<report-folder>/p2-location.png".
async function downloadMap(url, relativePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Map download failed (HTTP ${response.status}): ${await response.text()}`
    );
  }
  const filePath = path.join(OUTPUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return { filePath, bytes: buffer.length };
}

// =====================================================================
// BLOCK 4 — Run directly: build & download the 3 maps for Bordeaux
// =====================================================================

if (require.main === module) {
  const { geocodeAddress, searchCompetitors } = require("./competitor-search");
  const { getIsochrones } = require("./isochrones");

  const order = { address: "65 Rue Judaïque, 33000 Bordeaux, France" };

  (async () => {
    const loc = await geocodeAddress(order.address);
    const isochrones = await getIsochrones(loc.latitude, loc.longitude);
    const competitors = await searchCompetitors(loc.latitude, loc.longitude, 1000, ["bakery"]);

    // One folder per report; files prefixed by the report page they belong to.
    const folder = reportFolderName(order.address);
    const maps = [
      ["p2-location.png", buildLocationMapUrl(loc.latitude, loc.longitude)],
      [
        "p3-isochrones.png",
        buildIsochroneMapUrl(
          loc.latitude,
          loc.longitude,
          isochrones.rings.walk5min.geometry,
          isochrones.rings.walk10min.geometry
        ),
      ],
      ["p4-competitors.png", buildCompetitorsMapUrl(loc.latitude, loc.longitude, competitors)],
    ];

    console.log(`Report folder: output/${folder}/\n`);
    for (const [filename, url] of maps) {
      const { filePath, bytes } = await downloadMap(url, path.join(folder, filename));
      console.log(`${filename.padEnd(20)} ${(bytes / 1024).toFixed(0)} KB  (URL ${url.length} chars)`);
    }
  })().catch((error) => {
    console.error("ERROR:", error.message);
    process.exit(1);
  });
}

module.exports = {
  reportFolderName,
  buildLocationMapUrl,
  buildIsochroneMapUrl,
  buildCompetitorsMapUrl,
  downloadMap,
};
