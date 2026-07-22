// This list is manually maintained and will grow
// with each report delivered.
// When a false positive or chain is found during
// manual P4 review, add it here immediately.
// Format: { name, category, reason }
// Names are lowercase, partial match is applied.
//
// Order matters: list more specific entries before generic ones
// (e.g. "monoprix gourmet" before "monoprix"), because the first
// matching entry wins.

// Small helpers to keep each entry to { name, category, reason }.
const chain = (name, reason) => ({ name, category: "chain", reason });
const falsePositive = (name, reason) => ({ name, category: "false_positive", reason });

// --- Shared lists for grouped sectors ---------------------------------

const BAKERY_EXCLUSIONS = [
  // chains (same product, industrial model)
  chain("la mie câline", "Industrial bakery chain"),
  chain("brioche dorée", "Industrial bakery chain"),
  chain("paul", "Industrial bakery chain"),
  chain("bagelstein", "Bagel chain"),
  chain("bagel corner", "Bagel chain"),
  chain("baillardran", "Regional bakery franchise"),
  // false positives (tagged "bakery" but not a direct competitor)
  falsePositive("carrefour", "Supermarket with bread section"),
  falsePositive("intermarché", "Supermarket with bread section"),
  falsePositive("leclerc", "Supermarket with bread section"),
  falsePositive("aldi", "Supermarket with bread section"),
  falsePositive("lidl", "Supermarket with bread section"),
  falsePositive("monoprix", "Supermarket with bread section"),
  falsePositive("franprix", "Supermarket with bread section"),
  falsePositive("casino", "Supermarket with bread section"),
  falsePositive("simply market", "Supermarket with bread section"),
  falsePositive("super u", "Supermarket with bread section"),
  falsePositive("hyper u", "Supermarket with bread section"),
  falsePositive("spar", "Supermarket with bread section"),
  falsePositive("match", "Supermarket with bread section"),
  falsePositive("subway", "Sandwich chain, not a bakery"),
  falsePositive("mcdonald", "Fast-food chain, not a bakery"),
  falsePositive("burger king", "Fast-food chain, not a bakery"),
  falsePositive("quick", "Fast-food chain, not a bakery"),
  falsePositive("cookie", "Cookie shop, adjacent concept"),
  falsePositive("cupcake", "Cupcake shop, adjacent concept"),
  falsePositive("macarons usine", "Industrial macaron outlet"),
  falsePositive("food truck", "Food truck, not a fixed bakery"),
];

const RESTAURANT_EXCLUSIONS = [
  // chains
  chain("mcdonald", "Fast-food chain"),
  chain("burger king", "Fast-food chain"),
  chain("kfc", "Fast-food chain"),
  chain("quick", "Fast-food chain"),
  chain("five guys", "Burger chain"),
  chain("o'tacos", "Fast-food chain"),
  chain("kebab istanbul", "Generic kebab chain name"),
  chain("subway", "Sandwich chain"),
  chain("domino", "Pizza chain"),
  chain("pizza hut", "Pizza chain"),
  chain("speed rabbit", "Pizza delivery chain"),
  chain("leon", "Seafood fast-casual chain"),
  chain("eat", "Fast-casual chain"),
  chain("prêt à manger", "Fast-casual chain"),
  chain("hippopotamus", "Steakhouse chain"),
  chain("courtepaille", "Grill chain"),
  chain("buffalo grill", "Steakhouse chain"),
  // false positives
  falsePositive("supermarché", "Supermarket, not a restaurant"),
  falsePositive("brasserie hôtel", "Hotel brasserie"),
  falsePositive("cafétéria entreprise", "Corporate cafeteria"),
  falsePositive("restaurant d'entreprise", "Corporate restaurant"),
  falsePositive("cantine", "Canteen"),
  falsePositive("food court", "Food court"),
];

const HAIR_BEAUTY_EXCLUSIONS = [
  // chains
  chain("jean-louis david", "Hair salon chain"),
  chain("saint algue", "Hair salon chain"),
  chain("franck provost", "Hair salon chain"),
  chain("great clips", "Hair salon chain"),
  chain("coiff&co", "Hair salon chain"),
  chain("tchip", "Hair salon chain"),
  chain("diloy's", "Hair salon chain"),
  chain("fabio salsa", "Hair salon chain"),
  chain("dessange", "Hair salon chain"),
  chain("camille albane", "Hair salon chain"),
  chain("yves rocher", "Beauty/cosmetics chain"),
  chain("l'occitane", "Beauty/cosmetics chain"),
  chain("body shop", "Beauty/cosmetics chain"),
  chain("sephora", "Cosmetics retail chain"),
  chain("marionnaud", "Cosmetics retail chain"),
  chain("nocibé", "Cosmetics retail chain"),
  chain("kiko", "Cosmetics retail chain"),
  // false positives
  falsePositive("pressing", "Dry cleaner, different sector"),
  falsePositive("laverie", "Laundromat, different sector"),
  falsePositive("spa hôtel", "Hotel spa"),
  falsePositive("institut médical", "Medical institute"),
  falsePositive("dermatologue", "Dermatologist"),
];

const DELI_WINE_EXCLUSIONS = [
  // chains (specific "monoprix gourmet" listed before generic "monoprix" below)
  chain("monoprix gourmet", "Upscale grocery chain"),
  chain("nicolas", "Wine retail chain"),
  chain("cave augé", "Wine retail franchise"),
  chain("biocoop", "Organic grocery chain"),
  chain("naturalia", "Organic grocery chain"),
  chain("la vie claire", "Organic grocery chain"),
  chain("day by day", "Bulk grocery chain"),
  chain("biomonde", "Organic grocery chain"),
  // false positives
  falsePositive("carrefour", "Supermarket"),
  falsePositive("leclerc", "Supermarket"),
  falsePositive("intermarché", "Supermarket"),
  falsePositive("aldi", "Supermarket"),
  falsePositive("lidl", "Supermarket"),
  falsePositive("simply market", "Supermarket"),
  falsePositive("franprix", "Supermarket"),
  falsePositive("casino", "Supermarket"),
  falsePositive("monoprix", "Supermarket (non-gourmet)"),
  falsePositive("superette", "Convenience store"),
  falsePositive("épicerie de nuit", "Late-night convenience store"),
];

const PERSONAL_SERVICES_EXCLUSIONS = [
  // chains
  chain("5àsec", "Dry cleaning chain"),
  chain("mister minit", "Shoe repair / key cutting chain"),
  chain("press'in", "Dry cleaning chain"),
  chain("lavomatic", "Laundromat franchise"),
  chain("speed rabbit pressing", "Dry cleaning chain"),
  // false positives
  falsePositive("laverie automatique", "Self-service laundromat"),
  falsePositive("blanchisserie industrielle", "Industrial laundry"),
  falsePositive("teinturerie hôtel", "Hotel dry cleaning"),
  falsePositive("cordonnerie grande surface", "Big-box shoe repair"),
];

// --- Mapping: form sector value -> exclusion list ---------------------
// Keys are the French form sector values; grouped sectors share a list.

const EXCLUSION_LISTS = {
  boulangerie: BAKERY_EXCLUSIONS,
  restauration: RESTAURANT_EXCLUSIONS,
  snacking: RESTAURANT_EXCLUSIONS,
  coiffure: HAIR_BEAUTY_EXCLUSIONS,
  beaute: HAIR_BEAUTY_EXCLUSIONS,
  epicerie_fine: DELI_WINE_EXCLUSIONS,
  caviste: DELI_WINE_EXCLUSIONS,
  pressing: PERSONAL_SERVICES_EXCLUSIONS,
  laverie: PERSONAL_SERVICES_EXCLUSIONS,
  retouche: PERSONAL_SERVICES_EXCLUSIONS,
};

module.exports = { EXCLUSION_LISTS };
