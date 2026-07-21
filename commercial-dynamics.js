/**
 * PIPELINE — Commercial dynamics signal (BODACC) for report P6.
 * ------------------------------------------------------------
 * Bulletin Officiel Des Annonces Civiles et Commerciales: business
 * openings (créations), closures (radiations) and collective proceedings
 * by postal code. A stronger dynamism signal than OSM vacancy.
 *
 * Best-effort: returns null on failure. NOTE: BODACC is filterable by
 * POSTAL CODE only — the signal is at the commune/postal-code scale
 * (e.g. 33000 = central Bordeaux), not the immediate street.
 *
 * Run with:  node commercial-dynamics.js
 */

const BODACC_URL =
  "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";

async function countBodacc(where) {
  const params = new URLSearchParams({ where, limit: "1" });
  const res = await fetch(`${BODACC_URL}?${params}`);
  if (!res.ok) throw new Error(`BODACC HTTP ${res.status}`);
  const data = await res.json();
  return data.total_count ?? 0;
}

async function getCommercialDynamics(postalCode, { months = 24 } = {}) {
  if (!postalCode) return null;
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceDate = since.toISOString().slice(0, 10);
  const base = `cp="${postalCode}" AND dateparution>="${sinceDate}"`;

  try {
    const [creations, radiations, proceduresCollectives] = await Promise.all([
      countBodacc(`${base} AND familleavis="creation"`),
      countBodacc(`${base} AND familleavis="radiation"`),
      countBodacc(`${base} AND familleavis_lib="Procédures collectives"`),
    ]);

    let trend = "stable";
    if (creations > radiations * 1.05) trend = "en amélioration";
    else if (creations < radiations * 0.95) trend = "en dégradation";

    return { postalCode, sinceDate, months, creations, radiations, proceduresCollectives, trend };
  } catch (error) {
    return null; // best-effort: BODACC unavailable
  }
}

if (require.main === module) {
  getCommercialDynamics("33000")
    .then((d) => console.log(JSON.stringify(d, null, 2)))
    .catch((e) => {
      console.error("ERROR:", e.message);
      process.exit(1);
    });
}

module.exports = { getCommercialDynamics };
