/**
 * PIPELINE STEP 10 — LLM synthesis (Claude)
 * -----------------------------------------
 * Produces the interpreted, non-expert report texts. Four distinct tasks
 * (brief §6); this file is built up task by task.
 *   - Task 2 (P4): competitive synthesis            [implemented]
 *   - Task 3 (P5): sector adequacy                  [todo]
 *   - Task 4 (P6): risk signals & recommendations   [todo]
 *   - Task 1 (P1): score & verdict                  [todo — built last]
 *
 * Data source: Anthropic Messages API (raw fetch, no SDK).
 * Requires ANTHROPIC_API_KEY. Model per brief: Claude Sonnet.
 *
 * Run with:  node llm-synthesis.js
 */

require("./load-env");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = "claude-sonnet-4-6"; // per brief (cost-calibrated on Sonnet)

// =====================================================================
// BLOCK 1 — Shared Claude caller (raw HTTP)
// =====================================================================

// When `outputSchema` is provided, the response is constrained to JSON
// matching that schema and returned parsed in `.json`; otherwise `.text`.
async function callClaude({ system, user, maxTokens = 1024, outputSchema = null }) {
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (outputSchema) {
    body.output_config = { format: { type: "json_schema", schema: outputSchema } };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Claude API failed (HTTP ${response.status}): ${JSON.stringify(data)}`
    );
  }

  const text = (data.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (outputSchema) {
    return { json: JSON.parse(text), usage: data.usage };
  }
  return { text, usage: data.usage };
}

// =====================================================================
// BLOCK 2 — Task 2 (P4): competitive synthesis
// =====================================================================
// Non-negotiable rules from the brief (§4 P4, §6 Task 2, §9):
//   - one paragraph, plain language, zero analytical jargon
//   - factual, no dramatization / anxiety-inducing wording
//   - no invented numbers — only the figures provided may be used
//   - conclude: concurrence rédhibitoire / gérable / favorable
//   - if places signal is "partielle" (<3 direct competitors), open by
//     flagging that the analysis rests on limited data.

// Complementary commerce categories per sector (generate favourable footfall).
const COMPLEMENTARY_SECTORS = {
  boulangerie: ["pharmacie", "école", "bouche de métro", "bureau de poste", "marché"],
  restauration: ["bureau", "école", "salle de sport", "cinéma", "théâtre"],
  snacking: ["bureau", "école", "salle de sport", "cinéma", "théâtre"],
  coiffure: ["pharmacie", "institut de beauté", "centre commercial"],
  beaute: ["pharmacie", "institut de beauté", "centre commercial"],
  epicerie_fine: ["restaurant gastronomique", "caviste", "fromagerie", "marché"],
  caviste: ["restaurant gastronomique", "caviste", "fromagerie", "marché"],
  pressing: ["pressing", "teinturerie", "cordonnerie"],
  laverie: ["pressing", "teinturerie", "cordonnerie"],
  retouche: ["pressing", "teinturerie", "cordonnerie"],
};

const P4_SYSTEM_PROMPT = `Tu rédiges la "synthèse concurrentielle" (page 4) d'un rapport professionnel d'analyse d'emplacement commercial, destiné à un commerçant non-expert qui hésite à signer un bail.

RÈGLES NON NÉGOCIABLES :
- Français clair, sans aucun jargon analytique. Ton professionnel, direct, bienveillant, factuel, jamais anxiogène.
- N'invente AUCUN chiffre. Utilise uniquement les données fournies. Si une donnée manque, reste qualitatif.

Tu produis DEUX champs :
- "synthesis" : UN SEUL paragraphe (4 à 6 phrases). Distingue concurrents directs (indépendants du même secteur) et chaînes/franchises (même produit, modèle industriel) : leur impact diffère. Termine par une appréciation explicite du niveau de concurrence pour ce type de commerce : "rédhibitoire", "gérable" ou "favorable", avec une justification courte. Si l'analyse est partielle, ouvre en le signalant.
- "complementarities" : à partir des catégories de commerces fournies (densité OSM, rayon 500 m), identifie ceux qui sont COMPLÉMENTAIRES au secteur analysé — uniquement parmi la liste de complémentaires fournie pour ce secteur — et qui génèrent un trafic de passage favorable. Formule : "X établissements complémentaires identifiés dans un rayon de 500 m : [liste]. Ces commerces génèrent un trafic de passage favorable." Si AUCUN complémentaire n'est présent dans les données, renvoie une chaîne VIDE ("").`;

const P4_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    synthesis: { type: "string" },
    complementarities: { type: "string" },
  },
  required: ["synthesis", "complementarities"],
  additionalProperties: false,
};

async function competitiveSynthesis(input) {
  const partial = input.placesStatus === "partielle";
  const byCategory = input.commercialDensityByCategory ?? {};
  const categoryLines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${cat}: ${n}`)
    .join(", ");
  const complementaryList = COMPLEMENTARY_SECTORS[input.businessType] ?? [];

  const user = `Données pour la synthèse concurrentielle (page 4) :

Type de commerce analysé : ${input.businessType}
Analyse partielle (peu de données) : ${partial ? "OUI — à signaler en ouverture" : "non"}

Zone de chalandise (rayon ${input.catchmentArea.radiusMeters} m) :
- Concurrents directs (indépendants du même secteur) : ${input.catchmentArea.directCount}
- Chaînes / franchises du même secteur : ${input.catchmentArea.chainCount}
- Exemples de concurrents directs (nom · note Google) : ${formatExamples(input.catchmentArea.topDirect)}
- Chaînes présentes : ${input.catchmentArea.chains?.join(", ") || "aucune"}

Quartier élargi (rayon ${input.sectorProfile.radiusMeters} m) :
- Concurrents directs : ${input.sectorProfile.directCount}
- Chaînes / franchises : ${input.sectorProfile.chainCount}

Catégories de commerces présentes (rayon 500 m, source OpenStreetMap) : ${categoryLines || "aucune"}
Commerces complémentaires recherchés pour ce secteur : ${complementaryList.join(", ") || "aucun"}

Produis "synthesis" et "complementarities" en respectant strictement les règles.`;

  return callClaude({ system: P4_SYSTEM_PROMPT, user, maxTokens: 800, outputSchema: P4_OUTPUT_SCHEMA });
}

function formatExamples(list) {
  if (!list || list.length === 0) return "aucun";
  return list
    .map((c) => `${c.name}${c.googleRating ? ` (${c.googleRating}/5)` : ""}`)
    .join(", ");
}

// =====================================================================
// BLOCK 2b — Task 3 (P5): sector adequacy
// =====================================================================
// Crosses flux × demographics × specific business type against encoded
// sector benchmarks (brief §6 Task 3). Structured output for the report.

const { SECTOR_BENCHMARKS, BENCHMARK_DISCLAIMER } = require("./sector-benchmarks");

const P5_SYSTEM_PROMPT = `Tu rédiges la page "adéquation sectorielle" (page 5) d'un rapport professionnel d'analyse d'emplacement, pour un commerçant non-expert. C'est l'interprétation croisée flux × démographie × type de commerce.

RÈGLES NON NÉGOCIABLES :
- Français clair, zéro jargon analytique. Ton professionnel, direct, bienveillant.
- N'invente AUCUN chiffre. Utilise uniquement les données et les benchmarks fournis.

CHAMPS À PRODUIRE :
- "fluxAdequacy" : le flux estimé est-il suffisant pour ce secteur (vs le seuil fourni) ? Si le flux est indisponible/insuffisant, reste qualitatif et dis-le explicitement, sans inventer de niveau.
- "demographicAdequacy" : JUGE L'ALIGNEMENT entre le profil de zone et la clientèle cible de CE commerce. Ne REDÉCRIS PAS la zone (c'est le rôle de la page 3) et NE RÉPÈTE PAS les chiffres déjà présentés en page 3. Pars des chiffres pour aller vers l'interprétation sectorielle. Exemple : la page 3 décrit ("profil résidentiel stable, revenus supérieurs à la moyenne"), la page 5 interprète ("ce profil est aligné avec la clientèle cible d'une boulangerie artisanale — revenus disponibles, sensibilité au produit local, fréquence d'achat quotidienne").
- "revenueRange" : présente la FOURCHETTE DE CA ANNUEL PAR ÉTABLISSEMENT fournie dans les benchmarks (min–max, et la moyenne du secteur si elle est donnée), en une phrase. Précise explicitement que c'est une RÉFÉRENCE SECTORIELLE par établissement, PAS une projection pour ce local précis. Si une surface est fournie, tu peux nuancer QUALITATIVEMENT (une petite surface tire plutôt vers le bas de la fourchette, une grande vers le haut) SANS recalculer ni inventer de chiffre. Si une source t'est donnée, cite-la brièvement (ex. "source : FCGA/Cerfrance"). Si la fourchette est marquée comme non encore sourcée, dis qu'elle est indicative et à confirmer. Termine par : "Indicatif — dépend du concept, du positionnement et de l'exécution."
- "seasonality" : variations saisonnières si pertinentes pour le secteur.
- "verdict" : EXACTEMENT "Aligné", "Partiellement aligné" ou "Inadapté".
- "justification" : 2-3 phrases. SI le verdict de la page 1 fourni est "NON VIABLE" ET que ton "verdict" d'adéquation est "Aligné", tu DOIS ouvrir la justification par exactement cette phrase de liaison, en adaptant {motif} au signal dominant fourni : "Le profil démographique de la zone est aligné avec ce type de commerce. C'est {motif} — et non le profil de zone — qui conduit au verdict NON VIABLE de la page 1." où {motif} vaut "la saturation concurrentielle" (si concurrence Dense), "les signaux de risque" (si plusieurs risques) ou "le flux insuffisant" (si flux Faible/indisponible).`;

const P5_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    fluxAdequacy: { type: "string" },
    demographicAdequacy: { type: "string" },
    revenueRange: { type: "string" },
    seasonality: { type: "string" },
    verdict: { type: "string", enum: ["Aligné", "Partiellement aligné", "Inadapté"] },
    justification: { type: "string" },
  },
  required: ["fluxAdequacy", "demographicAdequacy", "revenueRange", "verdict", "justification"],
  additionalProperties: false,
};

async function sectorAdequacy(input) {
  const benchmark = SECTOR_BENCHMARKS[input.businessType];
  if (!benchmark) {
    throw new Error(`No sector benchmark for "${input.businessType}".`);
  }

  const flux = input.fluxEstimate;
  const fluxLine =
    flux && flux.quality !== "insuffisant"
      ? `Flux estimé (qualitatif) : ${flux.intensity}${flux.peakWindow ? ` (pic vers ${flux.peakWindow})` : ""}`
      : "Flux estimé : NON DISPONIBLE / insuffisant — rester qualitatif, ne pas inventer de niveau";

  const d = input.demographics;
  const ageLines = Object.entries(d.ageBreakdown)
    .map(([bucket, share]) => `${bucket}: ${Math.round(share * 100)}%`)
    .join(" · ");

  // Per-establishment annual revenue band (task H). Surface is only a
  // qualitative modulator: we no longer multiply an ungrounded per-m² band by
  // the surface. The band comes straight from the sourced sector benchmark.
  const surface = input.surfaceSqm;
  const fmt = (n) => n.toLocaleString("fr-FR");
  const band = benchmark.revenueAnnualEuros;
  const avgPart = benchmark.revenueAvgEuros
    ? ` (moyenne du secteur ≈ ${fmt(benchmark.revenueAvgEuros)} €)`
    : "";
  const sourcePart = benchmark.revenueSource
    ? ` [source : ${benchmark.revenueSource}]`
    : " [fourchette indicative, non encore sourcée — à confirmer]";
  const caLine = band
    ? `Fourchette de CA annuel PAR ÉTABLISSEMENT pour ce secteur : ${fmt(band.min)}–${fmt(band.max)} €${avgPart}${sourcePart}`
    : "Pas de benchmark de CA disponible pour ce secteur.";
  const surfaceModulator = surface
    ? `Surface du local : ${surface} m² — à utiliser comme modulateur QUALITATIF (petite surface → bas de fourchette, grande → haut), sans recalculer de chiffre.`
    : "Surface non communiquée — rester sur la fourchette sectorielle telle quelle.";

  const sig = input.p1Signals ?? {};

  const user = `Données pour l'adéquation sectorielle (page 5) :

Type de commerce : ${input.businessType}
Surface (m²) : ${surface ?? "non communiquée"}
Clientèle cible déclarée : ${input.targetAudience?.join(", ") || "non précisée"}

${fluxLine}

Profil démographique de la zone de chalandise (déjà détaillé en page 3 — ne pas répéter les chiffres) :
- Population : ${d.population}
- Répartition d'âge : ${ageLines}
- Part de propriétaires : ${Math.round(d.ownerShare * 100)}%
- Revenu médian (niveau de vie) : ${d.medianIncome} €

LIEN AVEC LA PAGE 1 :
- Verdict page 1 : ${input.p1Verdict ?? "non déterminé"}
- Signaux page 1 : concurrence ${sig.directCompetition ?? "?"} · risques ${sig.risks ?? "?"} · flux ${sig.flux ?? "?"}

BENCHMARKS SECTORIELS ENCODÉS (à utiliser, ne pas inventer) :
- Adéquation flux attendue : ${benchmark.fluxAdequacy}
- Profil cible du secteur : ${benchmark.targetProfile}
- ${caLine}
- ${surfaceModulator}
- Saisonnalité : ${benchmark.seasonality}

Rédige les sections de la page 5 en respectant strictement les règles.`;

  return callClaude({
    system: P5_SYSTEM_PROMPT,
    user,
    maxTokens: 1200,
    outputSchema: P5_OUTPUT_SCHEMA,
  });
}

// =====================================================================
// BLOCK 2c — Task 4 (P6): risk signals & recommendations
// =====================================================================
// "Best effort" page (brief §4 P6, §6 Task 4): frame as detected signals,
// not exhaustive analysis. Explicitly state when data is unavailable.

const P6_SYSTEM_PROMPT = `Tu rédiges la page "signaux de risque & points de vigilance" (page 6) d'un rapport d'analyse d'emplacement, pour un commerçant non-expert.

RÈGLES NON NÉGOCIABLES :
- Français clair, zéro jargon. Ton factuel et bienveillant, jamais anxiogène ni alarmiste.
- Page "best effort" : parle de "signaux détectés", pas d'analyse exhaustive des risques.
- N'invente AUCUNE donnée. Quand une donnée n'est pas disponible (travaux de voirie), dis-le explicitement.

CHAMPS À PRODUIRE :
- "vacancy" : rédige un court PARAGRAPHE interprété (3-4 phrases). Cite le taux de vacance à 300 m (X locaux vacants sur Y commerces, soit ~Z%) ET à 1 km (~W%). Donne une lecture selon ces seuils : <5% "relativement faible — rue commerciale plutôt bien occupée, sans signal de désertification notable" ; 5–15% "dans la norme" ; >15% "élevé — signal de dévitalisation à surveiller". Conclus par une qualification du niveau d'occupation de la rue. Termine par : "Données OpenStreetMap — non exhaustives, taux réel potentiellement différent."
- "streetDynamics" : la dynamique commerciale. Appuie-toi PRIORITAIREMENT sur les données BODACC fournies (créations vs radiations + procédures collectives), qui reflètent la dynamique à l'échelle du CODE POSTAL (précise-le) — signal plus fiable que la vacance OSM. "trend" ∈ {en amélioration, stable, en dégradation}, cohérent avec le ratio créations/radiations fourni. Le "text" cite les chiffres BODACC et la période. Si BODACC est indisponible, base-toi sur la vacance.
- "worksNote" : travaux de voirie (best-effort ; dire si non vérifié).
- "sectorRisks" : risques propres au secteur dans ce contexte (ex. forte densité de restauration rapide captant la pause déjeuner).
- "recommendations" : 2 à 3 actions concrètes à mener AVANT la signature du bail.`;

const P6_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    vacancy: { type: "string" },
    streetDynamics: {
      type: "object",
      properties: {
        trend: { type: "string", enum: ["en amélioration", "stable", "en dégradation"] },
        text: { type: "string" },
      },
      required: ["trend", "text"],
      additionalProperties: false,
    },
    worksNote: { type: "string" },
    sectorRisks: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["vacancy", "streetDynamics", "worksNote", "sectorRisks", "recommendations"],
  additionalProperties: false,
};

async function riskSignals(input) {
  const v = input.vacancy;
  const b = input.bodacc;
  const bodaccLine = b
    ? `BODACC (code postal ${b.postalCode}, période du ${b.windowStart} au ${b.windowEndInclusive}, soit ${b.months} mois) : ${b.creations} créations, ${b.radiations} radiations, ${b.proceduresCollectives} procédures collectives → tendance calculée : ${b.trend}`
    : "BODACC : non disponible — se rabattre sur la vacance OSM";

  const user = `Données pour les signaux de risque (page 6) :

Type de commerce : ${input.businessType}

Vacance commerciale (OpenStreetMap) :
- Rayon 300 m : ${v.vacant300} locaux vacants sur ${v.total300} commerces recensés (${v.pct300}%)
- Rayon 1 km : ${v.vacant1000} locaux vacants sur ${v.total1000} commerces recensés (${v.pct1000}%)

Dynamique commerciale — ${bodaccLine}

Densité sectorielle pertinente (rayon 300 m) :
- Restauration rapide (fast-food) : ${input.density.fastFood300}
- Restaurants : ${input.density.restaurant300}

Travaux de voirie : ${input.worksDataAvailable ? "données disponibles" : "AUCUNE source de données travaux disponible — à signaler explicitement comme non vérifié"}

Rédige les sections de la page 6 en respectant strictement les règles.`;

  return callClaude({
    system: P6_SYSTEM_PROMPT,
    user,
    maxTokens: 1200,
    outputSchema: P6_OUTPUT_SCHEMA,
  });
}

// =====================================================================
// BLOCK 2d — Task 1 (P1): executive prose for the verdict page
// =====================================================================
// The keystone page. The score, verdict and 4 key metrics are computed
// DETERMINISTICALLY upstream (scoring.js) — the LLM no longer produces the
// number. Here it only WRITES the executive summary + justification from
// the already-decided breakdown, and must not contradict it (brief §4 P1).

const P1_SYSTEM_PROMPT = `Tu rédiges les textes de la PAGE 1 (verdict & synthèse) d'un rapport d'analyse d'emplacement commercial. C'est la page la plus importante : elle doit être lisible en moins de 60 secondes par un commerçant non-expert.

IMPORTANT : le score sur 10, le verdict (VIABLE / NON VIABLE) et les 4 métriques clés te sont FOURNIS, déjà calculés par un modèle déterministe. Tu ne les recalcules pas et tu ne les contredis pas. Tu rédiges uniquement les textes qui les expliquent.

RÈGLES NON NÉGOCIABLES :
- Français clair, zéro jargon analytique. Ton professionnel, direct, bienveillant, clair et rassurant même si le verdict est négatif.
- N'invente AUCUN chiffre. Utilise uniquement les données fournies. Ne cite jamais un score ou un verdict différents de ceux fournis.
- Résumé exécutif ("executiveSummary") : 3 à 4 phrases maximum, synthèse de tout le rapport en langage non-expert, cohérente avec le verdict fourni.
- Si le verdict fourni est "NON VIABLE" ET que demographicProfile vaut "Aligné", le résumé exécutif DOIT nommer explicitement la raison dominante fournie (saturation concurrentielle, signaux de risque, ou flux insuffisant) pour éviter toute ambiguïté avec la page 5. Exemple : "Malgré un profil démographique favorable, la densité concurrentielle de la zone conduit à un verdict NON VIABLE."
- "justification" : 1 à 2 phrases qui expliquent le verdict à partir des métriques fournies.
- "limitationNote" : si DEUX sources majeures (concurrents Places ET démographie IRIS) sont en défaut (partielle/absente) simultanément, rédige un court encadré de limitation ; sinon laisse une chaîne VIDE.`;

const P1_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    limitationNote: { type: "string" },
    justification: { type: "string" },
  },
  required: ["executiveSummary", "limitationNote", "justification"],
  additionalProperties: false,
};

// Picks the dominant negative driver to name in the summary when the
// verdict is NON VIABLE (from vetoes, else the lowest-contributing pillar).
function dominantNegativeDriver(breakdown) {
  const vetoMap = {
    concurrence_dense_et_flux_faible: "la saturation concurrentielle combinée à un flux insuffisant",
    demographie_inadaptee: "un profil démographique inadapté",
    zone_non_couverte: "une commune hors de la zone couverte",
  };
  if (breakdown.vetoes.length) return vetoMap[breakdown.vetoes[0]] ?? breakdown.vetoes[0];
  const labels = {
    concurrence: "la saturation concurrentielle",
    demographie: "le profil démographique",
    flux: "le flux insuffisant",
    risques: "les signaux de risque",
  };
  const worst = Object.entries(breakdown.pillars).sort((a, b) => a[1].weighted - b[1].weighted)[0][0];
  return labels[worst];
}

async function writeVerdictSummary(input) {
  const d = input.demographics;
  const ageLines = Object.entries(d.ageBreakdown)
    .map(([bucket, share]) => `${bucket}: ${Math.round(share * 100)}%`)
    .join(" · ");
  const bd = input.breakdown;
  const km = input.keyMetrics;

  const user = `Résumé consolidé pour rédiger la page 1.

SCORE ET VERDICT DÉJÀ CALCULÉS (à ne pas recalculer ni contredire) :
- Score : ${input.score}/10 (seuil de viabilité : ${bd.cutoff})
- Verdict : ${input.verdict}
- Raison dominante du verdict : ${input.verdict === "NON VIABLE" ? dominantNegativeDriver(bd) : "profil globalement favorable"}
- Métriques clés : flux ${km.flux} · démographie ${km.demographicProfile} · concurrence ${km.directCompetition} · risques ${km.risks}

Type de commerce : ${input.businessType}
Commune : ${input.zone.commune} (${input.zone.population} hab., zone couverte : ${input.zone.covered ? "oui" : "non"})

QUALITÉ DES DONNÉES (signaux) :
- Concurrents (Google Places) : ${input.dataQuality.places}
- Démographie (INSEE IRIS) : ${input.dataQuality.iris}
- Flux (BestTime) : ${input.dataQuality.besttime}

CONCURRENCE :
- Concurrents directs dans ${input.competition.radiusPrimary} m : ${input.competition.directPrimary}
- Chaînes du même secteur dans ${input.competition.radiusPrimary} m : ${input.competition.chainPrimary}
- Concurrents directs zone élargie : ${input.competition.directSecondary}
- Densité commerciale globale (tous commerces, 1 km) : ${input.competition.densityGlobal1km}

DÉMOGRAPHIE (zone de chalandise) :
- Population : ${d.population}
- Âge : ${ageLines}
- Propriétaires : ${Math.round(d.ownerShare * 100)}%
- Revenu médian : ${d.medianIncome} €
- Clientèle cible déclarée : ${input.targetAudience?.join(", ") || "non précisée"}

SIGNAUX DE RISQUE :
- Taux de vacance commerciale (300 m) : ${input.risks.vacancyPct300}%
- Restauration rapide (300 m) : ${input.risks.fastFood300} · Restaurants : ${input.risks.restaurant300}
- Travaux de voirie : ${input.risks.worksUnknown ? "non vérifiés (pas de source)" : "vérifiés"}
- Loyer vs marché : ${input.risks.rentUnknown ? "non communiqué" : "comparé"}

Produis executiveSummary, justification et limitationNote en respectant strictement les règles.`;

  return callClaude({
    system: P1_SYSTEM_PROMPT,
    user,
    maxTokens: 1000,
    outputSchema: P1_OUTPUT_SCHEMA,
  });
}

// =====================================================================
// BLOCK 2e — Task 5 (P3): zone synthesis (density interpretation + summary)
// =====================================================================

const P3_SYSTEM_PROMPT = `Tu rédiges deux courts textes pour la page 3 (zone de chalandise) d'un rapport d'analyse d'emplacement, pour un commerçant non-expert.

RÈGLES :
- Français clair, zéro jargon. Ton factuel, positif si les données le justifient. N'invente AUCUN chiffre.
- "densityInterpretation" : UNE seule phrase d'interprétation de la densité commerciale. Compare la densité au profil de ville selon ces seuils (référence = densité dans 1 km ; tu peux citer le chiffre à 300 m) :
  • > 1000 commerces → zone hypercommerciale
  • 500–1000 → zone commerciale active, normale pour un centre-ville de grande ville
  • < 500 → zone mixte ou résidentielle
- "zoneSummary" : 2 à 3 phrases qui synthétisent le PROFIL DE ZONE — stabilité résidentielle (part de propriétaires), niveau de revenus, dynamique commerciale. NE JUGE PAS l'adéquation avec le commerce spécifique (c'est le rôle de la page 5).`;

const P3_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    densityInterpretation: { type: "string" },
    zoneSummary: { type: "string" },
  },
  required: ["densityInterpretation", "zoneSummary"],
  additionalProperties: false,
};

async function zoneSynthesis(input) {
  const d = input.demographics;
  const ageLines = Object.entries(d.ageBreakdown)
    .map(([bucket, share]) => `${bucket}: ${Math.round(share * 100)}%`)
    .join(" · ");

  const user = `Données pour la synthèse de la zone de chalandise (page 3) :

Commune : ${input.commune}
Densité commerciale (tous commerces, source OpenStreetMap) :
- 300 m : ${input.density.r300} commerces · 500 m : ${input.density.r500} · 1 km : ${input.density.r1000}

Profil démographique de la zone :
- Population : ${d.population}
- Répartition d'âge : ${ageLines}
- Part de propriétaires : ${Math.round(d.ownerShare * 100)}%
- Revenu médian (niveau de vie) : ${d.medianIncome} €

Produis densityInterpretation (1 phrase) et zoneSummary (2-3 phrases) selon les règles.`;

  return callClaude({
    system: P3_SYSTEM_PROMPT,
    user,
    maxTokens: 700,
    outputSchema: P3_OUTPUT_SCHEMA,
  });
}

// =====================================================================
// BLOCK 3 — Run directly: build real input for Bordeaux, then synthesize
// =====================================================================

const TEST_ADDRESS = "65 Rue Judaïque, 33000 Bordeaux, France";
const TEST_BUSINESS = "boulangerie";

// Task 2 (P4): assemble real competitor + density data, then synthesize.
async function runP4() {
  const { geocodeAddress, searchCompetitors, classifyCompetitors, includedTypesForSector } =
    require("./competitor-search");
  const { SECTOR_CONFIG } = require("./sector_config");
  const { EXCLUSION_LISTS } = require("./exclusion-lists");
  const { getCommercialDensity } = require("./commercial-density");

  const loc = await geocodeAddress(TEST_ADDRESS);
  const radii = SECTOR_CONFIG[TEST_BUSINESS];
  const types = includedTypesForSector(TEST_BUSINESS);
  const entries = EXCLUSION_LISTS[TEST_BUSINESS] ?? [];

  const primary = classifyCompetitors(
    await searchCompetitors(loc.latitude, loc.longitude, radii.radius_primary, types),
    TEST_BUSINESS,
    entries
  );
  const secondary = classifyCompetitors(
    await searchCompetitors(loc.latitude, loc.longitude, radii.radius_secondary, types),
    TEST_BUSINESS,
    entries
  );
  const density = await getCommercialDensity(loc.latitude, loc.longitude);

  const realCount = primary.direct.length + primary.chain.length;
  const input = {
    businessType: TEST_BUSINESS,
    placesStatus: realCount < 3 ? "partielle" : "complete",
    catchmentArea: {
      radiusMeters: radii.radius_primary,
      directCount: primary.direct.length,
      chainCount: primary.chain.length,
      topDirect: primary.direct.slice(0, 6).map((c) => ({ name: c.name, googleRating: c.googleRating })),
      chains: primary.chain.map((c) => c.name),
    },
    sectorProfile: {
      radiusMeters: radii.radius_secondary,
      directCount: secondary.direct.length,
      chainCount: secondary.chain.length,
    },
    commercialDensity: {
      r300: density.rings.r300.total,
      r500: density.rings.r500.total,
      r1000: density.rings.r1000.total,
    },
  };

  const result = await competitiveSynthesis(input);
  console.log("--- P4 synthèse concurrentielle (Claude) ---\n");
  console.log(result.text);
  console.log("\n[tokens] in:", result.usage?.input_tokens, "out:", result.usage?.output_tokens);
}

// Task 3 (P5): assemble real demographics (10-min zone), then synthesize.
async function runP5() {
  const { geocodeAddress } = require("./competitor-search");
  const { getIsochrones } = require("./isochrones");
  const { findIrisInPolygon } = require("./iris-geometry");
  const { loadIrisData, aggregateDemographics } = require("./demographics");

  const loc = await geocodeAddress(TEST_ADDRESS);
  const isochrones = await getIsochrones(loc.latitude, loc.longitude);
  const iris10 = await findIrisInPolygon(isochrones.rings.walk10min.geometry);
  const agg = aggregateDemographics(iris10, loadIrisData());

  const input = {
    businessType: TEST_BUSINESS,
    surfaceSqm: 80,
    targetAudience: ["Résidents du quartier", "Familles"],
    // For Rue Judaïque, BestTime coverage is thin → realistic "insuffisant".
    fluxEstimate: { quality: "insuffisant" },
    demographics: {
      population: agg.population.total,
      ageBreakdown: {
        "0-17": agg.ageBreakdown["0-17"].share,
        "18-39": agg.ageBreakdown["18-39"].share,
        "40-64": agg.ageBreakdown["40-64"].share,
        "65+": agg.ageBreakdown["65+"].share,
      },
      ownerShare: agg.housing.ownerShare,
      medianIncome: agg.income.medianEuros,
    },
  };

  const result = await sectorAdequacy(input);
  console.log("--- P5 adéquation sectorielle (Claude, structuré) ---\n");
  console.log(JSON.stringify(result.json, null, 2));
  console.log("\n[tokens] in:", result.usage?.input_tokens, "out:", result.usage?.output_tokens);
}

// Task 4 (P6): assemble real vacancy + density signals, then synthesize.
async function runP6() {
  const { geocodeAddress } = require("./competitor-search");
  const { getCommercialDensity } = require("./commercial-density");

  const loc = await geocodeAddress(TEST_ADDRESS);
  const density = await getCommercialDensity(loc.latitude, loc.longitude);

  const input = {
    businessType: TEST_BUSINESS,
    vacancy: {
      vacant300: density.rings.r300.byCategory.vacant ?? 0,
      total300: density.rings.r300.total,
      vacant1000: density.rings.r1000.byCategory.vacant ?? 0,
      total1000: density.rings.r1000.total,
    },
    density: {
      fastFood300: density.rings.r300.byCategory.fast_food ?? 0,
      restaurant300: density.rings.r300.byCategory.restaurant ?? 0,
    },
    worksDataAvailable: false,
    rentProvided: null,
  };

  const result = await riskSignals(input);
  console.log("--- P6 signaux de risque (Claude, structuré) ---\n");
  console.log(JSON.stringify(result.json, null, 2));
  console.log("\n[tokens] in:", result.usage?.input_tokens, "out:", result.usage?.output_tokens);
}

// Task 1 (P1): assemble the full consolidated metrics, then score & verdict.
async function runP1() {
  const { geocodeAddress, searchCompetitors, classifyCompetitors, includedTypesForSector } =
    require("./competitor-search");
  const { validateZone } = require("./zone-validation");
  const { getIsochrones } = require("./isochrones");
  const { findIrisInPolygon } = require("./iris-geometry");
  const { loadIrisData, aggregateDemographics } = require("./demographics");
  const { getCommercialDensity } = require("./commercial-density");
  const { SECTOR_CONFIG } = require("./sector_config");
  const { EXCLUSION_LISTS } = require("./exclusion-lists");

  const loc = await geocodeAddress(TEST_ADDRESS);
  const zone = await validateZone({ latitude: loc.latitude, longitude: loc.longitude, market: "FR" });

  const radii = SECTOR_CONFIG[TEST_BUSINESS];
  const types = includedTypesForSector(TEST_BUSINESS);
  const entries = EXCLUSION_LISTS[TEST_BUSINESS] ?? [];
  const primary = classifyCompetitors(
    await searchCompetitors(loc.latitude, loc.longitude, radii.radius_primary, types),
    TEST_BUSINESS,
    entries
  );
  const secondary = classifyCompetitors(
    await searchCompetitors(loc.latitude, loc.longitude, radii.radius_secondary, types),
    TEST_BUSINESS,
    entries
  );

  const isochrones = await getIsochrones(loc.latitude, loc.longitude);
  const iris10 = await findIrisInPolygon(isochrones.rings.walk10min.geometry);
  const agg = aggregateDemographics(iris10, loadIrisData());

  const density = await getCommercialDensity(loc.latitude, loc.longitude);
  const v300 = density.rings.r300.byCategory.vacant ?? 0;

  const realCount = primary.direct.length + primary.chain.length;
  const input = {
    businessType: TEST_BUSINESS,
    targetAudience: ["Résidents du quartier", "Familles"],
    zone: { commune: zone.commune?.name, population: zone.commune?.population, covered: zone.covered },
    dataQuality: {
      places: realCount < 3 ? "partielle" : "complete",
      iris: agg.quality,
      besttime: "insuffisant",
    },
    flux: { status: "insuffisant" },
    competition: {
      radiusPrimary: radii.radius_primary,
      directPrimary: primary.direct.length,
      chainPrimary: primary.chain.length,
      directSecondary: secondary.direct.length,
      densityGlobal1km: density.rings.r1000.total,
    },
    demographics: {
      population: agg.population.total,
      ageBreakdown: {
        "0-17": agg.ageBreakdown["0-17"].share,
        "18-39": agg.ageBreakdown["18-39"].share,
        "40-64": agg.ageBreakdown["40-64"].share,
        "65+": agg.ageBreakdown["65+"].share,
      },
      ownerShare: agg.housing.ownerShare,
      medianIncome: agg.income.medianEuros,
    },
    risks: {
      vacancyPct300: density.rings.r300.total > 0 ? Math.round((v300 / density.rings.r300.total) * 100) : 0,
      fastFood300: density.rings.r300.byCategory.fast_food ?? 0,
      restaurant300: density.rings.r300.byCategory.restaurant ?? 0,
      worksUnknown: true,
      rentUnknown: true,
    },
  };

  const { computeScore } = require("./scoring");
  const scored = computeScore(input);
  console.log("--- P1 score déterministe (scoring.js) ---\n");
  console.log(JSON.stringify({ score: scored.score, verdict: scored.verdict, keyMetrics: scored.keyMetrics, vetoes: scored.breakdown.vetoes }, null, 2));

  const result = await writeVerdictSummary({ ...input, ...scored });
  console.log("\n--- P1 prose (Claude) ---\n");
  console.log(JSON.stringify(result.json, null, 2));
  console.log("\n[tokens] in:", result.usage?.input_tokens, "out:", result.usage?.output_tokens);
}

if (require.main === module) {
  const task = process.argv[2] || "p4";
  const runners = { p1: runP1, p4: runP4, p5: runP5, p6: runP6 };
  const runner = runners[task] || runP4;
  runner().catch((error) => {
    console.error("ERROR:", error.message);
    process.exit(1);
  });
}

module.exports = {
  callClaude,
  competitiveSynthesis,
  sectorAdequacy,
  riskSignals,
  writeVerdictSummary,
  zoneSynthesis,
};
