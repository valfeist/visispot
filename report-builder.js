/**
 * PIPELINE STEP 11 — Report builder (HTML → print-to-PDF)
 * -------------------------------------------------------
 * Pure function: assembles all pipeline data + LLM texts + maps into a
 * self-contained 6-page A4 HTML report. For the MVP the PDF is produced
 * manually (open in a browser → Cmd+P → "Save as PDF"); Puppeteer
 * automation is a V1 add-on.
 *
 * Maps are referenced by relative filename (the HTML is written next to
 * the PNGs in the report folder).
 */

// INSEE niveau de vie médian national (2021) — référence pour contextualiser
// le revenu de la zone. À mettre à jour avec le millésime des données.
const NATIONAL_MEDIAN_INCOME = 23160;

const ACCENT = "#1a4fa3"; // bleu institutionnel
const GO_COLOR = "#1e8e3e";
const NOGO_COLOR = "#d93025";

// Colour signal applied to the verdict TEXT of each key indicator (P1 grid).
const METRIC_GREEN = "#2D7D46";
const METRIC_ORANGE = "#B45309";
const METRIC_RED = "#9B1C1C";
const VERDICT_COLOR = {
  "Élevé": METRIC_GREEN, "Aligné": METRIC_GREEN, "Absente": METRIC_GREEN, "Aucun": METRIC_GREEN,
  "Moyen": METRIC_ORANGE, "Neutre": METRIC_ORANGE, "Modérée": METRIC_ORANGE, "1 signal": METRIC_ORANGE,
  "Faible": METRIC_RED, "Inadapté": METRIC_RED, "Dense": METRIC_RED, "Plusieurs": METRIC_RED,
};

// --- small formatting helpers ---------------------------------------

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Escapes HTML, then turns **bold** markdown into <strong>.
function richText(value) {
  return esc(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function pct(fraction) {
  return fraction === null || fraction === undefined ? "—" : `${Math.round(fraction * 100)}%`;
}

function num(n) {
  return n === null || n === undefined ? "—" : Number(n).toLocaleString("fr-FR");
}

function incomeContext(median) {
  if (!median) return "";
  const ratio = median / NATIONAL_MEDIAN_INCOME;
  if (ratio >= 1.1) return "supérieur à la moyenne nationale";
  if (ratio <= 0.9) return "inférieur à la moyenne nationale";
  return "proche de la moyenne nationale";
}

// --- page chrome -----------------------------------------------------

function pageHeader(meta) {
  return `<header class="hdr">
    <span class="hdr-brand">${esc(meta.service)}</span>
    <span class="hdr-addr">${esc(meta.address)}</span>
  </header>`;
}

function pageFooter(meta, pageNumber) {
  return `<footer class="ftr">
    <span>${esc(meta.service)} · ${esc(meta.businessType)}</span>
    <span>${esc(meta.dateLabel)} · page ${pageNumber}/6</span>
  </footer>`;
}

function page(meta, pageNumber, inner) {
  return `<section class="page" id="page-${pageNumber}">
    ${pageHeader(meta)}
    <main class="content">${inner}</main>
    ${pageFooter(meta, pageNumber)}
  </section>`;
}

// --- key-metric badges (P1) -----------------------------------------

function metricCard(label, value, detailPage, badge = null) {
  const color = VERDICT_COLOR[value] || "#1a1a1a";
  return `<div class="metric">
    <div class="metric-label">${esc(label)}</div>
    <div class="metric-value" style="color:${color}">${esc(value)}</div>
    ${badge ? `<div class="metric-badge">${esc(badge)}</div>` : ""}
    <a class="metric-detail" href="#page-${detailPage}">→ détail p. ${detailPage}</a>
  </div>`;
}

// --- competitor table (P4) ------------------------------------------

// Merged competitor table: direct (red numbers) + chains (orange numbers),
// numbering matching the map pins (each group restarts at 1).
function concurrenceRows(direct, chain) {
  const nameCell = (c) =>
    c.placeId
      ? `<a href="https://www.google.com/maps/place/?q=place_id:${esc(c.placeId)}">${esc(c.name)}</a>`
      : esc(c.name);
  // Readable cells: rating + review count on two lines; hours segments stacked.
  const noteCell = (c) =>
    c.googleRating
      ? `${c.googleRating}/5${c.reviewCount ? `<br><span class="avis">${num(c.reviewCount)} avis</span>` : ""}`
      : "—";
  const hoursCell = (c) => (c.openingHours ? esc(c.openingHours).split(", ").join("<br>") : "—");

  const group = (list, color, label, start) =>
    list
      .map(
        (c, i) => `<tr>
        <td class="leg-num" style="color:${color}">${start + i}</td>
        <td>${nameCell(c)}</td>
        <td>${c.distanceMeters != null ? `${c.distanceMeters} m` : "—"}</td>
        <td>${label}</td>
        <td class="note-cell">${noteCell(c)}</td>
        <td class="hours-cell">${hoursCell(c)}</td>
      </tr>`
      )
      .join("");

  const d = direct ?? [];
  const ch = chain ?? [];
  if (d.length + ch.length === 0) {
    return `<tr><td colspan="6" class="muted">Aucun établissement identifié.</td></tr>`;
  }
  // Chains numbered CONTINUING after direct (e.g. 13..17), matching map pins.
  return group(d, "#e02d2d", "Directe", 1) + group(ch, "#f5a623", "Chaîne / Franchise", d.length + 1);
}

function statusLabel(status) {
  if (status === "OPERATIONAL") return "Ouvert";
  if (status === "CLOSED_TEMPORARILY") return "Fermé temporairement";
  if (status === "CLOSED_PERMANENTLY") return "Fermé définitivement";
  return "—";
}

function listItems(items) {
  if (!items || items.length === 0) return "";
  return `<ul>${items.map((i) => `<li>${richText(i)}</li>`).join("")}</ul>`;
}

// =====================================================================
// Page builders
// =====================================================================

// "Sources utilisées" line for the P1 footer, built from dataQuality.
// Display order is fixed; absent sources are omitted; partial/insufficient
// sources get an asterisk, with an explanatory note when any are starred.
const SOURCE_LABELS = [
  ["googlePlaces", "Google Places"],
  ["inseeIris", "INSEE IRIS"],
  ["openStreetMap", "OpenStreetMap"],
  ["bestTime", "BestTime"],
  ["mapbox", "Mapbox"],
  ["openrouteservice", "Openrouteservice"],
];
const STATUS_ABSENT = new Set(["absent", "absente"]);
const STATUS_PARTIAL = new Set(["partial", "partielle", "insufficient", "insuffisant"]);

function sourcesLine(dataQuality) {
  if (!dataQuality) return "";
  let hasAsterisk = false;
  const parts = [];
  for (const [key, label] of SOURCE_LABELS) {
    const status = dataQuality[key];
    if (!status || STATUS_ABSENT.has(status)) continue;
    const star = STATUS_PARTIAL.has(status) ? "*" : "";
    if (star) hasAsterisk = true;
    parts.push(esc(label) + star);
  }
  if (parts.length === 0) return "";
  const line = `<div class="p1-sources"><strong>Sources utilisées :</strong> ${parts.join(" · ")}</div>`;
  const note = hasAsterisk
    ? `<div class="p1-sources-note">* Données partielles — voir détail dans le rapport</div>`
    : "";
  return line + note;
}

// Recap of the client's form inputs (conditional optional fields).
function orderSummary(order) {
  if (!order) return "";
  const field = (label, value) =>
    `<div class="order-field"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`;
  const optional = [];
  if (order.knownCompetitors) optional.push(field("Concurrents identifiés", order.knownCompetitors));
  if (order.monthlyRent) optional.push(field("Loyer mensuel", `${num(order.monthlyRent)} €/mois`));
  return `<div class="order-summary">
    ${field("Adresse analysée", order.geocodedAddress)}
    ${field("Type de commerce", order.businessType)}
    ${field("Clientèle cible", (order.targetAudience || []).join(", "))}
    ${optional.join("")}
  </div>`;
}

function buildPage1(meta, p1, order, dataQuality) {
  const isGo = p1.verdict === "VIABLE";
  const verdictColor = isGo ? GO_COLOR : NOGO_COLOR;
  const limitation = p1.limitationNote
    ? `<div class="limitation"><strong>Limite de l'analyse :</strong> ${richText(p1.limitationNote)}</div>`
    : "";

  return page(meta, 1, `
    <div class="p1-head">
      <h1>Analyse d'emplacement</h1>
    </div>
    ${orderSummary(order)}
    ${limitation}
    <div class="verdict-row">
      <div class="score-box">
        <div class="score-num">${esc(p1.score)}</div>
        <div class="score-max">/ 10</div>
      </div>
      <div class="verdict-box" style="color:${verdictColor};border-color:${verdictColor}">${esc(p1.verdict)}</div>
    </div>
    <p class="exec">${richText(p1.executiveSummary)}</p>
    <div class="metrics">
      ${metricCard("Flux estimé", p1.keyMetrics.flux, 2, dataQuality.bestTime === "insuffisant" ? "estimé · non mesuré" : null)}
      ${metricCard("Profil démographique", p1.keyMetrics.demographicProfile, 3)}
      ${metricCard("Concurrence directe", p1.keyMetrics.directCompetition, 4)}
      ${metricCard("Risques identifiés", p1.keyMetrics.risks, 6)}
    </div>
    <div class="p1-footer">
      ${sourcesLine(dataQuality)}
      <div class="disclaimer">Ce rapport est un outil d'aide à la décision. Il ne remplace pas une due diligence juridique ou financière complète.</div>
    </div>
  `);
}

// "1. Saint-Seurin — bus 4, 15 — 12 m" (stop name + mode + lines + distance),
// numbered to match the P2 map pins.
function transportLine(t, n) {
  const lines = t.lines ? ` ${esc(t.lines)}` : "";
  return `${n}. ${esc(t.name)} — ${esc(t.type)}${lines} — ${t.distanceMeters} m`;
}

function buildPage2(meta, p2) {
  const sc = p2.streetContext ?? {};
  const transportsHtml =
    sc.transports && sc.transports.length
      ? sc.transports.map((t, i) => transportLine(t, i + 1)).join("<br>")
      : "Aucun transport identifié dans 300 m";
  const parking = sc.parking;
  const parkingHtml =
    parking && parking.count > 0
      ? `${parking.count} parking${parking.count > 1 ? "s" : ""} dans un rayon de 200 m${parking.anyPaid ? " (dont payant)" : ""}`
      : "Aucun parking identifié dans 200 m";

  return page(meta, 2, `
    <h2>Fiche identité de l'adresse</h2>
    <table class="kv">
      <tr><th>Localisation</th><td>${esc(p2.geocodedAddress)} — ${esc(p2.commune)}</td></tr>
      <tr><th>Type de rue</th><td>${esc(sc.streetType ?? "—")}</td></tr>
      <tr><th>Accessibilité transport</th><td>${transportsHtml}</td></tr>
      <tr><th>Stationnement</th><td>${esc(parkingHtml)}</td></tr>
      <tr><th>Visibilité</th><td>${esc(sc.visibility ?? "—")}</td></tr>
      <tr><th>Flux piéton estimé</th><td>${esc(p2.fluxQualitative)}</td></tr>
    </table>
    ${p2.mapFile ? `<img class="map" src="${esc(p2.mapFile)}" alt="Carte de localisation"/>` : ""}
    <div class="note">L'estimation du flux piéton est basée sur les données des commerces voisins existants, pas sur un comptage physique du local analysé. Elle reflète l'intensité générale de la rue, pas le trafic exact devant cette devanture.</div>
  `);
}

// OSM category value -> short French label for the density table.
const CATEGORY_LABELS = {
  restaurant: "restaurant", hairdresser: "coiffeur", fast_food: "fast-food", clothes: "vêtements",
  vacant: "local vacant", cafe: "café", bakery: "boulangerie", bar: "bar", pub: "pub",
  supermarket: "supermarché", convenience: "supérette", pharmacy: "pharmacie", bank: "banque",
  beauty: "institut de beauté", optician: "opticien", florist: "fleuriste", shoes: "chaussures",
  books: "librairie", jewelry: "bijouterie", butcher: "boucherie", greengrocer: "primeur",
  tobacco: "tabac", hardware: "quincaillerie", car_repair: "garage", estate_agent: "agence immo",
  ice_cream: "glacier", marketplace: "marché", post_office: "bureau de poste",
};
const categoryLabel = (cat) => CATEGORY_LABELS[cat] || cat.replace(/_/g, " ");

// Pure SVG horizontal bars — guaranteed to print (no CSS background reliance).
function ageBarsSvg(ageBreakdown) {
  const ages = Object.entries(ageBreakdown);
  const max = Math.max(...ages.map(([, s]) => s || 0), 0.0001);
  const rowH = 22;
  const barX = 64;
  const barW = 360;
  const height = ages.length * rowH;
  const rows = ages
    .map(([bucket, share], i) => {
      const y = i * rowH;
      const cy = y + rowH / 2;
      const w = Math.round(((share || 0) / max) * barW);
      return `
        <text x="0" y="${cy + 4}" font-size="11" fill="#1a1a1a">${esc(bucket)}</text>
        <rect x="${barX}" y="${y + 4}" width="${barW}" height="14" rx="3" fill="#eef1f6"/>
        <rect x="${barX}" y="${y + 4}" width="${w}" height="14" rx="3" fill="${ACCENT}"/>
        <text x="${barX + barW + 8}" y="${cy + 4}" font-size="11" fill="#1a1a1a">${pct(share)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${barX + barW + 48} ${height}" width="100%" style="max-width:150mm;margin:2mm 0">${rows}</svg>`;
}

function densityRows(rings) {
  return rings
    .map((ring) => {
      const top = Object.entries(ring.byCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cat, n]) => `${categoryLabel(cat)} ${n}`)
        .join(", ");
      const radiusLabel = ring.radius >= 1000 ? "1 km" : `${ring.radius} m`;
      return `<tr><td>${radiusLabel}</td><td>${num(ring.total)}</td><td>${esc(top)}</td></tr>`;
    })
    .join("");
}

function buildPage3(meta, p3) {
  const monthly = p3.medianIncome ? Math.round(p3.medianIncome / 12) : null;
  const revenu = `${num(p3.medianIncome)} € / an (${num(monthly)} €/mois) — net déclaré — ${esc(incomeContext(p3.medianIncome))}`;

  return page(meta, 3, `
    <h2>Zone de chalandise</h2>
    ${p3.mapFile ? `<img class="map" src="${esc(p3.mapFile)}" alt="Carte des isochrones 5 et 10 min"/>` : ""}
    <table class="kv">
      <tr><th>Population (≈ 5 min à pied)</th><td>${num(p3.pop5)} habitants</td></tr>
      <tr><th>Population (≈ 10 min à pied)</th><td>${num(p3.pop10)} habitants</td></tr>
      <tr><th>Revenu médian (niveau de vie)</th><td>${revenu}</td></tr>
      <tr><th>Propriétaires de leur résidence</th><td>${pct(p3.ownerShare)}</td></tr>
    </table>
    <h3>Répartition par âge (zone 10 min)</h3>
    ${ageBarsSvg(p3.ageBreakdown)}
    <h3>Densité commerciale</h3>
    <table class="data"><thead><tr><th>Rayon</th><th>Total</th><th>Principales catégories</th></tr></thead>
      <tbody>${densityRows(p3.densityRings)}</tbody></table>
    ${p3.densityInterpretation ? `<p class="density-interp">${richText(p3.densityInterpretation)}</p>` : ""}
    <div class="note muted">${esc(p3.methodNote)}</div>
    ${p3.zoneSummary ? `<div class="zone-summary"><div class="zone-summary-label">Synthèse de zone</div>${richText(p3.zoneSummary)}</div>` : ""}
  `);
}

function buildPage4(meta, p4) {
  const complementarities = (p4.complementarities ?? "").trim();
  return page(meta, 4, `
    <h2>Analyse concurrentielle</h2>
    ${p4.mapFile ? `<img class="map" src="${esc(p4.mapFile)}" alt="Carte des concurrents"/>` : ""}
    <h3>Concurrence — rayon ${p4.radiusPrimary} m</h3>
    <table class="data concurrence">
      <thead><tr><th>N°</th><th>Nom</th><th>Distance</th><th>Concurrence</th><th>Note Google</th><th>Horaires</th></tr></thead>
      <tbody>${concurrenceRows(p4.directPrimary, p4.chainPrimary)}</tbody>
    </table>
    ${complementarities ? `<h3>Complémentarités</h3><p>${richText(complementarities)}</p>` : ""}
    <div class="zone-summary"><div class="zone-summary-label">Synthèse concurrentielle</div>${richText(p4.synthesis)}</div>
  `);
}

function buildPage5(meta, p5) {
  return page(meta, 5, `
    <h2>Adéquation sectorielle</h2>
    <h3>Adéquation flux / secteur</h3>
    <p>${richText(p5.fluxAdequacy)}</p>
    <h3>Adéquation démographique</h3>
    <p>${richText(p5.demographicAdequacy)}</p>
    <h3>Fourchette de chiffre d'affaires (indicative)</h3>
    <p>${richText(p5.revenueRange)}</p>
    ${p5.seasonality ? `<h3>Saisonnalité</h3><p>${richText(p5.seasonality)}</p>` : ""}
    <div class="zone-summary"><div class="zone-summary-label">Verdict d'adéquation — ${esc(p5.verdict)}</div>${richText(p5.justification)}</div>
  `);
}

// Rent section (template-computed): declared rent + €/m²/an + honest market note.
function rentSection(ra) {
  if (!ra || !ra.monthlyRent) {
    return `<p>Loyer non renseigné — rubrique non disponible. Indiquez le loyer demandé dans le formulaire pour activer cette analyse.</p>`;
  }
  const rentLine = `Loyer déclaré : ${num(ra.monthlyRent)} €/mois HC`;
  if (!ra.surfaceSqm) {
    return `<p>${rentLine}<br>Surface non renseignée — comparaison €/m²/an non calculable. Renseignez la surface pour activer cette analyse.</p>`;
  }
  const sale = ra.saleReference?.available
    ? `<br>À titre indicatif, prix de vente moyen des locaux commerciaux dans la commune : ${num(ra.saleReference.medianSalePricePerSqm)} €/m² (source DVF — prix d'achat, pas un loyer).`
    : "";
  return `<p>${rentLine}<br>Soit ${num(ra.rentPerSqmYear)} €/m²/an<br>Référence de loyer de marché non disponible pour cette zone via nos sources actuelles.${sale}</p>`;
}

function buildPage6(meta, p6) {
  return page(meta, 6, `
    <h2>Signaux de risque & points de vigilance</h2>
    <h3>Vacance commerciale</h3>
    <p>${richText(p6.vacancy)}</p>
    <h3>Dynamique commerciale</h3>
    <p><strong>Tendance : ${esc(p6.streetDynamics.trend)}.</strong> ${richText(p6.streetDynamics.text)}</p>
    <h3>Travaux de voirie</h3>
    <p>${richText(p6.worksNote)}</p>
    <h3>Loyer de marché</h3>
    ${rentSection(p6.rentAnalysis)}
    <h3>Risques sectoriels locaux</h3>
    ${listItems(p6.sectorRisks)}
    <h3>Recommandations avant signature</h3>
    ${listItems(p6.recommendations)}
  `);
}

// =====================================================================
// Document assembly + CSS
// =====================================================================

const STYLES = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1a1a1a; font-family: Inter, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 14mm 16mm 12mm; display: flex; flex-direction: column; page-break-after: always; position: relative; }
  .page:last-child { page-break-after: auto; }
  .content { flex: 1; }
  .hdr { display: flex; justify-content: space-between; font-size: 8pt; color: #777; border-bottom: 1px solid #e3e3e3; padding-bottom: 4mm; margin-bottom: 6mm; }
  .hdr-brand { font-weight: 700; color: ${ACCENT}; letter-spacing: .5px; }
  .ftr { display: flex; justify-content: space-between; font-size: 7.5pt; color: #999; border-top: 1px solid #e3e3e3; padding-top: 3mm; margin-top: 6mm; }
  h1 { font-size: 18pt; margin: 0; color: ${ACCENT}; }
  h2 { font-size: 14pt; margin: 0 0 5mm; color: ${ACCENT}; }
  h3 { font-size: 11pt; margin: 3mm 0 1.5mm; }
  p { margin: 0 0 3mm; }
  .muted { color: #888; }
  .note { font-size: 8.5pt; color: #666; font-style: italic; margin-top: 3mm; border-left: 3px solid #e3e3e3; padding-left: 3mm; }
  /* P1 */
  /* order summary (recap of form inputs) — must not compete with the verdict */
  .order-summary { display: flex; flex-wrap: wrap; gap: 2.5mm 8mm; background: #f7f8fa; border-left: 3px solid ${ACCENT}; border-radius: 0 5px 5px 0; padding: 3mm 4mm; margin: 4mm 0; font-size: 9pt; }
  .order-field { display: flex; flex-direction: column; }
  .order-field .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .3px; color: #8a8a8a; }
  .order-field .value { font-weight: 600; }
  .verdict-row { display: flex; align-items: center; gap: 12mm; margin: 8mm 0; }
  .score-box { display: flex; align-items: baseline; }
  .score-num { font-size: 54pt; font-weight: 800; line-height: 1; }
  .score-max { font-size: 16pt; color: #999; margin-left: 2mm; }
  .verdict-box { font-size: 34pt; font-weight: 800; border: 3px solid; border-radius: 8px; padding: 4mm 10mm; }
  .exec { font-size: 11pt; }
  .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 6mm 0; }
  .metric { height: 84px; border: 1px solid #e3e3e3; border-radius: 6px; background: #fafbfc; padding: 3mm 4mm; display: flex; flex-direction: column; }
  .metric-label { font-size: 8.5pt; color: #1a1a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
  .metric-value { font-size: 13pt; font-weight: 700; margin-top: 1mm; flex-shrink: 0; }
  .metric-badge { display: inline-block; margin-top: 1mm; padding: 0.3mm 1.6mm; font-size: 6.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; color: #8a6d00; background: #fff3cd; border: 1px solid #f0d675; border-radius: 3px; align-self: flex-start; }
  .metric-detail { margin-top: auto; align-self: flex-end; font-size: 7pt; color: #aaa; text-decoration: none; }
  .limitation { background: #fff8e1; border: 1px solid #f5c000; border-radius: 6px; padding: 3mm 4mm; font-size: 9pt; margin-bottom: 4mm; }
  .p1-footer { margin-top: auto; border-top: 1px solid #eee; padding-top: 3mm; }
  .p1-sources { font-size: 8pt; color: #666; }
  .p1-sources-note { font-size: 7.5pt; color: #999; font-style: italic; margin-top: 1mm; }
  .disclaimer { font-size: 8pt; color: #888; margin-top: 2mm; }
  /* tables */
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9.5pt; }
  .kv th { text-align: left; width: 45%; color: #555; font-weight: 600; vertical-align: top; padding: 2mm 3mm 2mm 0; }
  .kv td { padding: 2mm 0; }
  .data th, .data td { border: 1px solid #e3e3e3; padding: 2mm 3mm; text-align: left; }
  .data thead th { background: #f5f7fb; }
  /* maps */
  .map { width: 100%; height: auto; border: 1px solid #e3e3e3; border-radius: 6px; margin: 3mm 0; }
  /* P3 specifics */
  .density-interp { font-size: 9.5pt; margin: 2mm 0; }
  .zone-summary { background: #f2f6fc; border-radius: 6px; padding: 3mm 4mm; margin-top: 3mm; font-size: 9.5pt; }
  .zone-summary-label { font-size: 8pt; text-transform: uppercase; letter-spacing: .3px; color: ${ACCENT}; font-weight: 700; margin-bottom: 1.5mm; }
  .verdict-adeq { margin: 4mm 0 2mm; font-size: 11pt; }
  .synthesis { text-align: justify; }
  /* P4 merged competitor table — readable */
  .concurrence { font-size: 9pt; }
  .concurrence th, .concurrence td { padding: 1.2mm 2.5mm; vertical-align: top; }
  .concurrence th:first-child, .concurrence td:first-child { text-align: center; }
  .leg-num { font-weight: 700; text-align: center; }
  .avis { color: #888; font-size: 8pt; }
  .hours-cell { font-size: 8.5pt; }
`;

function buildReportHtml(data) {
  const { meta } = data;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>${esc(meta.service)} — ${esc(meta.address)}</title>
<style>${STYLES}</style>
</head>
<body>
${buildPage1(meta, data.p1, data.order, data.dataQuality)}
${buildPage2(meta, data.p2)}
${buildPage3(meta, data.p3)}
${buildPage4(meta, data.p4)}
${buildPage5(meta, data.p5)}
${buildPage6(meta, data.p6)}
</body>
</html>`;
}

module.exports = { buildReportHtml };
