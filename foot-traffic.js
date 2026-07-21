/**
 * PIPELINE STEP 7 — Foot-traffic proxy (BestTime)
 * -----------------------------------------------
 * Estimates the RELATIVE footfall intensity of the street by averaging
 * the popular-times forecasts of neighbouring venues. Output is always
 * QUALITATIVE (Faible / Moyenne / Élevée) — never an absolute count.
 *
 * Data source: BestTime API (metered — ~2 credits per venue).
 * Requires a private API key from https://besttime.app/
 *
 * Run with:  node foot-traffic.js
 */

require("./load-env");

const BESTTIME_FORECAST_URL = "https://besttime.app/api/v1/forecasts";
const BESTTIME_API_KEY_PRIVATE = process.env.BESTTIME_API_KEY_PRIVATE;

// Below this many venues with data, the proxy is not reliable (brief rule).
const MIN_VENUES_FOR_PROXY = 3;

// BestTime's day_raw arrays start at 06:00 (verified: index 0 = 06h),
// so a given array index maps to hour = (6 + index) mod 24.
const DAY_RAW_START_HOUR = 6;

// =====================================================================
// BLOCK 1 — Fetch one venue's foot-traffic forecast
// =====================================================================
// Returns a 24-value hourly profile averaged over the week, or null if
// BestTime has no foot-traffic data for that venue.

async function fetchVenueForecast(name, address) {
  const params = new URLSearchParams({
    api_key_private: BESTTIME_API_KEY_PRIVATE,
    venue_name: name,
    venue_address: address,
  });

  const response = await fetch(`${BESTTIME_FORECAST_URL}?${params}`, {
    method: "POST",
  });
  const data = await response.json();

  // No usable forecast (venue unknown / no foot-traffic data).
  if (!response.ok || data.status !== "OK" || !Array.isArray(data.analysis)) {
    return null;
  }

  // Average the 24 hourly values across the available days.
  const hourlySum = new Array(24).fill(0);
  let dayCount = 0;
  for (const day of data.analysis) {
    const raw = day.day_raw;
    if (!Array.isArray(raw) || raw.length !== 24) continue;
    for (let h = 0; h < 24; h++) hourlySum[h] += raw[h];
    dayCount += 1;
  }
  if (dayCount === 0) return null;

  const hourlyMean = hourlySum.map((s) => s / dayCount);
  return {
    name,
    hourlyMean, // index = hour of day (0–23), values ~0–100
  };
}

// =====================================================================
// BLOCK 2 — Aggregate neighbouring venues into a street-level proxy
// =====================================================================

// Maps a peak intensity (0–100) to the qualitative scale used in the report.
function intensityLabel(peakValue) {
  if (peakValue >= 66) return "Élevée";
  if (peakValue >= 33) return "Moyenne";
  return "Faible";
}

// Formats a peak hour index into a readable 2-hour window.
function peakWindow(hourIndex) {
  const pad = (h) => String((h + 24) % 24).padStart(2, "0");
  return `${pad(hourIndex)}h–${pad(hourIndex + 1)}h`;
}

async function getFootTrafficProxy(venues) {
  const profiles = [];
  for (const venue of venues) {
    const profile = await fetchVenueForecast(venue.name, venue.address);
    if (profile) profiles.push(profile);
  }

  // Brief rule: fewer than 3 venues with data => signal "insuffisant".
  if (profiles.length < MIN_VENUES_FOR_PROXY) {
    return {
      source: "BestTime",
      quality: "insuffisant",
      venuesQueried: venues.length,
      venuesWithData: profiles.length,
      intensity: null,
      peak: null,
      note: "Moins de 3 lieux voisins avec données : estimation de flux non fiable, à formuler qualitativement.",
    };
  }

  // Street profile = average hourly intensity across venues.
  const streetProfile = new Array(24).fill(0);
  for (const p of profiles) {
    for (let h = 0; h < 24; h++) streetProfile[h] += p.hourlyMean[h];
  }
  for (let h = 0; h < 24; h++) streetProfile[h] /= profiles.length;

  // Peak hour = highest average intensity.
  let peakHour = 0;
  for (let h = 1; h < 24; h++) {
    if (streetProfile[h] > streetProfile[peakHour]) peakHour = h;
  }
  const peakValue = streetProfile[peakHour];
  // Convert the array index to a real hour of day (06:00-based).
  const peakHourOfDay = (DAY_RAW_START_HOUR + peakHour) % 24;

  return {
    source: "BestTime",
    quality: "complete",
    venuesQueried: venues.length,
    venuesWithData: profiles.length,
    intensity: intensityLabel(peakValue),
    peak: { window: peakWindow(peakHourOfDay), relativeLevel: Math.round(peakValue) },
    venues: profiles.map((p) => p.name),
  };
}

// =====================================================================
// BLOCK 3 — Run directly on a few real venues near the test address
// =====================================================================

if (require.main === module) {
  // Small fixed sample to limit credit usage during testing.
  const neighbouringVenues = [
    { name: "Miah Café", address: "71 Rue Judaïque, 33000 Bordeaux" },
    { name: "Chouette Pâtisserie", address: "71 Rue Judaïque, 33000 Bordeaux" },
    { name: "GRAIN Boulangerie & Patisserie", address: "43 Rue Capdeville, 33000 Bordeaux" },
    { name: "Carrefour City", address: "8 Rue Judaïque, 33000 Bordeaux" },
  ];

  (async () => {
    const result = await getFootTrafficProxy(neighbouringVenues);
    console.log(JSON.stringify(result, null, 2));
  })().catch((error) => {
    console.error("ERROR:", error.message);
    process.exit(1);
  });
}

module.exports = { getFootTrafficProxy, fetchVenueForecast };
