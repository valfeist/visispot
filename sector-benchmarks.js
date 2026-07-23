/**
 * Sector benchmarks for the P5 "sector adequacy" LLM task (brief §6 Task 3).
 *
 * STATUS is now per sector (see `validationStatus`):
 *   - SOURCED (per-establishment revenue grounded in named public sources):
 *     boulangerie, restauration, coiffure (batch 1) ; caviste, epicerie_fine,
 *     pressing, laverie (batch 2). Pressing relies on a dated FCGA 2016 figure.
 *   - still PROPOSED — no credible per-establishment source found yet:
 *     snacking, beaute (branch reports exist but publish no per-unit CA),
 *     retouche (too small/artisanal to source reliably).
 *
 * Revenue model (task H): we present a per-establishment annual revenue band,
 * grounded in public sector references (FCGA, Cerfrance, INSEE, branch
 * observatories). We deliberately DROPPED the old surface × CA/m² derivation:
 * CA/m² is not published in a harmonised way, and multiplying a 3× per-m² band
 * by the surface produced a near-useless spread. Surface is now only a
 * qualitative modulator (small surface -> lower end of the band, and vice
 * versa), handled in the P5 prompt.
 *
 * Versioned on purpose (brief: "à documenter et versionner").
 * Keys are the French form sector values.
 *
 * Fields per sector:
 *   nafCode             — INSEE NAF/APE subclass, sourcing anchor
 *   fluxAdequacy        — qualitative: what foot-traffic level is generally enough
 *   targetProfile       — typical target demographic for the sector
 *   revenueAnnualEuros  — per-establishment annual revenue band {min,max}
 *   revenueAvgEuros     — sector average per establishment (sourced sectors only)
 *   revenueSource       — named source + year (sourced sectors only)
 *   seasonality         — qualitative seasonal pattern
 *   validationStatus    — "sourcé (…)" once reviewed, else "proposition — à valider"
 */

const BENCHMARK_DISCLAIMER =
  "Benchmarks issus de données sectorielles publiques — indicatif, à affiner avec votre expert-comptable selon votre concept spécifique.";

const SECTOR_BENCHMARKS = {
  boulangerie: {
    nafCode: "10.71C",
    fluxAdequacy:
      "Un flux de rue moyen à élevé en semaine, avec passage piéton régulier le matin et en fin de journée, est généralement suffisant. La clientèle est surtout locale et récurrente, peu dépendante d'un flux touristique.",
    targetProfile:
      "Résidents du quartier, familles et actifs de passage. Forte sensibilité à la densité résidentielle de proximité.",
    revenueAnnualEuros: { min: 250000, max: 500000 },
    revenueAvgEuros: 358000,
    revenueSource:
      "Cerfrance, chiffres clés boulangeries-pâtisseries 2023-2024 (CA HT moyen 2022 ≈ 358 500 €) ; Observatoire FIDUCIAL.",
    seasonality:
      "Faible saisonnalité ; léger creux estival possible en zone de bureaux.",
    validationStatus: "sourcé (Cerfrance 2022)",
  },
  restauration: {
    nafCode: "56.10A",
    fluxAdequacy:
      "Le flux du midi en semaine est déterminant (zone de bureaux ou de passage). Un flux moyen à élevé sur la pause déjeuner, complété par le soir, est important.",
    targetProfile:
      "Actifs et cadres en semaine le midi, familles et clientèle de loisir le soir et le week-end.",
    revenueAnnualEuros: { min: 200000, max: 550000 },
    revenueAvgEuros: 475000,
    revenueSource:
      "Restauration traditionnelle (NAF 56.10A), données sectorielles 2023 (CA moyen ≈ 475 000 €/établissement) ; INSEE indice de CA.",
    seasonality:
      "Variations selon la saison et la fréquentation touristique de la zone.",
    validationStatus: "sourcé (2023)",
  },
  snacking: {
    nafCode: "56.10C",
    fluxAdequacy:
      "Très dépendant du flux piéton de la pause déjeuner et de la clientèle de passage. Un flux élevé en journée est nécessaire.",
    targetProfile:
      "Actifs pressés, étudiants, clientèle de passage cherchant rapidité et prix.",
    revenueAnnualEuros: { min: 150000, max: 350000 },
    seasonality: "Creux estival marqué en zone de bureaux.",
    validationStatus: "proposition — à valider",
  },
  coiffure: {
    nafCode: "96.02A",
    fluxAdequacy:
      "Moins dépendant du flux piéton brut : la clientèle se déplace et prend rendez-vous. La concurrence directe et le profil démographique local priment sur le flux.",
    targetProfile:
      "Résidents réguliers, mixité d'âges ; sensibilité au pouvoir d'achat local.",
    revenueAnnualEuros: { min: 75000, max: 130000 },
    revenueAvgEuros: 80000,
    revenueSource:
      "FCGA 2022 (entreprise individuelle ≈ 80 120 €) ; base Diane/comptes déposés NAF 96.02A (≈ 127 210 €) ; UNEC, rapport de branche coiffure.",
    seasonality: "Pics avant les fêtes et à la rentrée.",
    validationStatus: "sourcé (FCGA/UNEC 2022)",
  },
  beaute: {
    nafCode: "96.02B",
    fluxAdequacy:
      "Clientèle sur rendez-vous, peu dépendante du flux de passage. Profil démographique et pouvoir d'achat déterminants.",
    targetProfile:
      "Clientèle féminine majoritaire, actifs et CSP+, sensibilité au revenu local.",
    revenueAnnualEuros: { min: 70000, max: 160000 },
    seasonality: "Pics avant les fêtes et la période estivale.",
    validationStatus: "proposition — à valider",
  },
  epicerie_fine: {
    nafCode: "47.29Z",
    fluxAdequacy:
      "Flux moyen suffisant si le quartier a un bon pouvoir d'achat. Achat plaisir/qualité plus que de passage.",
    targetProfile:
      "CSP+, amateurs de produits de qualité, pouvoir d'achat supérieur à la moyenne.",
    revenueAnnualEuros: { min: 150000, max: 400000 },
    revenueAvgEuros: 300000,
    revenueSource:
      "Filière épicerie fine (Xerfi ; Salon Gourmet Selection) : indépendants ≈ 3 Md€ de CA en 2023, soit ≈ 300 000 €/magasin.",
    seasonality: "Fort pic lors des fêtes de fin d'année.",
    validationStatus: "sourcé (filière 2023)",
  },
  caviste: {
    nafCode: "47.25Z",
    fluxAdequacy:
      "Peu dépendant du flux brut ; clientèle ciblée qui se déplace. Pouvoir d'achat et profil CSP+ déterminants.",
    targetProfile:
      "Amateurs et CSP+, propriétaires, pouvoir d'achat supérieur à la moyenne.",
    revenueAnnualEuros: { min: 200000, max: 500000 },
    revenueAvgEuros: 370000,
    revenueSource:
      "Études de marché du secteur caviste (Made in FR ; EPSIMAS ; La Référence Franchise) : CA moyen ≈ 370 000 €/magasin (tendance récente).",
    seasonality: "Fort pic fêtes de fin d'année.",
    validationStatus: "sourcé (études marché 2023)",
  },
  pressing: {
    nafCode: "96.01B",
    fluxAdequacy:
      "Service de proximité : un flux moyen et une bonne densité résidentielle/de bureaux à proximité suffisent.",
    targetProfile:
      "Actifs, cadres, ménages avec pouvoir d'achat moyen à supérieur ; clientèle de proximité.",
    revenueAnnualEuros: { min: 70000, max: 180000 },
    revenueAvgEuros: 81000,
    revenueSource:
      "FCGA (millésime 2016) : CA moyen pressing/teinturerie ≈ 81 000 €, résultat courant ≈ 15 000 €. Donnée datée, à réactualiser.",
    seasonality: "Pic automne/hiver (vêtements lourds).",
    validationStatus: "sourcé (FCGA 2016 — daté)",
  },
  laverie: {
    nafCode: "96.01B",
    fluxAdequacy:
      "Laverie libre-service : dépend surtout de la densité résidentielle de proximité (immeubles, petits logements, étudiants). Un flux de passage moyen suffit ; la clientèle est locale et récurrente.",
    targetProfile:
      "Clientèle de proximité sans équipement lave-linge : locataires, étudiants, petits logements ; pouvoir d'achat moyen.",
    revenueAnnualEuros: { min: 25000, max: 120000 },
    revenueAvgEuros: 45000,
    revenueSource:
      "Marché ≈ 200 M€ pour ≈ 4 500 laveries (≈ 44 000 €/établissement) ; franchises libre-service (Wash'N Dry ≈ 25 000–100 000 € après 2 ans).",
    seasonality: "Faible saisonnalité ; léger pic automne/hiver.",
    validationStatus: "sourcé (marché 2023)",
  },
  // --- Taxonomy extension: sourcing not started, all "proposition" ---------------
  cafe: {
    nafCode: "56.30Z",
    fluxAdequacy:
      "Très dépendant du flux piéton de passage et de la présence de bureaux, commerces ou lieux de vie à proximité. Un flux moyen à élevé en journée est important.",
    targetProfile:
      "Actifs en pause, étudiants, clientèle de passage et habitués du quartier ; mixité d'âges.",
    revenueAnnualEuros: { min: 100000, max: 300000 },
    seasonality: "Pic en terrasse aux beaux jours ; creux estival en zone de bureaux.",
    validationStatus: "proposition — à valider",
  },
  boucherie: {
    nafCode: "47.22Z",
    fluxAdequacy:
      "Commerce de proximité : la densité résidentielle proche prime sur le flux de passage. La clientèle est locale et récurrente.",
    targetProfile:
      "Résidents du quartier, familles, clientèle attachée au produit et au conseil ; pouvoir d'achat moyen à supérieur.",
    revenueAnnualEuros: { min: 200000, max: 450000 },
    seasonality: "Pic fêtes de fin d'année ; hausse à la saison des grillades.",
    validationStatus: "proposition — à valider",
  },
  poissonnerie: {
    nafCode: "47.23Z",
    fluxAdequacy:
      "Clientèle qui se déplace pour le produit ; la densité résidentielle et la présence d'un marché comptent plus que le flux brut.",
    targetProfile:
      "Résidents, clientèle CSP+ sensible à la fraîcheur et au conseil ; pouvoir d'achat supérieur à la moyenne.",
    revenueAnnualEuros: { min: 150000, max: 400000 },
    seasonality: "Fort pic fêtes de fin d'année et périodes de carême.",
    validationStatus: "proposition — à valider",
  },
  primeur: {
    nafCode: "47.21Z",
    fluxAdequacy:
      "Achat de proximité et fréquent : la densité résidentielle immédiate prime. Un flux de passage moyen suffit.",
    targetProfile:
      "Résidents du quartier, familles, clientèle sensible au frais et au local ; pouvoir d'achat moyen.",
    revenueAnnualEuros: { min: 120000, max: 350000 },
    seasonality: "Variations selon les saisons de production ; creux hivernal léger.",
    validationStatus: "proposition — à valider",
  },
  fromagerie: {
    nafCode: "47.29Z",
    fluxAdequacy:
      "Achat plaisir/qualité : le pouvoir d'achat du quartier prime sur le flux de passage. Clientèle qui se déplace.",
    targetProfile:
      "CSP+, amateurs de produits de qualité et de conseil ; pouvoir d'achat supérieur à la moyenne.",
    revenueAnnualEuros: { min: 150000, max: 400000 },
    seasonality: "Fort pic fêtes de fin d'année ; hausse à la saison des plats fromagers.",
    validationStatus: "proposition — à valider",
  },
  cordonnerie: {
    nafCode: "95.23Z",
    fluxAdequacy:
      "Service de proximité, peu dépendant du flux brut. La densité résidentielle et de bureaux, ainsi que la proximité de commerces d'habillement/chaussures, comptent davantage.",
    targetProfile:
      "Clientèle de proximité, actifs et ménages tous profils ; souvent combiné à la reproduction de clés et au multiservice.",
    revenueAnnualEuros: { min: 40000, max: 110000 },
    seasonality: "Hausse à l'automne (remise en état) et aux changements de saison.",
    validationStatus: "proposition — à valider",
  },
  fleuriste: {
    nafCode: "47.76Z",
    fluxAdequacy:
      "Sensible au flux de passage et à la visibilité de la devanture (achat d'impulsion), complété par une clientèle d'habitués et les commandes.",
    targetProfile:
      "Résidents et actifs, clientèle événementielle (fêtes, cérémonies) ; pouvoir d'achat moyen à supérieur.",
    revenueAnnualEuros: { min: 80000, max: 250000 },
    seasonality: "Pics très marqués : fête des Mères, Saint-Valentin, Toussaint, fin d'année.",
    validationStatus: "proposition — à valider",
  },

  retouche: {
    nafCode: "95.29Z",
    fluxAdequacy:
      "Atelier de retouche/couture : service de proximité, peu dépendant du flux brut. La densité résidentielle et la présence de commerces d'habillement à proximité comptent davantage.",
    targetProfile:
      "Clientèle de proximité, tous profils ; ménages avec pouvoir d'achat moyen à supérieur.",
    revenueAnnualEuros: { min: 50000, max: 130000 },
    seasonality: "Hausse à la rentrée et avant les fêtes ; pic changements de saison.",
    validationStatus: "proposition — à valider",
  },
};

module.exports = { SECTOR_BENCHMARKS, BENCHMARK_DISCLAIMER };
