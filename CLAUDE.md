# VisiSpot — Outil d'analyse d'emplacement commercial (MVP)

Génère un **rapport PDF d'analyse d'emplacement** pour un commerçant indépendant : à partir d'une adresse + d'un type de commerce, le pipeline collecte des données (concurrence, démographie, flux, densité, dynamique commerciale…), calcule un **score déterministe**, fait rédiger les textes par Claude, et produit un **rapport HTML** prêt à imprimer en PDF, avec un verdict **VIABLE / NON VIABLE**.

MVP **semi-manuel** : génération en une commande, PDF produit par impression navigateur. Voir le brief produit complet dans `~/Downloads/Brief_Produit_MVP_Analyse_Emplacement_V2.md`.

## Environnement

- **Node.js v20.19** (utilise `fetch` natif et `process.loadEnvFile`).
- **Zéro dépendance npm** — pas de `package.json`, pas de `node_modules`. Tous les appels API se font en `fetch` brut ; géométrie, CSV et tests faits maison (décision d'architecture maintenue tout au long du projet).
- macOS, shell zsh.

## Lancer une analyse

```bash
node assemble-report.js "<adresse complète>" <secteur> [surface_m2] [loyer_mensuel]
```

Exemples :
```bash
node assemble-report.js                                                  # défaut : 65 Rue Judaïque, Bordeaux, boulangerie
node assemble-report.js "12 Rue de la Roquette, 75011 Paris, France" restauration
node assemble-report.js "10 Rue Sainte-Catherine, 33000 Bordeaux, France" coiffure 60 1800
```

- **Périmètre MVP : 17 secteurs**, groupés en 4 familles (formulaire à 2 niveaux prévu) :
  - *Restauration & café* : `restauration · snacking · cafe`
  - *Commerce de bouche* : `boulangerie · boucherie · poissonnerie · primeur · fromagerie · epicerie_fine · caviste`
  - *Beauté & soin* : `coiffure · beaute`
  - *Services du quotidien* : `pressing · laverie · retouche · cordonnerie · fleuriste`
  Un secteur inconnu → erreur immédiate avec la liste. Une **assertion au démarrage** (`sector-keys.js`) échoue bruyamment si les jeux de clés divergent (voir P0.4 ci-dessous).
- Sortie : `output/<YYYY-MM-DD_adresse-slug>/report.html` + 3 cartes PNG + `report-data.json`. Ouvrir le HTML → Cmd+P → « Enregistrer en PDF ».
- ~30-60 s et ~0,06 € d'API LLM par rapport. Le géocodage Google exige que l'IP sortante soit autorisée sur la clé (restriction IP possible côté Google Cloud).

### Itérer sur le template sans rappeler les APIs

```bash
node rebuild-report.js [<nom-du-dossier-rapport>]   # reconstruit report.html depuis report-data.json (gratuit, instantané)
```

### Tests (offline, zéro-dépendance, gratuits)

```bash
node test/score.test.js              # scoreur déterministe
node test/bodacc.test.js             # fenêtre BODACC ancrée au mois
node test/competitor-classify.test.js# filtrage/dédup/contamination concurrents
node test/sector-keys.test.js        # cohérence des clés secteur
node test/iris-weight.test.js        # pondération surfacique IRIS
```
45 tests au total, `node:assert`, sans réseau ni clé. Chaque module a aussi un lanceur `if (require.main === module)` (souvent sur l'adresse de Bordeaux) pour test isolé : `node competitor-search.js`, `commercial-dynamics.js`, `iris-geometry.js`, `scoring.js`, etc. La rédaction LLM par page : `node llm-synthesis.js <p1|p4|p5|p6>`.

## Clés API (toutes dans `.env`)

Convention : **jamais en dur dans le code**, lues via `process.env`, chargées par `load-env.js` (requis en tête des fichiers). Voir `.env.example`. `.env` est gitignoré.

| Variable | Service | Notes |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Places (New) | concurrents, géocodage. Activer « Places API (New) ». Attention aux **restrictions d'IP** sur la clé. |
| `OPENROUTESERVICE_API_KEY` | Openrouteservice | isochrones (gratuit). |
| `BESTTIME_API_KEY_PRIVATE` | BestTime | flux proxy (facturé au crédit). |
| `MAPBOX_TOKEN` | Mapbox Static Images | cartes PNG (gratuit 50k/mois). |
| `ANTHROPIC_API_KEY` | Claude API | rédaction LLM (`claude-sonnet-4-6`). |

APIs **sans clé** : geo.api.gouv.fr (validation zone INSEE), OpenDataSoft (contours IRIS, BODACC), Overpass/OSM (densité, contexte rue), DVF etalab.

## Pipeline & structure des fichiers

Une commande (`assemble-report.js`) orchestre tout.

| Fichier | Rôle | Source de données |
|---|---|---|
| `assemble-report.js` | **Orchestrateur end-to-end** : assertion des clés secteur, enchaîne tout, calcule le score déterministe puis appelle les tâches LLM de rédaction, télécharge les 3 cartes, écrit `report.html` + `report-data.json`. CLI : adresse/secteur/surface/loyer. | — |
| `scoring.js` | **`computeScore(input)`** — score /10 **déterministe** (fonction pure) : 4 piliers pondérés (concurrence 35 % / démographie 30 % / flux 20 % / risques 15 %), seuil de viabilité 5,5 + vetos durs, `score_breakdown` inspectable. Remplace l'ancien score émis par le LLM. | — |
| `report-builder.js` | `buildReportHtml(reportData)` — HTML A4 autonome (CSS `@page`, police Inter). Fonction pure. Badge flux « estimé · non mesuré », étiquettes de source, note de réconciliation OSM/Google. | — |
| `rebuild-report.js` | Reconstruit `report.html` depuis `report-data.json` (sans API). | — |
| `load-env.js` | Charge `.env` dans `process.env`. | — |
| **Config / données** | | |
| `sector-keys.js` | **`MVP_SECTORS` (17)** + `assertSectorKeyConsistency()` : source de vérité du périmètre + assertion au boot (dropdown = config = table = benchmarks = exclusions). | — |
| `sector-type-mapping.js` | **Table secteur → primaryType Google (New)** : `google_include`/`google_exclude`, tags OSM, heuristiques de nom. Aussi : `text_queries` (découverte par mot-clé), `classify_by: "name"` (métiers sans type Google), `types_any_include/exclude` (**marqueurs de format** lus dans `types[]`). Source de vérité « ce lieu est-il un concurrent du secteur ? ». | — |
| `sector_config.js` | Rayons primaire/secondaire par secteur (17 clés, alignés sur le mapping). | — |
| `market_config.js` | Config marché (FR actif, ES + placeholders ; `min_population`, devise, message hors-zone). | — |
| `exclusion-lists.js` | Chaînes / faux positifs par secteur (`{name, category, reason}`, matching mot-entier) — sert l'axe chaîne vs direct. | — |
| `sector-benchmarks.js` | Benchmarks P5 : **code NAF**, flux, profil cible, **CA annuel par établissement** + moyenne + source, saisonnalité. **9/17 secteurs sourcés** (FCGA/Cerfrance/INSEE/études de branche) ; snacking, beauté, retouche + les 4 métiers spécialisés restent « proposition ». CA/m² abandonné (voir Décisions). | sources publiques |
| **Étapes pipeline** | | |
| `competitor-search.js` | Concurrents (**Nearby Search + Text Search**, fusionnés et dédupliqués) + géocodage. Text Search filtré sur la distance réelle (le cercle n'y est qu'un *bias*). Marque la **censure** (`capped`) quand une recherche revient pleine. **Filtrage par `primaryType` via la table**, **dédup** (place_id puis nom+proximité <25 m), **garde-fou contamination** (`detectContamination`, cross-secteur). Axe chaîne/direct via `exclusion-lists`. | Google Places |
| `zone-validation.js` | Commune ≥ seuil population (refus/veto si <). | geo.api.gouv.fr (INSEE) |
| `isochrones.js` | Zones de marche 5/10 min. | Openrouteservice |
| `demographics.js` | Agrégation population/âge/revenus/logement par IRIS, **pondérée par la part surfacique** de chaque IRIS. CSV nationaux dans `data/`. **Millésime par dimension** : population/logement RP 2022, revenus Filosofi 2021 (dernier dispo à l'IRIS). | INSEE CSV (locaux) |
| `iris-geometry.js` | Adresse/isochrone → IRIS. `findIrisWeightsInPolygon()` renvoie `[{code, weight}]` ; `irisAreaWeight()` = intersection par grille déterministe (point-dans-polygone local). | OpenDataSoft `georef-france-iris` |
| `commercial-density.js` | Densité commerciale 300/500/1000 m par catégorie (+ `queryOverpass`, miroirs + retry). | Overpass/OSM |
| `street-context.js` | P2 — type de rue, transports (300 m), stationnement (200 m), visibilité. | Overpass/OSM |
| `commercial-dynamics.js` | P6 — dynamique commerciale BODACC (créations/radiations/procédures par CP). **Fenêtre ancrée au mois** (`bodaccWindow`), résultat reproductible. | BODACC (OpenDataSoft) |
| `market-reference.js` | P6 — référence loyer (DVF best-effort ; **DVF = prix de vente** → « non disponible »). | DVF etalab |
| `foot-traffic.js` | Flux proxy qualitatif. Souvent « insuffisant » en local. | BestTime |
| `static-maps.js` | 3 cartes PNG (localisation P2, isochrones P3, concurrents P4) + `reportFolderName`. | Mapbox Static |
| `llm-synthesis.js` | `callClaude` + tâches de **rédaction** : `writeVerdictSummary` (prose P1, à partir du score déjà calculé), `competitiveSynthesis` (P4), `zoneSynthesis` (P3), `sectorAdequacy` (P5 — fourchette de CA **par établissement** sourcée, surface en modulateur qualitatif), `riskSignals` (P6). Sorties JSON schema. | Claude API |
| `list-vacant-shops.js` | Outil annexe — CSV des locaux vacants OSM. | Overpass/OSM |

### Données & sorties (gitignorées)

- `data/` — CSV INSEE nationaux : population + logement **RP 2022** (`base-ic-*-2022`, géo 01/01/2024) ; revenus **Filosofi 2021** (`BASE_TD_FILO_IRIS_2021_DISP.csv`, dernier millésime à l'IRIS). ~130 Mo, re-téléchargeables. **Non versionné.**
- `output/` — rapports générés. **Non versionné.**

## Score & verdict (déterministe)

- Le **score /10, le verdict et les 4 métriques clés** viennent de `scoring.js` (fonction pure, reproductible, inspectable via `score_breakdown`), **pas** du LLM. Le LLM ne rédige plus que le résumé exécutif + la justification, sans pouvoir changer le chiffre.
- 4 piliers avec seuils explicites : **concurrence** (Absente/Modérée/Dense, seuils par secteur), **démographie** (revenu/stabilité/population, `INCOME_SENSITIVITY` par secteur), **flux** (proxy densité 1 km), **risques** (vacance, saturation). Verdict = score ≥ 5,5 ET aucun veto.
- **Vetos durs → NON VIABLE** : zone non couverte, concurrence Dense + flux Faible, démographie Inadapté.
- **Garde-fous sur le pilier concurrence** (le plus lourd, 35 %) : un « 0 concurrent » vaut 10/10, donc c'est l'entrée la plus dangereuse quand elle vient d'une panne. Deux protections :
  - **Contradiction OSM** : 0 concurrent alors qu'OSM recense ≥ 3 commerces du même métier → catégorie « Indéterminée », note neutre 5, `dataWarning`. Asymétrique : un faible comptage OSM ne confirme JAMAIS une absence (couverture OSM inégale), il ne fait que la contester.
  - **Censure à droite** : Google plafonne à 20 résultats (Nearby ne pagine pas). Une recherche qui revient pleine est une **borne inférieure**, pas une mesure → jamais « Absente », et note plafonnée à 6.
  - Principe commun : **l'incertitude ne doit jamais améliorer le score.**
- ⚠️ **Les seuils de concurrence ne sont PAS calibrés statistiquement.** Mesurés sur 6 zones contrastées (2 villes) : 4 étaient manifestement cassés et corrigés (`coiffure` 6→12 et `beaute` 6→10, qui se déclenchaient dans TOUTES les zones ; `primeur` 4→2 et `pressing` 4→3, qui ne se déclenchaient JAMAIS). Les 13 autres sont inchangés faute de preuves.

## Conventions établies

Voir `CONVENTIONS.md`. En résumé :
- **Code en anglais** : commentaires, identifiants, clés JSON, noms de fichiers. **Messages de commit en anglais** aussi. Les **valeurs métier** restent en français (clés de secteur, textes du rapport, signaux `complete`/`partielle`). La **discussion** avec l'utilisateur est en français.
- **Un item = un commit** isolé (pas de diff fourre-tout).
- **Clés API** : uniquement dans `.env` (+ `.env.example`), jamais en dur.
- **Zéro dépendance npm** : `fetch` natif, géométrie/CSV/tests faits maison.
- **Modèle LLM** : `claude-sonnet-4-6`. Appel `fetch` brut (pas de SDK).
- **Verdict** : binaire **VIABLE / NON VIABLE** (vert / rouge), dérivé du score déterministe.
- **Règles de contenu non-négociables** (prompts) : zéro jargon, zéro chiffre inventé, disclaimers, ton factuel/bienveillant, « best-effort » et limites de données explicites. Pas de tiret cadratin dans les gabarits générés.
- **Pagination** : règle « 6 pages strictes » **abandonnée** — priorité à la lisibilité.
- Chaque module : fonctions exportées + lanceur `require.main === module`.

## Décisions de données notables

- **Tranches d'âge** : `0-17 / 18-39 / 40-64 / 65+` (exactes depuis les tranches INSEE).
- **Démographie isochrone** : **pondération surfacique** — chaque IRIS contribue à hauteur de sa part d'aire dans l'isochrone (grille déterministe). Corrige la sur-estimation des petites communes (Carbon-Blanc 10 min : 20 840 → 3 380). Un IRIS sans géométrie retombe sur le comptage entier.
- **Concurrents** : filtrés par `primaryType` (API New), dédupliqués (place_id + nom/proximité). Google fait foi pour la concurrence ; la densité OSM est un signal plus large (réconcilié dans le texte P4, et utilisé comme **corroboration d'un zéro** dans le score).
- **Deux modes de recherche.** Nearby Search ne suffit pas : il renvoie les 20 lieux les plus **notoires** dont les `types[]` contiennent le type demandé, alors qu'on classe sur le `primaryType`. Pour un métier que Google ne type pas distinctement, le top 20 se remplit de supermarchés et **tout est filtré** (`epicerie_fine` remontait 0 concurrent en production). Un **Text Search par mot-clé** (`text_queries`) les retrouve. 4 métiers sans type Google (`primeur`, `fromagerie`, `poissonnerie`, `cordonnerie`) sont en `classify_by: "name"` : `google_include` vide, découverte 100 % Text Search, le **nom fait foi**.
- **Format ≠ cuisine.** Les types `*_restaurant` encodent la cuisine, pas le format de service : KFC est typé `restaurant`, Black & White Burger `hamburger_restaurant`. Le format se lit dans **`types[]`** (`fast_food_restaurant`). `snacking` l'accepte, `restauration` le rejette — symétrique, donc comptage unique. Ne PAS utiliser `meal_takeaway`/`meal_delivery` comme marqueur : un restaurant assis qui livre les porte. Le marqueur n'ajoute qu'une voie d'acceptation, `google_exclude` reste un filtre dur (sinon une boulangerie à sandwichs ou un Carrefour City entrerait en snacking).
- **BODACC** : fenêtre glissante **ancrée sur des mois calendaires complets** → reproductible.
- **Flux (P1/P2/P5)** : BestTime souvent insuffisant → estimation qualitative via densité (proxy), badge « estimé · non mesuré » en P1, jamais de nombre inventé.
- **Adresse du titre** : adresse **géocodée** (normalisée), pas la saisie brute.
- **Géométrie IRIS** : à la demande via OpenDataSoft, **millésime pinné à `year=date'2024'`** (géo 01/01/2024, alignée sur le RP 2022 ; évite de mélanger un futur millésime). Le GeoJSON national >1 Go est impraticable.
- **Millésime des données démographiques** : pris **par dimension** (le plus récent que l'INSEE publie *à l'IRIS*). Population/logement = **RP 2022**. Revenus = **Filosofi 2021** : l'INSEE a **sauté 2022** (qualité) et **ne diffuse pas Filosofi 2 (2023) à l'IRIS** (commune et au-dessus seulement). Ne pas mélanger Filosofi 1 (2021) et 2 (2023) : méthodologies non comparables. Millésimes affichés au lecteur en P3.
- **CA sectoriel (P5)** : présenté comme **fourchette de CA annuel par établissement** (+ moyenne du secteur), sourcée (FCGA, Cerfrance, INSEE, études de branche). L'ancien modèle **`surface × CA/m²` a été abandonné** : le CA/m² n'est pas publié de façon harmonisée → un écart de 3× inexploitable, et le chiffre montré reposait sur le champ le moins fondé. La **surface est désormais un modulateur qualitatif** (prompt P5). 7/10 secteurs sourcés ; snacking, beauté, retouche + les 4 métiers spécialisés restent « proposition » (pas de source par établissement crédible — on assume plutôt que d'inventer).

## Calibration des seuils de concurrence — état et impasses

**Le problème.** Un seuil en valeur absolue ne peut pas être juste : (1) la mesure est **censurée** au plafond Google de 20 (sur Sainte-Catherine : 13 restaurants détectés, **229** recensés par OSM) ; (2) elle n'est pas rapportée à la **demande** (8 concurrents pour 2 000 ou 25 000 habitants n'ont pas le même sens) ; (3) elle ignore la **structure nationale du métier** (la coiffure est ~2,5× plus dense que la boulangerie partout en France — d'où `coiffure` toujours « Dense »).

**Trois pistes tentées, deux invalidées par la validation** (à ne pas refaire à l'identique) :
1. ~~Indice vs ratio national SIRENE~~ — **incompatibilité de définitions** : SIRENE compte des unités légales, notre numérateur vient de Google/OSM. Biais systématique invisible.
2. ~~Densités relatives par code NAF~~ — **un NAF n'est pas un métier**. Biais non uniforme (1,3× pour la boulangerie et la coiffure, mais **2,8× pour le fleuriste**), car `47.76Z` agrège fleuristes + jardineries + animaleries ; `95.29Z` est un fourre-tout ; `96.01B` couvre pressing ET laverie, `47.29Z` épicerie fine ET fromagerie (4 secteurs sans code distinct).
3. Calibration par quantiles sur notre propre mesure — **bloquée** : Google est plafonné et payant (~35 € pour 50 lieux), Overpass répond en ~133 s pour une requête triviale (échantillonnage massif impraticable).

**Piste propre restante** : la **BPE INSEE** (Base Permanente des Équipements) recense des **points de vente réels** avec une typologie adaptée, au lieu d'unités légales. Chantier non commencé.

**Ce qui manque vraiment** : de la **vérité terrain** — des emplacements dont on connaît l'issue (commerces qui ont marché ou fermé). 5 à 10 cas réels vaudraient plus que toute la mécanique ci-dessus.

## Tâches en attente / pistes

- **~~Migration INSEE 2023~~ — FAIT** (branche `feature/insee-2023`) : population/logement passés au **RP 2022** (colonnes positionnellement identiques à 2021, `P21_*`→`P22_*`), contours IRIS pinnés à `year=2024`, millésimes affichés en P3. **Revenus restés à Filosofi 2021** : 2022 sauté par l'INSEE, Filosofi 2 2023 non publié à l'IRIS (constat vérifié 2026-07). Reste ouvert : re-sourcer les revenus à l'IRIS quand/si l'INSEE republie ce grain ; sinon envisager un fallback communal 2023 **explicitement étiqueté** (déconseillé pour l'instant, casse la granularité intra-ville).
- **~~Benchmarks `sector-benchmarks.js`~~ — FAIT à 7/10** (tâche H) : table `secteur → NAF` (10 secteurs), **CA par établissement sourcé** pour boulangerie, restauration, coiffure, épicerie fine, caviste, pressing (FCGA 2016, **daté**) et laverie ; reframe (abandon du CA/m²). **Reste ouvert : snacking, beauté, retouche** — aucune source par établissement crédible trouvée (blogs business-plan, ou rapports de branche CNAIB/OPCO sans CA par unité) ; nécessiteraient FCGA récent / Pappers (payant). Réactualiser aussi le pressing (chiffre 2016).
- **Loyer de marché de référence** : DVF ne convient pas (vente) ; nécessite une source de loyers commerciaux (SeLoger Pro/Idealista, **payant**). Décision de source requise.
- **Travaux de voirie (P2)** : brancher l'open data par métropole (Bordeaux Métropole, data.gouv chantiers) ; ne couvre que les grandes villes.
- **Étape 12 — livraison email** (Resend/Postmark) : non commencée. Templates conditionnels selon verdict.
- **Étape 1 — formulaire client réel** (Tally/Typeform) : actuellement simulé par l'objet `order` dans `assemble-report.js`.
- **Calage fin des pages** : P2/P6 dépassent légèrement l'A4 — secondaire.
- **Sécurité clés** : OK en `.env` pour le MVP local ; secret manager pour la prod.
- **PDF automatique (V1)** : Puppeteer (HTML→PDF) — différé pour rester zéro-dépendance.

## Historique récent (mergé dans `main`)

- **PR #1 — P0** (5 items) : scoreur déterministe (P0.1), fenêtre BODACC (P0.2), filtrage concurrents + dédup + garde-fou contamination (P0.3), assertion des clés secteur / périmètre 10 secteurs (P0.4), rayon inter-communes (P0.5 : aucun changement, hypothèse infirmée).
- **PR #2 — P1/P2** (4 items) : badge flux « estimé · non mesuré », adresse du titre normalisée, sources étiquetées + réconciliation OSM/Google, pondération surfacique des IRIS.
- **PR #3 — Tâche E** (INSEE) : migration démographie au RP 2022 (population/logement), contours IRIS pinnés à 2024, millésimes affichés en P3. Revenus restés Filosofi 2021 (2023 non diffusé à l'IRIS). Validé offline (31 tests + deltas 2021→2022 cohérents, Bordeaux +1,35 %).
- **`feature/sector-taxonomy`** : périmètre 10 → **17 secteurs** + 4 familles ; décontamination d'`epicerie_fine` (le boucher n'est plus un concurrent) ; **2 bugs de production corrigés** — `snacking` (le wildcard `MATCH:*_restaurant` évinçait ses propres types : 1 concurrent au lieu de 6 sur Judaïque) et `epicerie_fine` (0 concurrent, réparé par le Text Search : 0 → 11) ; arbitrage format de service ; garde-fous score (zéro contredit par OSM, censure). **Tous les secteurs validés en conditions réelles**, pas seulement en tests offline.
- **PR #4 — Tâche H** (benchmarks CA) : table secteur→NAF (10), **CA par établissement 7/10 sourcés** (FCGA/Cerfrance/INSEE/études de branche), reframe (abandon `surface × CA/m²`, surface = modulateur qualitatif). snacking/beauté/retouche restent « proposition ». Validé par un run P5 réel.
