/**
 * Sector benchmarks for the P5 "sector adequacy" LLM task (brief §6 Task 3).
 *
 * STATUS is now per sector (see `validationStatus`):
 *   - boulangerie, restauration, coiffure — SOURCED (task H, first batch):
 *     per-establishment annual revenue grounded in named public sources.
 *   - the 7 others — still PROPOSED, to be sourced in a later batch.
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
    seasonality: "Fort pic lors des fêtes de fin d'année.",
    validationStatus: "proposition — à valider",
  },
  caviste: {
    nafCode: "47.25Z",
    fluxAdequacy:
      "Peu dépendant du flux brut ; clientèle ciblée qui se déplace. Pouvoir d'achat et profil CSP+ déterminants.",
    targetProfile:
      "Amateurs et CSP+, propriétaires, pouvoir d'achat supérieur à la moyenne.",
    revenueAnnualEuros: { min: 200000, max: 500000 },
    seasonality: "Fort pic fêtes de fin d'année.",
    validationStatus: "proposition — à valider",
  },
  pressing: {
    nafCode: "96.01B",
    fluxAdequacy:
      "Service de proximité : un flux moyen et une bonne densité résidentielle/de bureaux à proximité suffisent.",
    targetProfile:
      "Actifs, cadres, ménages avec pouvoir d'achat moyen à supérieur ; clientèle de proximité.",
    revenueAnnualEuros: { min: 80000, max: 180000 },
    seasonality: "Pic automne/hiver (vêtements lourds).",
    validationStatus: "proposition — à valider",
  },
  laverie: {
    nafCode: "96.01B",
    fluxAdequacy:
      "Laverie libre-service : dépend surtout de la densité résidentielle de proximité (immeubles, petits logements, étudiants). Un flux de passage moyen suffit ; la clientèle est locale et récurrente.",
    targetProfile:
      "Clientèle de proximité sans équipement lave-linge : locataires, étudiants, petits logements ; pouvoir d'achat moyen.",
    revenueAnnualEuros: { min: 40000, max: 120000 },
    seasonality: "Faible saisonnalité ; léger pic automne/hiver.",
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
