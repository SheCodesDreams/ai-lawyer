// Validates data/laws.json: structure, unique ids, known issue types, source info.
// Usage: node scripts/validate-corpus.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "data", "laws.json");
const corpus = JSON.parse(readFileSync(file, "utf8"));

const errors = [];
const warnings = [];
const KINDS = new Set(["provision", "rule", "procedure"]);
const SOURCE_TYPES = new Set(["official", "secondary"]);
const VERIFICATION = new Set(["verified", "unverified"]);
const REQUIRED = [
  "id", "kind", "instrument", "reference", "title", "summary",
  "applies_when", "issue_types", "source_url", "source_type",
  "verification", "verified_on",
];

const issueIds = new Set((corpus.issue_types ?? []).map((t) => t.id));
if (issueIds.size === 0) errors.push("no issue_types defined");

const seen = new Set();
for (const e of corpus.entries ?? []) {
  const where = `entry ${e.id ?? "(no id)"}`;
  for (const k of REQUIRED) {
    if (e[k] === undefined || e[k] === "" || (Array.isArray(e[k]) && e[k].length === 0)) {
      errors.push(`${where}: missing '${k}'`);
    }
  }
  if (e.id) {
    if (seen.has(e.id)) errors.push(`${where}: duplicate id`);
    seen.add(e.id);
    if (!/^[A-Za-z0-9._-]+$/.test(e.id)) errors.push(`${where}: id has odd characters`);
  }
  if (e.kind && !KINDS.has(e.kind)) errors.push(`${where}: bad kind '${e.kind}'`);
  if (e.source_type && !SOURCE_TYPES.has(e.source_type)) errors.push(`${where}: bad source_type`);
  if (e.verification && !VERIFICATION.has(e.verification)) errors.push(`${where}: bad verification`);
  if (e.source_url && !/^https?:\/\//.test(e.source_url)) errors.push(`${where}: source_url not a URL`);
  for (const t of e.issue_types ?? []) {
    if (!issueIds.has(t)) errors.push(`${where}: unknown issue type '${t}'`);
  }
  if (e.verification === "unverified") warnings.push(`${where}: UNVERIFIED — review before relying on it`);
  if (e.source_type === "secondary") warnings.push(`${where}: only a secondary source`);
}

for (const t of issueIds) {
  if (!(corpus.entries ?? []).some((e) => e.issue_types?.includes(t))) {
    warnings.push(`issue type '${t}' has no entries`);
  }
}

const total = (corpus.entries ?? []).length;
const official = (corpus.entries ?? []).filter((e) => e.source_type === "official").length;
console.log(`entries: ${total} (official source: ${official}, secondary: ${total - official})`);
for (const w of warnings) console.log("WARN ", w);
for (const er of errors) console.log("ERROR", er);
if (errors.length) {
  console.log(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log("\ncorpus OK");
