/**
 * Sector benchmarks for the P5 "sector adequacy" LLM task (brief §6 Task 3).
 *
 * ⚠️ STATUS: PROPOSED — TO BE VALIDATED.
 * These are indicative orders of magnitude assembled from PUBLIC sector
 * references (professional federations, observatories, specialised press).
 * Per-establishment annual revenue is grounded in public figures; the
 * per-m²/year band is an INDICATIVE derivation (CA/m² is not published in a
 * harmonised way). Every figure must be reviewed/sourced before production.
 *
 * Versioned on purpose (brief: "à documenter et versionner").
 * Keys are the French form sector values.
 *
 * Fields per sector:
 *   fluxAdequacy        — qualitative: what foot-traffic level is generally enough
 *   targetProfile       — typical target demographic for the sector
 *   revenueAnnualEuros  — indicative annual revenue per establishment {min,max}
 *   revenuePerSqmYear   — INDICATIVE revenue per m²/year {min,max} (derived)
 *   seasonality         — qualitative seasonal pattern
 *   sources             — public source note
 *   validationStatus    — always "proposition — à valider" until reviewed
 */

const BENCHMARK_DISCLAIMER =
  "Benchmarks issus de données sectorielles publiques — indicatif, à affiner avec votre expert-comptable selon votre concept spécifique.";

const SECTOR_BENCHMARKS = {
  boulangerie: {
    fluxAdequacy:
      "Un flux de rue moyen à élevé en semaine, avec passage piéton régulier le matin et en fin de journée, est généralement suffisant. La clientèle est surtout locale et récurrente, peu dépendante d'un flux touristique.",
    targetProfile:
      "Résidents du quartier, familles et actifs de passage. Forte sensibilité à la densité résidentielle de proximité.",
    revenueAnnualEuros: { min: 250000, max: 600000 },
    revenuePerSqmYear: { min: 4000, max: 12000 },
    seasonality:
      "Faible saisonnalité ; léger creux estival possible en zone de bureaux.",
    sources:
      "Confédération Nationale de la Boulangerie-Pâtisserie ; l-expert-comptable ; presse spécialisée.",
    validationStatus: "proposition — à valider",
  },
  restauration: {
    fluxAdequacy:
      "Le flux du midi en semaine est déterminant (zone de bureaux ou de passage). Un flux moyen à élevé sur la pause déjeuner, complété par le soir, est important.",
    targetProfile:
      "Actifs et cadres en semaine le midi, familles et clientèle de loisir le soir et le week-end.",
    revenueAnnualEuros: { min: 200000, max: 450000 },
    revenuePerSqmYear: { min: 3000, max: 8000 },
    seasonality:
      "Variations selon la saison et la fréquentation touristique de la zone.",
    sources: "INSEE (indice CA restauration) ; CCI Paris Île-de-France.",
    validationStatus: "proposition — à valider",
  },
  snacking: {
    fluxAdequacy:
      "Très dépendant du flux piéton de la pause déjeuner et de la clientèle de passage. Un flux élevé en journée est nécessaire.",
    targetProfile:
      "Actifs pressés, étudiants, clientèle de passage cherchant rapidité et prix.",
    revenueAnnualEuros: { min: 150000, max: 350000 },
    revenuePerSqmYear: { min: 4000, max: 10000 },
    seasonality: "Creux estival marqué en zone de bureaux.",
    sources: "Observatoires de la restauration rapide ; presse spécialisée snacking.",
    validationStatus: "proposition — à valider",
  },
  coiffure: {
    fluxAdequacy:
      "Moins dépendant du flux piéton brut : la clientèle se déplace et prend rendez-vous. La concurrence directe et le profil démographique local priment sur le flux.",
    targetProfile:
      "Résidents réguliers, mixité d'âges ; sensibilité au pouvoir d'achat local.",
    revenueAnnualEuros: { min: 60000, max: 150000 },
    revenuePerSqmYear: { min: 1500, max: 4000 },
    seasonality: "Pics avant les fêtes et à la rentrée.",
    sources: "Observatoire FIDUCIAL de la coiffure ; UNEC.",
    validationStatus: "proposition — à valider",
  },
  beaute: {
    fluxAdequacy:
      "Clientèle sur rendez-vous, peu dépendante du flux de passage. Profil démographique et pouvoir d'achat déterminants.",
    targetProfile:
      "Clientèle féminine majoritaire, actifs et CSP+, sensibilité au revenu local.",
    revenueAnnualEuros: { min: 70000, max: 160000 },
    revenuePerSqmYear: { min: 1500, max: 4000 },
    seasonality: "Pics avant les fêtes et la période estivale.",
    sources: "Observatoire FIDUCIAL coiffure-esthétique ; fédérations beauté.",
    validationStatus: "proposition — à valider",
  },
  epicerie_fine: {
    fluxAdequacy:
      "Flux moyen suffisant si le quartier a un bon pouvoir d'achat. Achat plaisir/qualité plus que de passage.",
    targetProfile:
      "CSP+, amateurs de produits de qualité, pouvoir d'achat supérieur à la moyenne.",
    revenueAnnualEuros: { min: 150000, max: 400000 },
    revenuePerSqmYear: { min: 3000, max: 8000 },
    seasonality: "Fort pic lors des fêtes de fin d'année.",
    sources: "Fédérations du commerce alimentaire spécialisé ; observatoires.",
    validationStatus: "proposition — à valider",
  },
  caviste: {
    fluxAdequacy:
      "Peu dépendant du flux brut ; clientèle ciblée qui se déplace. Pouvoir d'achat et profil CSP+ déterminants.",
    targetProfile:
      "Amateurs et CSP+, propriétaires, pouvoir d'achat supérieur à la moyenne.",
    revenueAnnualEuros: { min: 200000, max: 500000 },
    revenuePerSqmYear: { min: 4000, max: 10000 },
    seasonality: "Fort pic fêtes de fin d'année.",
    sources: "Fédération des cavistes indépendants ; observatoires du commerce.",
    validationStatus: "proposition — à valider",
  },
  pressing: {
    fluxAdequacy:
      "Service de proximité : un flux moyen et une bonne densité résidentielle/de bureaux à proximité suffisent.",
    targetProfile:
      "Actifs, cadres, ménages avec pouvoir d'achat moyen à supérieur ; clientèle de proximité.",
    revenueAnnualEuros: { min: 80000, max: 180000 },
    revenuePerSqmYear: { min: 2000, max: 5000 },
    seasonality: "Pic automne/hiver (vêtements lourds).",
    sources: "Fédération française des pressings et blanchisseries.",
    validationStatus: "proposition — à valider",
  },
  services_personne: {
    fluxAdequacy:
      "Service de proximité (cordonnerie, retouches) : flux moyen et passage régulier suffisent ; dépend de la densité locale.",
    targetProfile:
      "Clientèle de proximité, tous profils, ménages avec pouvoir d'achat moyen.",
    revenueAnnualEuros: { min: 50000, max: 130000 },
    revenuePerSqmYear: { min: 1500, max: 4000 },
    seasonality: "Légère hausse à la rentrée et avant les fêtes.",
    sources: "Fédérations de l'artisanat de services ; observatoires.",
    validationStatus: "proposition — à valider",
  },
};

module.exports = { SECTOR_BENCHMARKS, BENCHMARK_DISCLAIMER };
