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
  services_personne: ["laundry"],
};

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
// BLOCK 5c — Competitor classification
// =====================================================================
// Sorts Google results into three groups using the sector exclusion
// list. Each list entry is { name, category, reason }; matching is a
// lowercase partial (substring) match, first match wins:
//   - no match              -> direct   (independent same-sector)
//   - category "chain"      -> chain    (franchise / industrial model)
//   - category "false_positive" -> filteredOut (technical false positive)
// Matched items keep the matched term + reason for the manual P4 review.

function classifyCompetitors(competitors, exclusionEntries) {
  const direct = [];
  const chain = [];
  const filteredOut = [];
  for (const competitor of competitors) {
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
          "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus,places.location,places.regularOpeningHours",
      },
      body: JSON.stringify({
        includedTypes: googleTypes,
        maxResultCount: 20,
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
  return places.map(formatCompetitor);
}

// =====================================================================
// BLOCK 6 — Orchestrator: geocode then run both searches
// =====================================================================

async function main() {
  // 6.0 — Load the market configuration at startup (defaults to "FR").
  const { market, config: marketConfig } = getMarketConfig(order.market);

  // 6.1 — Translate the form sector into Google types.
  const googleTypes = GOOGLE_TYPES_BY_SECTOR[order.businessType];
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

  // 6.6 — Classify competitors (direct / chain / false positive), then build blocks.
  const primaryClassified = classifyCompetitors(primaryCompetitors, exclusionEntries);
  const secondaryClassified = classifyCompetitors(secondaryCompetitors, exclusionEntries);
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
  classifyCompetitors,
  matchesExclusionTerm,
  GOOGLE_TYPES_BY_SECTOR,
};
