/**
 * Visispot - Table de correspondance secteur -> types de commerce
 * Source Google : Places API (New), Table A, à jour au 29/06/2026.
 * Source OSM : tags shop / amenity / craft / leisure.
 *
 * PERIMETRE MVP : 13 secteurs, regroupés en 4 familles (formulaire à 2 niveaux).
 * (services_personne retiré ; pressing scindé en pressing + laverie ; retouche ajouté ;
 *  puis cafe, boucherie, fleuriste.)
 *
 * FAMILIES (level 1 of the form; the sector key stays the level-2 value):
 *   Restauration & café  : restauration, snacking, cafe
 *   Commerce de bouche   : boulangerie, boucherie, epicerie_fine, caviste
 *   Beauté & soin        : coiffure, beaute
 *   Services du quotidien: pressing, laverie, retouche, fleuriste
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
 *   restauration   <-> snacking <-> cafe   (café/salon de thé séparé du service
 *     à table et du snacking ; l'économie de nuit — bar/pub/wine_bar — est exclue
 *     de `cafe`, elle n'est dans aucun secteur du périmètre.)
 *   epicerie_fine  <-> caviste   (le vin est du ressort du caviste)
 *   epicerie_fine  <-> boucherie   (métiers de bouche spécialisés : chacun a son
 *     propre competitor set. L'épicerie fine ne compte PLUS le boucher comme
 *     concurrent direct. Son `name_denylist` écarte aussi primeur / fromagerie /
 *     poissonnerie, qui restent des métiers distincts même sans secteur dédié.)
 *   pressing <-> laverie <-> retouche   (famille "entretien du vêtement" :
 *     un même point de vente peut cumuler les trois. Classer sur le tag OSM
 *     ou le primaryType, et ne compter qu'une fois.)
 *
 * TRADES DELIBERATELY OUT OF SCOPE (deferred, see note below)
 *   primeur, fromagerie, poissonnerie and cordonnerie are NOT sectors here.
 *   Verified against Places API (New) Table A: there is NO type for a cobbler,
 *   a greengrocer, a cheese shop, or a retail fishmonger (`seafood_restaurant`
 *   is a restaurant, not retail).
 *
 *   A first attempt discovered them through BROAD Nearby Search types
 *   (grocery_store / food_store / market / shoe_store) and filtered by name.
 *   A live run on Marché des Capucins in Bordeaux — the densest food-trade spot
 *   in the city — returned ZERO competitors for all four: Nearby Search caps at
 *   20 results ranked by prominence, so Lidl, Carrefour City and the market hall
 *   itself fill the list and the specialised shops never appear to be filtered.
 *   fromagerie and poissonnerie even returned the exact same 20 places.
 *
 *   PROVEN path for a future task: `places:searchText` with a keyword and a
 *   location bias finds them reliably (Fromagerie Deruelle, Poissonnerie Paon,
 *   Ambre primeurs, Cordonnerie des Capucins), returning primaryType food_store /
 *   store / market / service. It needs a SECOND search mode in
 *   competitor-search.js, hence the deferral. OSM (shop=cheese, greengrocer,
 *   seafood, shoe_repair) is the free alternative, still untested.
 *
 *   Note: epicerie_fine keeps these trades OUT of its competitor set (see its
 *   name_denylist and osm_exclude) even though they have no sector of their own:
 *   they are distinct trades, not fine-grocery competitors.
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
    // NOTE: `MATCH:*_restaurant` must NOT be listed here. google_exclude is
    // evaluated BEFORE google_include, and the wildcard matched this sector's own
    // core types (fast_food_restaurant, hot_dog_restaurant), which silently
    // evicted every fast-food competitor. Sit-down types are already excluded
    // explicitly below, and any other *_restaurant type is rejected anyway by
    // simply not being in google_include.
    google_exclude: ["restaurant", "fine_dining_restaurant",
                     "bakery", "bar", "pub", "cafe", "coffee_shop", "tea_house"],
    osm_include: ["amenity=fast_food", "amenity=food_court"],
    osm_exclude: ["amenity=restaurant"],
    legacy_note: "En legacy : approximable via `meal_takeaway`, mais fast_food_restaurant n'existe pas.",
  },

  // Café / coffee shop / salon de thé. Deliberately excludes the licensed night
  // economy (bar, pub, wine_bar, night_club): different business model, different
  // catchment. Reciprocity is already in place — boulangerie and restauration
  // both reject cafe/coffee_shop.
  cafe: {
    radius_primary: 400, radius_secondary: 600,
    google_include: ["cafe", "coffee_shop", "coffee_stand", "tea_house"],
    google_exclude: ["bar", "pub", "wine_bar", "night_club", "bakery",
                     "restaurant", "fine_dining_restaurant", "fast_food_restaurant",
                     "MATCH:*_restaurant", "ice_cream_shop", "meal_takeaway"],
    osm_include: ["amenity=cafe"],
    osm_exclude: ["amenity=bar", "amenity=pub", "amenity=restaurant",
                  "amenity=fast_food", "shop=bakery"],
    legacy_note: "OK en legacy : `cafe` existe. Le salon de thé (`tea_house`) est " +
                 "API New uniquement ; en legacy il retombe sur `cafe`.",
    arbitrable: "Un café qui sert des repas le midi peut relever de restauration. " +
                "Tranché ici sur le primaryType.",
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
    // Decontaminated: butcher_shop moved out to `boucherie`; shop=greengrocer to
    // `primeur`; shop=cheese to `fromagerie`. A specialised food trade is no
    // longer a direct competitor of a fine grocery.
    google_include: ["grocery_store", "deli", "food_store", "health_food_store",
                     "chocolate_shop", "confectionery", "tea_store",
                     "asian_grocery_store"],
    // Ne PAS compter la grande distribution comme concurrente d'une épicerie fine.
    // Reciprocal excludes for the specialised bouche sectors added below.
    google_exclude: ["supermarket", "hypermarket", "discount_supermarket",
                     "discount_store", "convenience_store", "warehouse_store",
                     "general_store", "department_store", "liquor_store",
                     "butcher_shop", "seafood_restaurant"],
    osm_include: ["shop=deli", "shop=grocery", "shop=chocolate",
                  "shop=confectionery", "shop=tea", "shop=health_food"],
    osm_exclude: ["shop=supermarket", "shop=convenience", "shop=wine",
                  "shop=butcher", "shop=greengrocer", "shop=cheese", "shop=seafood"],
    // A place explicitly named as a specialised trade belongs to that trade, even
    // when Google types it loosely as grocery_store/food_store. Reuses the existing
    // name_denylist mechanism (no helper change needed).
    name_denylist: ["boucherie", "charcuterie", "poissonnerie", "primeur",
                    "fromagerie", "crémerie", "cremerie"],
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

  // --- Specialised food trade split out of epicerie_fine -------------------------
  // Only boucherie made it in: it is the one specialised trade with a dedicated
  // Google type. See the header note for why primeur / fromagerie / poissonnerie
  // are deferred.

  boucherie: {
    radius_primary: 500, radius_secondary: 800,
    google_include: ["butcher_shop"],
    // Delis are explicitly NOT competitors of a butcher (product and trade differ).
    google_exclude: ["deli", "grocery_store", "food_store", "supermarket",
                     "hypermarket", "convenience_store", "restaurant",
                     "MATCH:*_restaurant", "fast_food_restaurant"],
    osm_include: ["shop=butcher"],
    osm_exclude: ["shop=deli", "shop=supermarket", "shop=convenience"],
    legacy_note: "OK en legacy : butcher_shop existe (Table A). Aucun type ne " +
                 "distingue le rayon boucherie d'une GMS — voir overlap_note.",
    overlap_note: "Les rayons boucherie de la grande distribution captent une part " +
                  "réelle du marché, mais aucun type Google ne les isole (un " +
                  "supermarket est typé comme tel en entier). Ils ne sont donc PAS " +
                  "comptés dans les concurrents directs. À arbitrer si tu veux les " +
                  "réintégrer comme signal séparé.",
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

  fleuriste: {
    radius_primary: 600, radius_secondary: 900,
    google_include: ["florist"],
    google_exclude: ["supermarket", "hypermarket", "convenience_store",
                     "home_improvement_store", "garden_center", "gift_shop",
                     "funeral_home", "grocery_store"],
    osm_include: ["shop=florist"],
    osm_exclude: ["shop=garden_centre", "shop=doityourself", "shop=supermarket"],
    legacy_note: "OK en legacy : `florist` existe.",
    arbitrable: "Jardineries et rayons fleurs de GMS exclus par défaut " +
                "(modèle et assortiment différents).",
  },

};

/**
 * Helper de classification (esquisse).
 * MATCH:*_restaurant = tout primaryType se terminant par "_restaurant".
 * Pour la famille entretien du vêtement : si le lieu vient d'OSM, le tag suffit
 * (source_priority = "osm") ; s'il vient de Google avec primaryType `laundry`,
 * on applique name_include / name_exclude ; sinon -> non classé.
 *
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
