/**
 * PIPELINE — Street context (OpenStreetMap / Overpass) for report P2.
 * ------------------------------------------------------------------
 * From the address coordinates, derives: street type, nearby public
 * transport (300 m), parking (200 m) and a qualitative visibility note.
 *
 * One combined Overpass query (union) to limit round-trips / 504s; the
 * results are then split by tags + distance.
 *
 * Run with:  node street-context.js
 */

require("./load-env");

const { queryOverpass } = require("./commercial-density");

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

const coordsOf = (el) => ({ lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon });

// Map the surrounding highway tags to a street-type label.
// NB: "footway" is intentionally excluded — sidewalks exist at every address
// and would mislabel everything as pedestrian/commercial.
function mapStreetType(highwayValues) {
  const set = new Set(highwayValues);
  const has = (...keys) => keys.some((k) => set.has(k));
  if (has("pedestrian")) return "Rue commerçante / piétonne";
  if (has("primary", "secondary", "tertiary")) return "Axe de passage";
  if (has("residential", "living_street")) return "Rue résidentielle";
  return "Voie de desserte";
}

function transportType(tags) {
  if (tags.railway === "subway_entrance" || tags.subway === "yes" || tags.station === "subway") return "métro";
  if (tags.highway === "bus_stop") return "bus";
  if (tags.tram === "yes" || tags.station === "tram" || tags.light_rail === "yes") return "tram";
  if (tags.train === "yes" || tags.station === "train") return "train";
  return "station";
}

async function getStreetContext(latitude, longitude) {
  const q = `
    [out:json][timeout:30];
    (
      way[highway](around:50,${latitude},${longitude});
      node[public_transport=station](around:300,${latitude},${longitude});
      node[railway=subway_entrance](around:300,${latitude},${longitude});
      node[highway=bus_stop](around:300,${latitude},${longitude});
      node[amenity=parking](around:200,${latitude},${longitude});
      way[amenity=parking](around:200,${latitude},${longitude});
      node[highway](around:30,${latitude},${longitude});
    );
    out tags center;
  `;
  const data = await queryOverpass(q);
  const els = data.elements ?? [];

  // --- Street type: highway tags of nearby ways (excluding parking ways) ---
  const highwayValues = els
    .filter((e) => e.type === "way" && e.tags?.highway && e.tags.amenity !== "parking")
    .map((e) => e.tags.highway);
  const streetType = mapStreetType(highwayValues);

  // --- Transport (≤300 m), deduped by type+name, nearest first ---
  const transportSeen = new Set();
  const transports = els
    .filter((e) => {
      const t = e.tags ?? {};
      return t.railway === "subway_entrance" || t.highway === "bus_stop" || t.public_transport === "station";
    })
    .map((e) => {
      const { lat, lon } = coordsOf(e);
      const t = e.tags ?? {};
      return {
        name: t.name ?? "Arrêt sans nom",
        type: transportType(t),
        // Lines passing through, when tagged (route_ref = "4;15;16").
        lines: t.route_ref ? t.route_ref.replace(/;/g, ", ") : null,
        distanceMeters: Math.round(haversineMeters(latitude, longitude, lat, lon)),
        lat,
        lon,
      };
    })
    .filter((t) => t.lat !== undefined && t.distanceMeters <= 300)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .filter((t) => {
      const key = `${t.type}|${t.name}`;
      if (transportSeen.has(key)) return false;
      transportSeen.add(key);
      return true;
    })
    .slice(0, 6);

  // --- Parking (≤200 m) ---
  const parkingEls = els.filter((e) => e.tags?.amenity === "parking");
  const parking = {
    count: parkingEls.length,
    anyPaid: parkingEls.some((e) => e.tags?.fee === "yes"),
    items: parkingEls
      .map((e) => coordsOf(e))
      .filter((c) => c.lat !== undefined),
  };

  // --- Visibility: highway nodes within 30 m (intersections) ---
  const highwayNodes30 = els.filter(
    (e) => e.type === "node" && e.tags?.highway && haversineMeters(latitude, longitude, ...Object.values(coordsOf(e))) <= 30
  );
  let visibility;
  if (streetType === "Rue commerçante / piétonne") visibility = "Rue commerçante — forte visibilité";
  else if (highwayNodes30.length > 1) visibility = "Angle de rue — bonne visibilité";
  else visibility = "Visibilité standard";

  return { streetType, transports, parking, visibility };
}

if (require.main === module) {
  const { geocodeAddress } = require("./competitor-search");
  (async () => {
    const loc = await geocodeAddress("65 Rue Judaïque, 33000 Bordeaux, France");
    const ctx = await getStreetContext(loc.latitude, loc.longitude);
    console.log(JSON.stringify(ctx, null, 2));
  })().catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
}

module.exports = { getStreetContext };
