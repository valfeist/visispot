/**
 * PIPELINE STEP 5 (geometry) — Address/isochrone -> IRIS codes
 * ------------------------------------------------------------
 * Resolves which IRIS contains the address, and which IRIS fall inside
 * the walking isochrones, so demographics.js can aggregate over them.
 *
 * Geometry is fetched on demand (only the IRIS around the address) from
 * the free OpenDataSoft "georef-france-iris" dataset via the in_bbox
 * filter. All point-in-polygon tests run locally (no dependency).
 *
 * Run with:  node iris-geometry.js
 */

const ODS_RECORDS_URL =
  "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-france-iris/records";

// Pin the IRIS contour vintage. The dataset currently holds only "2024"
// (geography as of 01/01/2024), which is exactly the geography of the RP 2022
// demographics CSVs. Pinning keeps geometry reproducible and prevents silently
// mixing a future millésime whose IRIS codes would no longer match the CSVs.
const IRIS_YEAR = "2024";

// =====================================================================
// BLOCK 1 — Fetch IRIS (code + geometry) within a bounding box
// =====================================================================
// in_bbox expects (minLat, minLon, maxLat, maxLon). Paginates by 100
// until every IRIS in the box has been collected.

async function fetchIrisInBbox({ minLat, minLon, maxLat, maxLon }) {
  const collected = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const params = new URLSearchParams({
      where: `in_bbox(geo_shape, ${minLat}, ${minLon}, ${maxLat}, ${maxLon}) and year=date'${IRIS_YEAR}'`,
      select: "iris_code,iris_name,geo_shape",
      limit: String(pageSize),
      offset: String(offset),
    });
    const response = await fetch(`${ODS_RECORDS_URL}?${params}`);
    if (!response.ok) {
      throw new Error(
        `IRIS geometry fetch failed (HTTP ${response.status}): ${await response.text()}`
      );
    }
    const data = await response.json();
    for (const rec of data.results) {
      collected.push({
        code: Array.isArray(rec.iris_code) ? rec.iris_code[0] : rec.iris_code,
        name: Array.isArray(rec.iris_name) ? rec.iris_name[0] : rec.iris_name,
        geometry: rec.geo_shape?.geometry ?? null,
      });
    }
    offset += pageSize;
    if (offset >= data.total_count) break;
  }
  return collected;
}

// =====================================================================
// BLOCK 2 — Local geometry helpers (no dependency)
// =====================================================================

// Ray-casting point-in-polygon for a single ring. Point/ring use [lng, lat].
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// A polygon = outer ring + optional holes; inside means within outer and not in a hole.
function pointInRings(point, rings) {
  if (!pointInRing(point, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing(point, rings[k])) return false;
  }
  return true;
}

function pointInPolygon(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return pointInRings(point, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) => pointInRings(point, poly));
  }
  return false;
}

// Outer-ring vertices of a polygon/multipolygon (used for the
// intersection proxy below).
function outerVertices(geometry) {
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((poly) => poly[0]);
  }
  return geometry.coordinates[0];
}

// Cheap, dependency-free intersection proxy: two polygons "intersect"
// if a vertex of one falls inside the other. This catches the case
// where an IRIS is larger than a small isochrone (no centroid inside),
// which a centroid-only test would miss.
function anyVertexInside(sourceGeometry, targetGeometry) {
  return outerVertices(sourceGeometry).some((v) =>
    pointInPolygon(v, targetGeometry)
  );
}

function polygonsIntersect(a, b) {
  return anyVertexInside(a, b) || anyVertexInside(b, a);
}

function bboxOf(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scan = (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  };
  if (geometry.type === "Polygon") geometry.coordinates.forEach(scan);
  else if (geometry.type === "MultiPolygon")
    geometry.coordinates.forEach((poly) => poly.forEach(scan));
  return { minLon: minX, minLat: minY, maxLon: maxX, maxLat: maxY };
}

// =====================================================================
// BLOCK 3 — Find the IRIS that contains the address
// =====================================================================

async function findIrisForPoint(latitude, longitude) {
  // ~1.1 km margin around the point is plenty to capture its IRIS.
  const margin = 0.012;
  const candidates = await fetchIrisInBbox({
    minLat: latitude - margin,
    minLon: longitude - margin,
    maxLat: latitude + margin,
    maxLon: longitude + margin,
  });
  const containing = candidates.find((iris) =>
    pointInPolygon([longitude, latitude], iris.geometry)
  );
  return containing ? { code: containing.code, name: containing.name } : null;
}

// =====================================================================
// BLOCK 4 — Find the IRIS inside an isochrone polygon
// =====================================================================
// MVP rule: an IRIS belongs to the isochrone if the two polygons
// intersect. Note: an IRIS is counted whole even if only partly inside
// the isochrone (IRIS are the finest available unit, ~2000 inhabitants).

async function findIrisInPolygon(isochroneGeometry) {
  const candidates = await fetchIrisInBbox(bboxOf(isochroneGeometry));
  const inside = candidates.filter((iris) =>
    iris.geometry ? polygonsIntersect(iris.geometry, isochroneGeometry) : false
  );
  return inside.map((iris) => iris.code);
}

// =====================================================================
// BLOCK 4b — Surfacic weight of an IRIS inside an isochrone
// =====================================================================
// Deterministic grid sampling: over the IRIS bounding box, a regular grid of
// cell centers; weight = (cells inside IRIS AND isochrone) / (cells inside
// IRIS). Robust to non-convex isochrones, reuses pointInPolygon, no dependency,
// reproducible. Fixes the whole-IRIS over-count on small communes.
function irisAreaWeight(irisGeometry, isochroneGeometry, gridN = 48) {
  if (!irisGeometry) return 1; // no geometry -> fall back to whole count
  const { minLon, minLat, maxLon, maxLat } = bboxOf(irisGeometry);
  const stepX = (maxLon - minLon) / gridN;
  const stepY = (maxLat - minLat) / gridN;
  if (stepX === 0 || stepY === 0) return 1;

  let inIris = 0;
  let inBoth = 0;
  for (let i = 0; i < gridN; i++) {
    const x = minLon + (i + 0.5) * stepX;
    for (let j = 0; j < gridN; j++) {
      const y = minLat + (j + 0.5) * stepY;
      if (!pointInPolygon([x, y], irisGeometry)) continue;
      inIris++;
      if (pointInPolygon([x, y], isochroneGeometry)) inBoth++;
    }
  }
  return inIris === 0 ? 0 : inBoth / inIris;
}

// Returns [{ code, name, weight }] for every IRIS with a non-zero area share
// inside the isochrone. Weight in (0, 1]. Demographics multiplies each IRIS's
// counts by its weight instead of counting it whole.
async function findIrisWeightsInPolygon(isochroneGeometry, { gridN = 48 } = {}) {
  const candidates = await fetchIrisInBbox(bboxOf(isochroneGeometry));
  const out = [];
  for (const iris of candidates) {
    if (!iris.geometry) continue;
    const weight = irisAreaWeight(iris.geometry, isochroneGeometry, gridN);
    if (weight > 0) out.push({ code: iris.code, name: iris.name, weight: Number(weight.toFixed(4)) });
  }
  return out;
}

// =====================================================================
// BLOCK 5 — Run directly: full step 1 + 4 + 5 integration on Bordeaux
// =====================================================================

if (require.main === module) {
  const { geocodeAddress } = require("./competitor-search");
  const { getIsochrones } = require("./isochrones");
  const { loadIrisData, aggregateDemographics } = require("./demographics");

  const order = { address: "65 Rue Judaïque, 33000 Bordeaux, France" };

  (async () => {
    const location = await geocodeAddress(order.address);
    const isochrones = await getIsochrones(location.latitude, location.longitude);

    const addressIris = await findIrisForPoint(location.latitude, location.longitude);
    const iris5 = await findIrisInPolygon(isochrones.rings.walk5min.geometry);
    const iris10 = await findIrisInPolygon(isochrones.rings.walk10min.geometry);

    const data = loadIrisData();

    console.log("Address IRIS:", addressIris);
    console.log(`\n5 min walk — ${iris5.length} IRIS`);
    console.log(JSON.stringify(aggregateDemographics(iris5, data), null, 2));
    console.log(`\n10 min walk — ${iris10.length} IRIS`);
    const agg10 = aggregateDemographics(iris10, data);
    console.log(
      `population ${agg10.population.total} | owners ${Math.round(agg10.housing.ownerShare * 100)}% | median income ${agg10.income.medianEuros}€ | quality ${agg10.quality}`
    );
  })().catch((error) => {
    console.error("ERROR:", error.message);
    process.exit(1);
  });
}

module.exports = { findIrisForPoint, findIrisInPolygon, findIrisWeightsInPolygon, irisAreaWeight, fetchIrisInBbox };
