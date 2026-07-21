/**
 * Per-market configuration.
 * Selected at startup from the order form "market" field (default "FR").
 *
 * Only FR and ES are active for now. Other markets are left as
 * commented placeholders, to be filled in at each future launch.
 *
 * Note: out_of_coverage_message values are client-facing strings, so
 * they stay in the market's own language (domain data, not code).
 */

// i18n strings (UI labels, section titles, disclaimers)
// are handled separately in /i18n/{lang}.js
// See: https://docs.google.com/document/d/103Gx3i3Biu4En_6ZBfMZzSmnkTFYDBU8RRJgXAI-QgY/edit?usp=sharing

const MARKET_CONFIG = {
  FR: {
    language: "fr",
    currency: "EUR",
    min_population: 20000,
    demographic_source: "insee_iris", // local CSV
    demographic_unit: "IRIS",
    out_of_coverage_message:
      "Cette adresse est hors de notre zone de couverture actuelle. Nous couvrons les communes de plus de 20 000 habitants en France métropolitaine.",
  },
  ES: {
    language: "es",
    currency: "EUR",
    min_population: 50000,
    demographic_source: "ine_seccion", // REST API
    demographic_unit: "seccion_censal",
    out_of_coverage_message:
      "Esta dirección está fuera de nuestra zona de cobertura actual. Cubrimos los municipios de más de 50 000 habitantes.",
  },

  // --- Future markets — fill in at each launch (structure to mirror FR/ES) ---
  // NL: { language: "nl", currency: "EUR", min_population: ?, demographic_source: "cbs_buurt", demographic_unit: "buurt", out_of_coverage_message: "..." },
  // BE: { language: "nl", currency: "EUR", min_population: ?, demographic_source: "statbel_secteur", demographic_unit: "secteur_statistique", out_of_coverage_message: "..." },
  // DE: { language: "de", currency: "EUR", min_population: ?, demographic_source: "zensus_gitter", demographic_unit: "gitterzelle", out_of_coverage_message: "..." },
  // SE: { language: "sv", currency: "SEK", min_population: ?, demographic_source: "scb_deso", demographic_unit: "DeSO", out_of_coverage_message: "..." },
};

module.exports = { MARKET_CONFIG };
