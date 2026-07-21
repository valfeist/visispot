/**
 * PIPELINE — Market reference (DVF) for report P6 rent section.
 * ------------------------------------------------------------
 * ⚠️ IMPORTANT: DVF (Demandes de Valeurs Foncières) is SALE prices, NOT
 * commercial rents. It therefore cannot provide a rental €/m²/an reference.
 * We attempt it best-effort to surface a commune-level commercial SALE
 * €/m² as labelled context; the rental comparison stays "non disponible"
 * (we never invent a rent figure). A real rental source (e.g. SeLoger Pro)
 * would be a paid V1 add-on.
 *
 * Run with:  node market-reference.js
 */

async function getCommercialSaleReference(communeCode) {
  if (!communeCode) return { available: false, reason: "commune inconnue" };
  try {
    const res = await fetch(`https://api.dvf.etalab.gouv.fr/mutations?code_commune=${communeCode}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { available: false, reason: `DVF HTTP ${res.status}` };
    const data = await res.json();
    const mutations = Array.isArray(data) ? data : data.resultats ?? data.mutations ?? data.features ?? [];

    const pricesPerSqm = [];
    for (const raw of mutations) {
      const m = raw.properties ?? raw;
      const typeLocal = m.type_local || m.libtyploc || "";
      const valeur = Number(m.valeur_fonciere ?? m.valeurfonc);
      const surface = Number(m.surface_reelle_bati ?? m.sbati);
      if (/commercial|industriel/i.test(typeLocal) && valeur > 0 && surface > 0) {
        pricesPerSqm.push(valeur / surface);
      }
    }
    if (pricesPerSqm.length === 0) {
      return { available: false, reason: "aucune transaction de local commercial" };
    }
    pricesPerSqm.sort((a, b) => a - b);
    return {
      available: true,
      medianSalePricePerSqm: Math.round(pricesPerSqm[Math.floor(pricesPerSqm.length / 2)]),
      sampleSize: pricesPerSqm.length,
      source: "DVF (prix de vente, pas un loyer)",
    };
  } catch (error) {
    return { available: false, reason: "DVF indisponible" };
  }
}

if (require.main === module) {
  getCommercialSaleReference("33063")
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error("ERROR:", e.message);
      process.exit(1);
    });
}

module.exports = { getCommercialSaleReference };
