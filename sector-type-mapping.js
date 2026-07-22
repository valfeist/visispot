/**
 * Visispot - Table de correspondance secteur -> types de commerce
 * Source Google : Places API (New), Table A, à jour au 29/06/2026.
 * Source OSM : tags shop / amenity / craft / leisure.
 *
 * PERIMETRE MVP : 10 secteurs.
 * (services_personne retiré ; pressing scindé en pressing + laverie ; retouche ajouté.)
 *
 * PRINCIPE DE CLASSIFICATION
 * 1. Un lieu est classé par son `primaryType` (API New). On retombe sur `types[]`
 *    seulement si `primaryType` est absent.
 * 2. Un lieu est retenu comme concurrent d'un secteur si son primaryType est dans
 *    `google_include` ET n'est PAS dans `google_exclude`.
 * 3. `google_exclude` sert à trancher les recouvrements entre secteurs voisins.
 * 4. `name_include` / `name_exclude` désambiguïsent quand Google renvoie un type
 *    ambigu (cas `laundry`, qui couvre à la fois pressing et laverie).
 * 5. Chaque concurrent est compté une seule fois. Dédupliquer par place_id, puis
 *    par proximité nom + coordonnées (< 25 m).
 *
 * PAIRES / FAMILLES MUTUELLEMENT EXCLUSIVES (à garder cohérentes) :
 *   coiffure       <-> beaute
 *   restauration   <-> snacking
 *   epicerie_fine  <-> caviste   (le vin est du ressort du caviste)
 *   pressing <-> laverie <-> retouche   (famille "entretien du vêtement" :
 *     un même point de vente peut cumuler les trois. Classer sur le tag OSM
 *     ou le primaryType, et ne compter qu'une fois.)
 *
 * GARDE-FOU AUTOMATIQUE (à logger sur TOUS les secteurs) :
 *   Pour chaque concurrent renvoyé, journaliser `primaryType` et `types[]` bruts.
 *   Signaler tout concurrent dont le primaryType n'est pas dans google_include :
 *   c'est le détecteur de contamination catégorielle, cross-secteur, sans revue manuelle.
 */

const SECTOR_TYPE_MAPPING = {

  boulangerie: {
    radius_primary: 400, radius_secondary: 600,
    google_include: ["bakery", "pastry_shop", "cake_shop"],
    // Corrige le bleed observé (cafés comptés en boulangerie : Miah Café, soleï café...)
    google_exclude: ["cafe", "coffee_shop", "coffee_stand", "restaurant",
                     "fast_food_restaurant", "sandwich_shop", "brunch_restaurant",
                     "breakfast_restaurant", "ice_cream_shop", "confectionery",
                     "chocolate_shop"],
    osm_include: ["shop=bakery", "shop=pastry"],
    osm_exclude: ["amenity=cafe", "shop=confectionery", "shop=chocolate"],
    legacy_note: "OK en legacy : bakery existe. Le bleed venait des cafés, à exclure via primaryType.",
  },

  restauration: {
    radius_primary: 500, radius_secondary: 700,
    // Règle pratique : tout primaryType finissant par `_restaurant` + la liste ci-dessous,
    // SAUF les types snacking (voir google_exclude). Ne pas énumérer les ~90 cuisines.
    google_include: ["restaurant", "fine_dining_restaurant", "bistro", "diner",
                     "buffet_restaurant", "cafeteria", "bar_and_grill", "gastropub",
                     "MATCH:*_restaurant"],
    google_exclude: ["fast_food_restaurant", "meal_takeaway", "meal_delivery",
                     "sandwich_shop", "snack_bar", "hot_dog_stand", "hot_dog_restaurant",
                     "kebab_shop", "food_court", "cafe", "coffee_shop", "bakery",
                     "bar", "pub", "wine_bar"],
    osm_include: ["amenity=restaurant"],
    osm_exclude: ["amenity=fast_food", "amenity=cafe", "amenity=food_court"],
    legacy_note: "En legacy : seul `restaurant` existe (pas de distinction fast-food). " +
                 "La séparation restauration/snacking exige l'API New ou une heuristique de nom.",
    arbitrable: "pizza_restaurant et hamburger_restaurant : assis (ici) ou rapide (snacking) selon ta règle produit.",
  },

  snacking: {
    radius_primary: 500, radius_secondary: 700,
    google_include: ["fast_food_restaurant", "sandwich_shop", "kebab_shop",
                     "hot_dog_stand", "hot_dog_restaurant", "salad_shop", "snack_bar",
                     "food_court", "meal_takeaway", "bagel_shop", "juice_shop", "acai_shop"],
    google_exclude: ["restaurant", "fine_dining_restaurant", "MATCH:*_restaurant",
                     "bakery", "bar", "pub"],
    osm_include: ["amenity=fast_food", "amenity=food_court"],
    osm_exclude: ["amenity=restaurant"],
    legacy_note: "En legacy : approximable via `meal_takeaway`, mais fast_food_restaurant n'existe pas.",
  },

  coiffure: {
    radius_primary: 600, radius_secondary: 900,
    google_include: ["hair_salon", "barber_shop", "hair_care"],
    // Coeur du bug confirmé : ne PAS laisser entrer beauté / ongles / spa / sourcils.
    google_exclude: ["beauty_salon", "nail_salon", "spa", "massage", "massage_spa",
                     "skin_care_clinic", "body_art_service", "makeup_artist",
                     "beautician", "cosmetics_store", "tanning_studio", "foot_care"],
    osm_include: ["shop=hairdresser", "craft=hairdresser"],
    osm_exclude: ["shop=beauty", "shop=cosmetics", "shop=massage", "leisure=spa"],
    name_denylist: ["institut", "sourcil", "ongle", "nail", "spa", "esthétique",
                    "beauté", "massage", "épilation"],
    legacy_note: "IMPOSSIBLE en legacy (hair_care et beauty_salon seulement, pas de barbier/onglerie). " +
                 "Séparation coiffure/beauté = API New obligatoire.",
    classify_by: "primaryType",
    tie_break: "Si un lieu a hair_salon ET beauty_salon, classer sur le primaryType. " +
               "En cas d'égalité, compter une fois et ne l'attribuer qu'au secteur sélectionné par l'utilisateur.",
  },

  beaute: {
    radius_primary: 600, radius_secondary: 900,
    // foot_care et body_art_service consolidés ici (retrait de services_personne).
    google_include: ["beauty_salon", "nail_salon", "skin_care_clinic", "spa",
                     "massage_spa", "makeup_artist", "beautician", "body_art_service",
                     "cosmetics_store", "tanning_studio", "foot_care"],
    google_exclude: ["hair_salon", "barber_shop", "hair_care", "massage",
                     "physiotherapist", "doctor", "dermatologist"],
    osm_include: ["shop=beauty", "shop=cosmetics", "leisure=spa", "shop=tattoo"],
    osm_exclude: ["shop=hairdresser", "craft=hairdresser"],
    legacy_note: "En legacy : beauty_salon + spa seulement. Onglerie et sourcils non séparables.",
    classify_by: "primaryType",
  },

  epicerie_fine: {
    radius_primary: 700, radius_secondary: 1000,
    google_include: ["grocery_store", "deli", "food_store", "health_food_store",
                     "butcher_shop", "chocolate_shop", "confectionery", "tea_store",
                     "asian_grocery_store"],
    // Ne PAS compter la grande distribution comme concurrente d'une épicerie fine.
    google_exclude: ["supermarket", "hypermarket", "discount_supermarket",
                     "discount_store", "convenience_store", "warehouse_store",
                     "general_store", "department_store", "liquor_store"],
    osm_include: ["shop=deli", "shop=grocery", "shop=greengrocer", "shop=cheese",
                  "shop=chocolate", "shop=confectionery", "shop=tea", "shop=health_food"],
    osm_exclude: ["shop=supermarket", "shop=convenience", "shop=wine"],
    legacy_note: "En legacy : `grocery_or_supermarket` mélange épicerie fine et supermarché. " +
                 "Distinction fiable seulement en API New ou via OSM.",
  },

  caviste: {
    radius_primary: 700, radius_secondary: 1000,
    google_include: ["liquor_store"], // Google n'a pas de type dédié "caviste".
    google_exclude: ["supermarket", "hypermarket", "convenience_store",
                     "grocery_store", "bar", "wine_bar", "pub"],
    osm_include: ["shop=wine", "shop=alcohol"],
    osm_exclude: ["shop=supermarket", "amenity=bar", "amenity=pub"],
    legacy_note: "OK en legacy : liquor_store existe.",
    arbitrable: "wine_bar (bar à vin) : adjacent mais non retail. Exclu par défaut, à réintégrer si tu le veux.",
  },

  // --- Famille "entretien du vêtement" : pressing / laverie / retouche -------------
  // Google range pressing ET laverie sous le même type `laundry` : il ne les sépare
  // PAS. OSM les distingue (dry_cleaning vs laundry). => OSM est la source de vérité
  // pour cette famille ; côté Google, on désambiguïse par le nom, et si ni le tag OSM
  // ni le nom ne tranchent, marquer `laundry_unclassified` plutôt que forcer un bucket.

  pressing: {
    radius_primary: 600, radius_secondary: 800,
    google_include: ["laundry"],
    google_exclude: [],
    name_include: ["pressing", "à sec", "nettoyage à sec", "teinturerie", "5àsec", "5 à sec"],
    name_exclude: ["laverie", "lavomatic", "libre service", "libre-service", "self", "wash"],
    osm_include: ["shop=dry_cleaning"],
    osm_exclude: ["shop=laundry"],
    source_priority: "osm", // le tag OSM tranche ; nom = repli côté Google
    legacy_note: "Google ne sépare pas pressing et laverie (tous deux `laundry`). Voir source_priority.",
  },

  laverie: {
    radius_primary: 400, radius_secondary: 600, // catchment plus serré qu'un pressing (arbitrable)
    google_include: ["laundry"],
    google_exclude: [],
    name_include: ["laverie", "lavomatic", "libre service", "libre-service", "self", "wash", "speed queen"],
    name_exclude: ["pressing", "à sec", "teinturerie", "retouche"],
    osm_include: ["shop=laundry"],
    osm_exclude: ["shop=dry_cleaning"],
    source_priority: "osm",
    legacy_note: "Même remarque que pressing : indissociable via le seul type Google `laundry`.",
  },

  retouche: {
    radius_primary: 600, radius_secondary: 800, // hérité de l'ancien pressing (arbitrable)
    google_include: ["tailor"],
    google_exclude: ["laundry", "clothing_store", "hair_salon"],
    osm_include: ["shop=tailor", "craft=tailor", "craft=dressmaker"],
    osm_exclude: ["shop=dry_cleaning", "shop=laundry", "shop=clothes"],
    legacy_note: "`tailor` n'existe PAS dans l'API legacy. Retouche = API New (Google) ou OSM.",
    overlap_note: "Beaucoup de pressings font aussi la retouche : un même lieu peut être pressing ET tailor. " +
                  "Classer sur le primaryType, compter une fois dans la famille entretien du vêtement.",
  },

};

/**
 * Helper de classification (esquisse).
 * MATCH:*_restaurant = tout primaryType se terminant par "_restaurant".
 * Pour la famille entretien du vêtement : si le lieu vient d'OSM, le tag suffit
 * (source_priority = "osm") ; s'il vient de Google avec primaryType `laundry`,
 * on applique name_include / name_exclude ; sinon -> non classé.
 */
function matchesSector(place, sectorKey) {
  const cfg = SECTOR_TYPE_MAPPING[sectorKey];
  const primary = place.primaryType || (place.types && place.types[0]) || "";
  const name = (place.displayName || "").toLowerCase();

  const ruleHits = (rule) =>
    rule.startsWith("MATCH:")
      ? primary.endsWith(rule.slice(6).replace("*", ""))
      : rule === primary;

  if (cfg.google_exclude.some(ruleHits)) return false;
  if (!cfg.google_include.some(ruleHits)) return false;

  // Désambiguïsation par nom (pressing vs laverie sur type `laundry`)
  if (cfg.name_exclude && cfg.name_exclude.some(w => name.includes(w))) return false;
  if (cfg.name_include && !cfg.name_include.some(w => name.includes(w))) {
    // type inclus mais nom non confirmé : ne pas forcer le bucket
    return false; // -> à traiter en amont comme laundry_unclassified
  }

  // Garde-fou de contamination (secteurs à name_denylist, ex. coiffure)
  if (cfg.name_denylist && cfg.name_denylist.some(w => name.includes(w))) return false;

  return true;
}

module.exports = { SECTOR_TYPE_MAPPING, matchesSector };
