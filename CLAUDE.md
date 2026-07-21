# VisiSpot — Outil d'analyse d'emplacement commercial (MVP)

Génère un **rapport PDF d'analyse d'emplacement** pour un commerçant indépendant : à partir d'une adresse + d'un type de commerce, le pipeline collecte des données (concurrence, démographie, flux, densité, dynamique commerciale…), les fait interpréter par Claude, et produit un **rapport HTML 6 pages** prêt à imprimer en PDF, avec un verdict **VIABLE / NON VIABLE**.

MVP **semi-manuel** : génération en une commande, PDF produit par impression navigateur. Voir le brief produit complet dans `~/Downloads/Brief_Produit_MVP_Analyse_Emplacement_V2.md`.

## Environnement

- **Node.js v20.19** (utilise `fetch` natif et `process.loadEnvFile`).
- **Zéro dépendance npm** — pas de `package.json`, pas de `node_modules`. Tous les appels API se font en `fetch` brut (décision d'architecture maintenue tout au long du projet).
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

- **Secteurs valides** : `boulangerie · restauration · snacking · coiffure · beaute · epicerie_fine · caviste · pressing · services_personne` (un secteur inconnu → erreur immédiate avec la liste).
- Sortie : `output/<YYYY-MM-DD_adresse-slug>/report.html` + 3 cartes PNG + `report-data.json`. Ouvrir le HTML → Cmd+P → « Enregistrer en PDF ».
- ~30-60 s et ~0,06 € d'API LLM par rapport.

### Itérer sur le template sans rappeler les APIs

```bash
node rebuild-report.js [<nom-du-dossier-rapport>]   # reconstruit report.html depuis report-data.json (gratuit, instantané)
```

### Modules lançables seuls (test/debug)

Chaque module a un lanceur `if (require.main === module)` sur l'adresse de Bordeaux :
`node competitor-search.js`, `zone-validation.js`, `isochrones.js`, `demographics.js`, `iris-geometry.js`, `commercial-density.js`, `street-context.js`, `commercial-dynamics.js`, `market-reference.js`, `foot-traffic.js`, `list-vacant-shops.js`.
La synthèse LLM par page : `node llm-synthesis.js <p1|p4|p5|p6>`.

## Clés API (toutes dans `.env`)

Convention : **jamais en dur dans le code**, lues via `process.env`, chargées par `load-env.js` (requis en tête des fichiers). Voir `.env.example` pour la liste. `.env` est gitignoré.

| Variable | Service | Notes |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Places (New) | concurrents, géocodage. Activer « Places API (New) ». |
| `OPENROUTESERVICE_API_KEY` | Openrouteservice | isochrones (gratuit). |
| `BESTTIME_API_KEY_PRIVATE` | BestTime | flux proxy (facturé au crédit). |
| `MAPBOX_TOKEN` | Mapbox Static Images | cartes PNG (gratuit 50k/mois). |
| `ANTHROPIC_API_KEY` | Claude API | synthèses LLM (`claude-sonnet-4-6`). |

APIs **sans clé** : geo.api.gouv.fr (validation zone INSEE), OpenDataSoft (contours IRIS, BODACC), Overpass/OSM (densité, contexte rue), DVF etalab.

## Pipeline & structure des fichiers

Numérotation = étapes du brief (§5). Une commande (`assemble-report.js`) orchestre tout.

| Fichier | Rôle | Source de données |
|---|---|---|
| `assemble-report.js` | **Orchestrateur end-to-end** : enchaîne tout, appelle les 5 tâches LLM, télécharge les 3 cartes, écrit `report.html` + `report-data.json`. CLI : adresse/secteur/surface/loyer. | — |
| `report-builder.js` | `buildReportHtml(reportData)` — HTML A4 autonome (CSS `@page`, police Inter, en-têtes/pieds par page). Fonction pure. | — |
| `rebuild-report.js` | Reconstruit `report.html` depuis `report-data.json` (sans API). | — |
| `load-env.js` | Charge `.env` dans `process.env` (`process.loadEnvFile`). | — |
| **Config / données** | | |
| `sector_config.js` | Rayons primaire/secondaire par secteur. | — |
| `market_config.js` | Config marché (FR actif, ES + placeholders ; `min_population`, devise, message hors-zone). | — |
| `exclusion-lists.js` | Faux positifs / chaînes par secteur (`{name, category, reason}`, matching mot-entier). | — |
| `sector-benchmarks.js` | Benchmarks P5 (flux, profil cible, CA annuel + CA/m²/an, saisonnalité). **STATUT : proposition — à valider.** | sources publiques |
| **Étapes pipeline** | | |
| `competitor-search.js` | Étape 6 — concurrents (Nearby Search New) + géocodage (`geocodeAddress`). Classification direct/chaîne/faux-positif. | Google Places |
| `zone-validation.js` | Étape 2 — commune ≥ seuil population (refus auto si <). | geo.api.gouv.fr (INSEE) |
| `isochrones.js` | Étape 4 — zones de marche 5/10 min. | Openrouteservice |
| `demographics.js` | Étape 5 — agrégation population/âge/revenus/logement par IRIS (CSV nationaux préchargés dans `data/`). | INSEE CSV (locaux) |
| `iris-geometry.js` | Étape 5 (géo) — adresse/isochrone → codes IRIS (point-dans-polygone local). | OpenDataSoft `georef-france-iris` |
| `commercial-density.js` | Étape 8 — densité commerciale 300/500/1000 m par catégorie (+ `queryOverpass` réutilisable, miroirs + retry). | Overpass/OSM |
| `street-context.js` | P2 — type de rue, transports (300 m), stationnement (200 m), visibilité. | Overpass/OSM |
| `commercial-dynamics.js` | P6 — dynamique commerciale (créations/radiations/procédures collectives par code postal). | BODACC (OpenDataSoft) |
| `market-reference.js` | P6 — référence loyer (DVF best-effort ; **DVF = prix de vente, pas loyer** → tombe en « non disponible »). | DVF etalab |
| `foot-traffic.js` | Étape 7 — flux proxy qualitatif (lieux voisins). Souvent « insuffisant » sur adresses locales. | BestTime |
| `static-maps.js` | Étape 9 — 3 cartes PNG (localisation P2, isochrones P3, concurrents P4) + `reportFolderName`. | Mapbox Static |
| `llm-synthesis.js` | Étape 10 — `callClaude` + 5 tâches : `scoreVerdict` (P1), `competitiveSynthesis` (P4), `zoneSynthesis` (P3), `sectorAdequacy` (P5), `riskSignals` (P6). Sorties structurées (JSON schema). | Claude API |
| `list-vacant-shops.js` | Outil annexe (hors rapport) — CSV des locaux vacants OSM. | Overpass/OSM |

### Données & sorties (gitignorées)

- `data/` — CSV INSEE nationaux 2021 (population, logement, Filosofi revenus). ~115 Mo, re-téléchargeables. **Non versionné.**
- `output/` — rapports générés (`report.html`, cartes PNG, `report-data.json`, CSV vacants). **Non versionné.**

## Conventions établies

Voir `CONVENTIONS.md`. En résumé :
- **Code en anglais** : commentaires, identifiants, clés JSON, noms de fichiers. Les **valeurs métier** restent en français (clés de secteur `boulangerie`…, textes du rapport, signaux `qualite_donnees` `complete`/`partielle`).
- **Clés API** : uniquement dans `.env` (+ `.env.example`), jamais en dur.
- **Zéro dépendance npm** : `fetch` natif, géométrie/CSV faits maison.
- **Modèle LLM** : `claude-sonnet-4-6` (calibrage coût du brief). Appel `fetch` brut (pas de SDK).
- **Verdict** : binaire **VIABLE / NON VIABLE** (vert / rouge).
- **Règles de contenu non-négociables** (encodées dans les prompts) : zéro jargon, zéro chiffre inventé, disclaimers, ton factuel/bienveillant, mentions « best-effort » et limites de données explicites.
- **Pagination** : la règle « 6 pages strictes » a été **abandonnée** — priorité à la lisibilité (cartes pleine largeur, tableaux non tronqués) ; une section peut dépasser une page imprimée.
- Chaque module : fonctions exportées + lanceur `require.main === module` pour test isolé.

## Décisions de données notables

- **Tranches d'âge** : `0-17 / 18-39 / 40-64 / 65+` (exactes depuis les tranches INSEE ; le 40-59/60+ du brief n'est pas reconstituable sans inventer).
- **Démographie isochrone** : IRIS recoupant la zone comptés **entiers** (sur-estime les petites zones) — divulgué en P3.
- **Géométrie IRIS** : à la demande via OpenDataSoft (le GeoJSON national >1 Go est impraticable).
- **Flux (P2/P5)** : BestTime souvent insuffisant en local → estimation qualitative via densité (proxy), jamais de nombre de passages inventé.

## Tâches en attente / pistes

- **Étape 12 — livraison email** (Resend/Postmark) : non commencée. Templates conditionnels selon verdict (brief §12).
- **Étape 1 — formulaire client réel** (Tally/Typeform) : actuellement simulé par l'objet `order` dans `assemble-report.js`.
- **Benchmarks `sector-benchmarks.js`** : à valider/sourcer avant production (fourchettes CA indicatives, larges).
- **Données INSEE** : passer au millésime **2023** dès publication (actuellement 2021 ; les préfixes de colonnes embarquent l'année, ex. `P21_*` → `P23_*`). TODO dans `demographics.js`.
- **Référence de loyer de marché** : DVF ne convient pas (prix de vente) ; une vraie source de loyers commerciaux (SeLoger Pro/Idealista, payant) serait un ajout V1.
- **Calage fin des pages** : P2 (~1148 px) et P6 dépassent légèrement l'A4 — secondaire depuis l'abandon de la règle 6 pages.
- **Sécurité clés** : OK en `.env` pour le MVP local ; rotation/secret manager pour la prod.
- **PDF automatique (V1)** : Puppeteer (HTML→PDF) — différé pour rester zéro-dépendance au MVP.
