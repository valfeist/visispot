/**
 * PIPELINE STEP 1 — Competitor detection (Google Places)
 * -------------------------------------------------------
 * Input  : a JSON object simulating the client form answers.
 * Output : a structured JSON (competitors within a primary and a
 *          secondary radius) printed to the terminal.
 *
 * Run with:  node competitor-search.js
 */

// =====================================================================
// BLOCK 1 — Configuration: API key + simulated form data
// =====================================================================

// Load .env into process.env before reading any API key.
require("./load-env");

// We import the per-sector radius table (sector_config.js).
const { SECTOR_CONFIG } = require("./sector_config");
// We import the per-market configuration (market_config.js).
const { MARKET_CONFIG } = require("./market_config");
// We import the false-positive exclusion terms (exclusion-lists.js).
const { EXCLUSION_LISTS } = require("./exclusion-lists");
// Sector -> Places (New) primaryType whitelist/blacklist + OSM tags + name
// heuristics. This is the source of truth for "is this place a same-sector
// competitor?" (kills the cross-sector contamination).
const { SECTOR_TYPE_MAPPING, matchesSector } = require("./sector-type-mapping");

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Market applied when the order form does not specify one.
const DEFAULT_MARKET = "FR";

// Radii applied when the sector is not found in SECTOR_CONFIG.
const DEFAULT_RADII = { radius_primary: 500, radius_secondary: 800 };

// Object simulating what the client form (Tally/Typeform) will send.
// To test another business, just change "businessType".
const order = {
  market: "FR", // optional in the form; defaults to "FR" when absent
  address: "65 Rue Judaïque, 33000 Bordeaux, France",
  businessType: "boulangerie",
  targetAudience: ["Résidents du quartier", "Familles"],
};

// =====================================================================
// BLOCK 2 — Sector -> normalized Google Places types mapping
// =====================================================================
// Google does not understand "boulangerie": it expects normalized
// types (e.g. "bakery"). We translate the form sector accordingly.

const GOOGLE_TYPES_BY_SECTOR = {
  boulangerie: ["bakery"],
  restauration: ["restaurant"],
  snacking: ["restaurant"],
  coiffure: ["hair_care", "beauty_salon"],
  beaute: ["beauty_salon"],
  epicerie_fine: ["grocery_store", "supermarket"],
  caviste: ["liquor_store"],
  pressing: ["laundry"],
  laverie: ["laundry"],
  retouche: ["tailor"],
};

// Types sent to Google's `includedTypes`. Prefer the mapping whitelist (New
// primaryTypes), dropping MATCH:* patterns (Google only accepts concrete
// types — the wildcard is enforced later by matchesSector). Falls back to the
// legacy table for any sector not yet in the mapping (reconciled in P0.4).
function includedTypesForSector(sector) {
  const cfg = SECTOR_TYPE_MAPPING[sector];
  if (cfg) return cfg.google_include.filter((t) => !t.startsWith("MATCH:"));
  return GOOGLE_TYPES_BY_SECTOR[sector];
}

// =====================================================================
// BLOCK 2b — Resolve radii for the requested sector
// =====================================================================
// Returns {radius_primary, radius_secondary} for the given sector, or
// the default values + a warning if the sector is unknown.

function getRadii(businessType) {
  const config = SECTOR_CONFIG[businessType];
  if (!config) {
    console.warn(
      `WARNING: sector "${businessType}" not recognized — default radii applied (${DEFAULT_RADII.radius_primary}m / ${DEFAULT_RADII.radius_secondary}m).`
    );
    return DEFAULT_RADII;
  }
  return config;
}

// =====================================================================
// BLOCK 2c — Resolve the market configuration
// =====================================================================
// Reads the order's "market" field (defaults to "FR" when absent) and
// returns the matching config from MARKET_CONFIG. The demographic
// sources are NOT wired here yet — only the config is loaded.

function getMarketConfig(market) {
  const resolvedMarket = market ?? DEFAULT_MARKET;
  const config = MARKET_CONFIG[resolvedMarket];
  if (!config) {
    throw new Error(
      `Market "${resolvedMarket}" not configured. Available markets: ${Object.keys(MARKET_CONFIG).join(", ")}`
    );
  }
  return { market: resolvedMarket, config };
}

// =====================================================================
// BLOCK 3 — Geocoding: text address -> GPS coordinates
// =====================================================================
// We use Places "Text Search" (New) to turn the address into
// latitude/longitude, keeping everything on a single Google API.

async function geocodeAddress(address) {
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        // Only request the useful fields (cheaper, faster).
        "X-Goog-FieldMask":
          "places.location,places.formattedAddress,places.id",
      },
      body: JSON.stringify({ textQuery: address }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Geocoding failed (HTTP ${response.status}): ${JSON.stringify(data)}`
    );
  }

  const firstResult = data.places?.[0];
  if (!firstResult) {
    throw new Error(`Address not found: "${address}"`);
  }

  return {
    latitude: firstResult.location.latitude,
    longitude: firstResult.location.longitude,
    formattedAddress: firstResult.formattedAddress,
  };
}

// =====================================================================
// BLOCK 5 — Format a single competitor (extract useful fields)
// =====================================================================
// (Defined before block 4 because the search uses it.)
// Turns Google's raw response into a clean, readable object.

function formatCompetitor(place) {
  return {
    name: place.displayName?.text ?? "Unknown name",
    placeId: place.id ?? null,
    address: place.formattedAddress ?? null,
    // Raw Google types kept for classification + the contamination guard-rail.
    primaryType: place.primaryType ?? null,
    types: place.types ?? [],
    googleRating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    status: place.businessStatus ?? "UNKNOWN", // OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY
    openingHours: summarizeOpeningHours(place.regularOpeningHours),
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
  };
}

// Builds a short opening-hours summary from Places (New) regularOpeningHours,
// e.g. "Lun–Sam 7h–20h, Dim 8h–13h". Returns null when not provided.
const DAY_FR = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"]; // Places day: 0=Sunday
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first

function formatHour(t) {
  if (!t) return "";
  const h = t.hour ?? 0;
  const m = t.minute ?? 0;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function summarizeOpeningHours(regularOpeningHours) {
  const periods = regularOpeningHours?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return null;

  // First open period per day (day index from period.open.day).
  const dayHours = {};
  for (const p of periods) {
    if (!p.open) continue;
    const d = p.open.day;
    if (dayHours[d] === undefined) dayHours[d] = `${formatHour(p.open)}–${formatHour(p.close)}`;
  }

  // Collapse consecutive (Monday-first) days that share the same hours.
  const out = [];
  let i = 0;
  while (i < WEEK_ORDER.length) {
    const hours = dayHours[WEEK_ORDER[i]];
    if (!hours) { i++; continue; }
    let j = i;
    while (j + 1 < WEEK_ORDER.length && dayHours[WEEK_ORDER[j + 1]] === hours) j++;
    const range = i === j ? DAY_FR[WEEK_ORDER[i]] : `${DAY_FR[WEEK_ORDER[i]]}–${DAY_FR[WEEK_ORDER[j]]}`;
    out.push(`${range} ${hours}`);
    i = j + 1;
  }
  return out.length ? out.join(", ") : null;
}

// =====================================================================
// BLOCK 5b — Build a radius block with saturation detection
// =====================================================================
// Google caps each search at 20 results with no pagination.
// If we receive exactly 20, the real count is likely higher: we flag
// it (saturated=true) without inventing a corrected number.

const SATURATION_THRESHOLD = 20;

function buildRadiusBlock(radiusMeters, classified) {
  const { direct, chain, filteredOut } = classified;
  // rawCount = everything Google returned (all 3 groups), so the
  // saturation flag still reflects Google's 20-result cap, not our filter.
  const rawCount = direct.length + chain.length + filteredOut.length;
  const saturated = rawCount === SATURATION_THRESHOLD;
  return {
    radiusMeters,
    competitorsDirect: direct,
    competitorsChain: chain,
    filteredOut,
    directCount: direct.length,
    chainCount: chain.length,
    filteredOutCount: filteredOut.length,
    rawCount,
    saturated,
    note: saturated
      ? "The actual number of establishments exceeds the data source limit (20)."
      : null,
  };
}

// =====================================================================
// BLOCK 5c bis — Whole-word matching for exclusion terms
// =====================================================================
// A term only matches if it appears as a standalone word, not as a
// substring of a longer word ("eat" must not match "Great Burger").
// "Word characters" include accented letters, digits, apostrophe and
// hyphen — so "Saint-Nicolas" is one token and does NOT match "nicolas",
// while "Nicolas Vins" does. (Plain \b would mishandle both accents and
// the hyphen, so we use Unicode-aware boundaries instead.)

const WORD_CHAR = "[\\p{L}\\p{N}'’-]";

function matchesExclusionTerm(name, term) {
  const normalized = name.toLowerCase();
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`, "u");
  return regex.test(normalized);
}

// =====================================================================
// BLOCK 5c bis — Deduplication (place_id, then name + proximity)
// =====================================================================
// Google can return the same shop twice (e.g. "L'Atelier du Sourcil" at 559 m
// and 565 m). We drop exact place_id repeats, then near-duplicates: same
// normalized name within 25 m of each other.

const DEDUP_METERS = 25;

function metersBetween(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeCompetitors(competitors) {
  const byId = [];
  const seenId = new Set();
  for (const c of competitors) {
    if (c.placeId && seenId.has(c.placeId)) continue;
    if (c.placeId) seenId.add(c.placeId);
    byId.push(c);
  }
  const out = [];
  for (const c of byId) {
    const isNearDup = out.some(
      (o) =>
        normalizeName(o.name) === normalizeName(c.name) &&
        o.latitude != null && o.longitude != null && c.latitude != null && c.longitude != null &&
        metersBetween(o.latitude, o.longitude, c.latitude, c.longitude) < DEDUP_METERS
    );
    if (!isNearDup) out.push(c);
  }
  return out;
}

// =====================================================================
// BLOCK 5c ter — Contamination guard-rail (cross-sector, all sectors)
// =====================================================================
// Flags every competitor whose primaryType is NOT in the sector whitelist.
// This is the automatic cross-sector detector: it surfaces bleed (e.g. a
// nail_salon returned for a coiffure scan) without any manual review.

function inSectorWhitelist(primaryType, sector) {
  const cfg = SECTOR_TYPE_MAPPING[sector];
  if (!cfg) return true; // no mapping yet (pre-P0.4): cannot judge
  // Name-classified sectors have no type whitelist by design: a primaryType can
  // neither prove nor disprove membership, so type-based contamination is not
  // judgeable. matchesSector's name gate is what filters them.
  if (cfg.classify_by === "name") return true;
  return cfg.google_include.some((rule) =>
    rule.startsWith("MATCH:")
      ? (primaryType || "").endsWith(rule.slice(6).replace("*", ""))
      : rule === primaryType
  );
}

function detectContamination(competitors, sector) {
  return competitors
    .filter((c) => !inSectorWhitelist(c.primaryType, sector))
    .map((c) => ({ name: c.name, primaryType: c.primaryType, types: c.types }));
}

// =====================================================================
// BLOCK 5c — Competitor classification
// =====================================================================
// Two axes, in order:
//   1. Relevance (mapping): is this place a same-sector competitor? Judged on
//      primaryType via the sector whitelist/blacklist (+ name heuristics for
//      the laundry family, name denylist for coiffure). Off-sector -> filtered.
//   2. Chain vs direct: among relevant places, the exclusion list separates
//      franchises (chain) and technical false positives (filteredOut).
// Input is deduplicated first.

function classifyCompetitors(competitors, sector, exclusionEntries = []) {
  const deduped = dedupeCompetitors(competitors);
  const hasMapping = Boolean(SECTOR_TYPE_MAPPING[sector]);
  const direct = [];
  const chain = [];
  const filteredOut = [];

  for (const competitor of deduped) {
    // 1. Relevance gate (skipped only for sectors without a mapping yet).
    if (
      hasMapping &&
      !matchesSector(
        { primaryType: competitor.primaryType, types: competitor.types, displayName: competitor.name },
        sector
      )
    ) {
      filteredOut.push({
        ...competitor,
        matchedTerm: null,
        reason: `hors périmètre secteur (primaryType=${competitor.primaryType ?? "?"})`,
      });
      continue;
    }

    // 2. Chain vs direct vs technical false positive (exclusion list).
    const match = exclusionEntries.find((entry) =>
      matchesExclusionTerm(competitor.name, entry.name)
    );
    if (!match) {
      direct.push(competitor);
    } else if (match.category === "chain") {
      chain.push({ ...competitor, matchedTerm: match.name, reason: match.reason });
    } else {
      filteredOut.push({ ...competitor, matchedTerm: match.name, reason: match.reason });
    }
  }
  return { direct, chain, filteredOut };
}

// =====================================================================
// BLOCK 4 — Search competitors within a given radius
// =====================================================================
// Queries Places "Nearby Search" (New) around the coordinates,
// filtered by the sector's Google types, for the requested radius (m).

async function searchCompetitors(latitude, longitude, radiusMeters, googleTypes) {
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.primaryType,places.types,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus,places.location,places.regularOpeningHours",
      },
      body: JSON.stringify({
        includedTypes: googleTypes,
        maxResultCount: GOOGLE_MAX_RESULTS,
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: radiusMeters,
          },
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Search ${radiusMeters}m failed (HTTP ${response.status}): ${JSON.stringify(data)}`
    );
  }

  // If Google returns no "places", there are no competitors.
  const places = data.places ?? [];
  const out = places.map(formatCompetitor);
  // Right-censoring flag (see GOOGLE_MAX_RESULTS): the list came back full.
  out.capped = places.length >= GOOGLE_MAX_RESULTS;
  return out;
}

// Google caps a single search at 20 results and Nearby Search offers no
// pagination. A search that comes back full is therefore a RIGHT-CENSORED
// observation: the true count is "at least 20", not 20. The scorer must treat it
// as a lower bound and never resolve it optimistically.
const GOOGLE_MAX_RESULTS = 20;

// =====================================================================
// BLOCK 5e — Text Search (second discovery mode)
// =====================================================================
// Why this exists: Nearby Search returns the 20 most PROMINENT places whose
// `types[]` contain a requested type, but we classify on `primaryType`. For a
// trade Google does not type distinctly (épicerie fine sits under the same
// grocery_store bucket as Monoprix), the top 20 fill up with supermarkets,
// cinemas and bakeries and every genuine shop is filtered out — a live run on
// Rue Judaïque returned 0 competitors for epicerie_fine. A keyword Text Search
// finds them instead (L'épicerie 56, Le Comptoir Bordelais...), and they come
// back with primaryType grocery_store / deli, already in google_include, so no
// filter change is needed.
//
// Caveat handled below: searchText only supports a CIRCLE as locationBias (not
// as a restriction), so results can fall outside the radius. We filter on the
// real distance to keep competitor counts honest.

async function searchCompetitorsByText(latitude, longitude, radiusMeters, textQuery) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.primaryType,places.types,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus,places.location,places.regularOpeningHours",
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: GOOGLE_MAX_RESULTS,
      locationBias: {
        circle: { center: { latitude, longitude }, radius: radiusMeters },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Text search "${textQuery}" failed (HTTP ${response.status}): ${JSON.stringify(data)}`
    );
  }

  const raw = data.places ?? [];
  const kept = raw
    .map(formatCompetitor)
    .filter(
      (c) =>
        c.latitude !== null &&
        c.longitude !== null &&
        metersBetween(latitude, longitude, c.latitude, c.longitude) <= radiusMeters
    );
  kept.capped = raw.length >= GOOGLE_MAX_RESULTS;
  return kept;
}

// Sector-aware search: Nearby Search, plus a Text Search per `text_queries`
// entry declared by the sector. Results are merged and deduplicated, then go
// through the usual classification (no special-casing downstream).
async function searchCompetitorsForSector(latitude, longitude, radiusMeters, sector) {
  const types = includedTypesForSector(sector) ?? [];
  const nearby = types.length
    ? await searchCompetitors(latitude, longitude, radiusMeters, types)
    : [];
  let capped = Boolean(nearby.capped);
  const collected = [...nearby];

  for (const query of SECTOR_TYPE_MAPPING[sector]?.text_queries ?? []) {
    const hits = await searchCompetitorsByText(latitude, longitude, radiusMeters, query);
    capped = capped || Boolean(hits.capped);
    collected.push(...hits);
  }

  const merged = dedupeCompetitors(collected);
  // Any censored underlying search censors the whole count.
  merged.capped = capped;
  return merged;
}

// =====================================================================
// BLOCK 6 — Orchestrator: geocode then run both searches
// =====================================================================

async function main() {
  // 6.0 — Load the market configuration at startup (defaults to "FR").
  const { market, config: marketConfig } = getMarketConfig(order.market);

  // 6.1 — Translate the form sector into Google types (mapping whitelist).
  const googleTypes = includedTypesForSector(order.businessType);
  if (!googleTypes) {
    throw new Error(
      `Sector "${order.businessType}" not handled. Known sectors: ${Object.keys(GOOGLE_TYPES_BY_SECTOR).join(", ")}`
    );
  }

  // 6.2 — Resolve primary/secondary radii for the sector.
  const radii = getRadii(order.businessType);

  // 6.3 — Turn the address into GPS coordinates.
  const location = await geocodeAddress(order.address);

  // 6.4 — Search competitors for the primary then secondary radius.
  const primaryCompetitors = await searchCompetitors(
    location.latitude,
    location.longitude,
    radii.radius_primary,
    googleTypes
  );
  const secondaryCompetitors = await searchCompetitors(
    location.latitude,
    location.longitude,
    radii.radius_secondary,
    googleTypes
  );

  // 6.5 — Resolve the exclusion entries for this sector (empty if none yet).
  const exclusionEntries = EXCLUSION_LISTS[order.businessType] ?? [];

  // 6.5b — Contamination guard-rail: warn on any raw result whose primaryType
  // is outside the sector whitelist (cross-sector bleed detector).
  const contamination = detectContamination(primaryCompetitors, order.businessType);
  if (contamination.length) {
    console.warn(`⚠️  Contamination détectée (${contamination.length}) : ` +
      contamination.map((c) => `${c.name} [${c.primaryType}]`).join(", "));
  }

  // 6.6 — Classify competitors (direct / chain / false positive), then build blocks.
  const primaryClassified = classifyCompetitors(primaryCompetitors, order.businessType, exclusionEntries);
  const secondaryClassified = classifyCompetitors(secondaryCompetitors, order.businessType, exclusionEntries);
  const primaryBlock = buildRadiusBlock(radii.radius_primary, primaryClassified);
  const secondaryBlock = buildRadiusBlock(radii.radius_secondary, secondaryClassified);

  // 6.7 — Brief rule (step 6): < 3 real competitors (direct + chain) => "partielle".
  const realCompetitorCount = primaryBlock.directCount + primaryBlock.chainCount;
  const placesStatus = realCompetitorCount < 3 ? "partielle" : "complete";

  // 6.8 — Assemble the final structured result.
  return {
    order: {
      market,
      currency: marketConfig.currency,
      inputAddress: order.address,
      geocodedAddress: location.formattedAddress,
      coordinates: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      businessType: order.businessType,
      googleTypesUsed: googleTypes,
      targetAudience: order.targetAudience,
    },
    dataQuality: {
      places: {
        status: placesStatus,
        primarySaturated: primaryBlock.saturated,
        secondarySaturated: secondaryBlock.saturated,
      },
    },
    competitors: {
      catchmentArea: {
        purpose: "Direct competitors within primary catchment area",
        ...primaryBlock,
      },
      sectorProfile: {
        purpose: "Sector density signal for the broader neighborhood",
        ...secondaryBlock,
      },
    },
  };
}

// =====================================================================
// BLOCK 7 — Run and print the result as JSON
// =====================================================================

// Only run the pipeline when this file is executed directly
// (so it can be require()d for testing without triggering API calls).
if (require.main === module) {
  main()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("ERROR:", error.message);
      process.exit(1);
    });
}

module.exports = {
  geocodeAddress,
  searchCompetitors,
  searchCompetitorsForSector,
  searchCompetitorsByText,
  classifyCompetitors,
  dedupeCompetitors,
  detectContamination,
  matchesExclusionTerm,
  includedTypesForSector,
  GOOGLE_TYPES_BY_SECTOR,
};
