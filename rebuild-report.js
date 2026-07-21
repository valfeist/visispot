/**
 * Rebuilds report.html from a saved report-data.json WITHOUT re-running the
 * pipeline (no API calls). Use for fast template iteration.
 *
 * Run with:  node rebuild-report.js <report-folder-name>
 * Defaults to the most recently modified folder in output/.
 */

const fs = require("node:fs");
const path = require("node:path");
const { buildReportHtml } = require("./report-builder");

const OUTPUT_DIR = path.join(__dirname, "output");

function latestReportFolder() {
  const folders = fs
    .readdirSync(OUTPUT_DIR)
    .map((name) => path.join(OUTPUT_DIR, name))
    .filter((p) => fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "report-data.json")));
  if (folders.length === 0) throw new Error("No report-data.json found under output/.");
  return folders.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

const arg = process.argv[2];
const dir = arg ? path.join(OUTPUT_DIR, arg) : latestReportFolder();
const data = JSON.parse(fs.readFileSync(path.join(dir, "report-data.json"), "utf8"));

fs.writeFileSync(path.join(dir, "report.html"), buildReportHtml(data));
console.log("Rebuilt:", path.join(dir, "report.html"));
