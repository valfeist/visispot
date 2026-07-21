/**
 * Loads .env into process.env using Node's built-in loader
 * (process.loadEnvFile, Node >= 20.12 — no dependency needed).
 *
 * Require this once, before reading any process.env.* key.
 * See CONVENTIONS.md > API keys.
 */

const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, ".env");

if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
} else {
  console.warn(
    "WARNING: .env not found — copy .env.example to .env and fill in your API keys."
  );
}
