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

- **Périmètre MVP : 10 secteurs** — `boulangerie · restauration · snacking · coiffure · beaute · epicerie_fine · caviste · pressing · laverie · retouche`. Un secteur inconnu → erreur immédiate avec la liste. Une **assertion au démarrage** (`sector-keys.js`) échoue bruyamment si les jeux de clés divergent (voir P0.4 ci-dessous).
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
31 tests au total, `node:assert`, sans réseau ni clé. Chaque module a aussi un lanceur `if (require.main === module)` (souvent sur l'adresse de Bordeaux) pour test isolé : `node competitor-search.js`, `commercial-dynamics.js`, `iris-geometry.js`, `scoring.js`, etc. La rédaction LLM par page : `node llm-synthesis.js <p1|p4|p5|p6>`.

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
| `sector-keys.js` | **`MVP_SECTORS` (10)** + `assertSectorKeyConsistency()` : source de vérité du périmètre + assertion au boot (dropdown = config = table = benchmarks = exclusions). | — |
| `sector-type-mapping.js` | **Table secteur → primaryType Google (New)** : `google_include`/`google_exclude`, tags OSM, heuristiques de nom (famille entretien du vêtement, denylist coiffure). Source de vérité « ce lieu est-il un concurrent du secteur ? ». | — |
| `sector_config.js` | Rayons primaire/secondaire par secteur (10 clés). | — |
| `market_config.js` | Config marché (FR actif, ES + placeholders ; `min_population`, devise, message hors-zone). | — |
| `exclusion-lists.js` | Chaînes / faux positifs par secteur (`{name, category, reason}`, matching mot-entier) — sert l'axe chaîne vs direct. | — |
| `sector-benchmarks.js` | Benchmarks P5 (flux, profil cible, CA annuel + CA/m²/an, saisonnalité). **STATUT : proposition — à valider/sourcer** (dont laverie/retouche). | sources publiques |
| **Étapes pipeline** | | |
| `competitor-search.js` | Concurrents (Nearby Search New) + géocodage. **Filtrage par `primaryType` via la table**, **dédup** (place_id puis nom+proximité <25 m), **garde-fou contamination** (`detectContamination`, cross-secteur). Axe chaîne/direct via `exclusion-lists`. | Google Places |
| `zone-validation.js` | Commune ≥ seuil population (refus/veto si <). | geo.api.gouv.fr (INSEE) |
| `isochrones.js` | Zones de marche 5/10 min. | Openrouteservice |
| `demographics.js` | Agrégation population/âge/revenus/logement par IRIS, **pondérée par la part surfacique** de chaque IRIS. CSV nationaux dans `data/`. | INSEE CSV (locaux) |
| `iris-geometry.js` | Adresse/isochrone → IRIS. `findIrisWeightsInPolygon()` renvoie `[{code, weight}]` ; `irisAreaWeight()` = intersection par grille déterministe (point-dans-polygone local). | OpenDataSoft `georef-france-iris` |
| `commercial-density.js` | Densité commerciale 300/500/1000 m par catégorie (+ `queryOverpass`, miroirs + retry). | Overpass/OSM |
| `street-context.js` | P2 — type de rue, transports (300 m), stationnement (200 m), visibilité. | Overpass/OSM |
| `commercial-dynamics.js` | P6 — dynamique commerciale BODACC (créations/radiations/procédures par CP). **Fenêtre ancrée au mois** (`bodaccWindow`), résultat reproductible. | BODACC (OpenDataSoft) |
| `market-reference.js` | P6 — référence loyer (DVF best-effort ; **DVF = prix de vente** → « non disponible »). | DVF etalab |
| `foot-traffic.js` | Flux proxy qualitatif. Souvent « insuffisant » en local. | BestTime |
| `static-maps.js` | 3 cartes PNG (localisation P2, isochrones P3, concurrents P4) + `reportFolderName`. | Mapbox Static |
| `llm-synthesis.js` | `callClaude` + tâches de **rédaction** : `writeVerdictSummary` (prose P1, à partir du score déjà calculé), `competitiveSynthesis` (P4), `zoneSynthesis` (P3), `sectorAdequacy` (P5), `riskSignals` (P6). Sorties JSON schema. | Claude API |
| `list-vacant-shops.js` | Outil annexe — CSV des locaux vacants OSM. | Overpass/OSM |

### Données & sorties (gitignorées)

- `data/` — CSV INSEE nationaux **2021** (population, logement, Filosofi revenus). ~130 Mo, re-téléchargeables. **Non versionné.**
- `output/` — rapports générés. **Non versionné.**

## Score & verdict (déterministe)

- Le **score /10, le verdict et les 4 métriques clés** viennent de `scoring.js` (fonction pure, reproductible, inspectable via `score_breakdown`), **pas** du LLM. Le LLM ne rédige plus que le résumé exécutif + la justification, sans pouvoir changer le chiffre.
- 4 piliers avec seuils explicites : **concurrence** (Absente/Modérée/Dense, seuils par secteur), **démographie** (revenu/stabilité/population, `INCOME_SENSITIVITY` par secteur), **flux** (proxy densité 1 km), **risques** (vacance, saturation). Verdict = score ≥ 5,5 ET aucun veto.
- **Vetos durs → NON VIABLE** : zone non couverte, concurrence Dense + flux Faible, démographie Inadapté.
- ⚠️ Les **seuils de concurrence** sont calibrés sur des comptages propres (post-filtrage) — à recalibrer si le filtrage évolue.

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
- **Concurrents** : filtrés par `primaryType` (API New), dédupliqués (place_id + nom/proximité). Google fait foi pour la concurrence ; la densité OSM est un signal plus large (réconcilié dans le texte P4).
- **BODACC** : fenêtre glissante **ancrée sur des mois calendaires complets** → reproductible.
- **Flux (P1/P2/P5)** : BestTime souvent insuffisant → estimation qualitative via densité (proxy), badge « estimé · non mesuré » en P1, jamais de nombre inventé.
- **Adresse du titre** : adresse **géocodée** (normalisée), pas la saisie brute.
- **Géométrie IRIS** : à la demande via OpenDataSoft (le GeoJSON national >1 Go est impraticable).

## Tâches en attente / pistes

- **Migration INSEE 2023** (session dédiée) : Filosofi 2 (revenus, **rupture de schéma** — remapping de colonnes) + RP **2022** à l'IRIS (population, âge, occupation) + **contours IRIS** au bon millésime + afficher le millésime dans le rapport. Revalider les 3 adresses de test. TODO dans `demographics.js` (`P21_*` → `P23_*`).
- **Benchmarks `sector-benchmarks.js`** (session dédiée) : sourcer les fourchettes de CA (dont laverie/retouche). Méthode retenue : table `secteur → code NAF` puis INSEE ESANE / Pappers (API, empirique) / FCGA / fédérations ; CA/m² via surface moyenne (Procos) ou reframe.
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
