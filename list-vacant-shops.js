/**
 * SIDE TOOL — Vacant shops list (not part of the report)
 * ------------------------------------------------------
 * Lists OSM "shop=vacant" premises around the address with their address
 * (when tagged) and coordinates, and writes a CSV into the report folder
 * under output/ for manual review. This data is NOT shown in the PDF.
 *
 * Run with:  node list-vacant-shops.js
 */

require("./load-env");

const fs = require("node:fs");
const path = require("node:path");

const { geocodeAddress } = require("./competitor-search");
const { queryOverpass } = require("./commercial-density");
const { reportFolderName } = require("./static-maps");

const OUTPUT_DIR = path.join(__dirname, "output");
const RADIUS_METERS = 1000;

// Builds a readable address from OSM addr:* tags (often partial or absent).
function addressFromTags(tags) {
  const line = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const city = [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ");
  return [line, city].filter(Boolean).join(", ").trim();
}

async function listVacantShops(address) {
  const loc = await geocodeAddress(address);
  const query = `
    [out:json][timeout:30];
    nwr(around:${RADIUS_METERS},${loc.latitude},${loc.longitude})[shop=vacant];
    out tags center;
  `;
  const data = await queryOverpass(query);

  return data.elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat === undefined || lon === undefined) return null;
      const tags = el.tags ?? {};
      return {
        name: tags.name ?? "",
        address: addressFromTags(tags),
        lat,
        lon,
      };
    })
    .filter(Boolean);
}

if (require.main === module) {
  const address = "65 Rue Judaïque, 33000 Bordeaux, France";

  (async () => {
    const rows = await listVacantShops(address);

    // Write into the same per-report folder as the maps.
    const folder = reportFolderName(address);
    const dir = path.join(OUTPUT_DIR, folder);
    fs.mkdirSync(dir, { recursive: true });

    // ";" separator + UTF-8 BOM so French Excel opens accents correctly.
    const header = "nom;adresse;latitude;longitude";
    const lines = rows.map((r) => `${r.name};${r.address};${r.lat};${r.lon}`);
    const csv = "﻿" + [header, ...lines].join("\n");
    const filePath = path.join(dir, "vacant-shops.csv");
    fs.writeFileSync(filePath, csv);

    console.log(`${rows.length} locaux vacants (shop=vacant) dans un rayon de ${RADIUS_METERS} m`);
    console.log("Fichier CSV :", filePath);
    console.log("\nAperçu :");
    for (const r of rows.slice(0, 10)) {
      console.log(`  - ${r.address || "(adresse non taguée)"}${r.name ? ` — ${r.name}` : ""}`);
    }
  })().catch((error) => {
    console.error("ERROR:", error.message);
    process.exit(1);
  });
}

module.exports = { listVacantShops };
