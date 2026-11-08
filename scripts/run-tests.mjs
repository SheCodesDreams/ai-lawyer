// Runs scripted conversations (tests/cases.json) against a running app and saves
// unedited raw outputs to outputs/raw/<case>.json plus a summary table.
// Usage: node scripts/run-tests.mjs [baseUrl]   (default http://localhost:3000)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const only = process.env.ONLY ? process.env.ONLY.split(",") : null; // ONLY=03,09 reruns just those case ids (prefix match)
const cases = JSON.parse(readFileSync(join(root, "tests", "cases.json"), "utf8")).filter((c) => !only || only.some((o) => c.id.startsWith(o)));
const outDir = join(root, "outputs", "raw");
mkdirSync(outDir, { recursive: true });

const PAUSE_MS = Number(process.env.PAUSE_MS ?? 7000); // stay under free-tier per-minute limits
async function post(state, message) {
  await new Promise((r) => setTimeout(r, PAUSE_MS));
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, message }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const SCRIPTS = { devanagari: /[ऀ-ॿ]/, telugu: /[ఀ-౿]/ };
const allText = (turns) => turns.map((t) => t.result.reply + " " + (t.result.plan ? JSON.stringify(t.result.plan) : "")).join("\n");

const rows = [];
for (const c of cases) {
  const started = Date.now();
  const turns = [];
  let state = null, error = null;
  try {
    const send = async (label, msg) => {
      const result = await post(state, msg);
      state = result.state;
      turns.push({ label, user: msg, result });
      return result;
    };
    let r = await send("story", c.story);
    if (r.state.stage === "intake" && c.extra) r = await send("extra details", c.extra);
    // The tool may keep asking questions; a real user would say "that is all I know". Vague-input cases stay in intake on purpose.
    for (let i = 0; i < 2 && r.state.stage === "intake" && c.extra; i++) r = await send("no more details", "That is all the information I have. Please continue.");
    if (r.state.stage === "confirm") r = await send("confirm", "Yes, that is correct.");
    if (r.state.stage === "evidence" && c.proofs) r = await send("proofs", c.proofs);
    if (r.state.stage === "done" && c.followup) r = await send("follow-up", c.followup);
  } catch (e) {
    error = String(e.message || e);
  }
  const seconds = Math.round((Date.now() - started) / 1000);

  // ---- checks against expectations (failures are reported, not hidden) ----
  const ex = c.expect || {};
  const last = turns[turns.length - 1]?.result;
  const verdictTurn = [...turns].reverse().find((t) => t.result.verdict)?.result;
  const analysisTurn = [...turns].reverse().find((t) => t.result.analysis)?.result;
  const verdict = verdictTurn?.verdict?.level;
  const issue = analysisTurn?.analysis?.issue_type;
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  if (error) check("no error", false, error);
  if (ex.verdict) check(`verdict = ${ex.verdict}`, verdict === ex.verdict, verdict);
  if (ex.verdict_in) check(`verdict in ${ex.verdict_in.join("/")}`, ex.verdict_in.includes(verdict), verdict);
  if (ex.issue_type) check(`issue_type = ${ex.issue_type}`, issue === ex.issue_type, issue);
  if (ex.issue_type_in) check(`issue_type in ${ex.issue_type_in.join("/")}`, ex.issue_type_in.includes(issue), issue);
  if (ex.stay_in_intake) check("still asking questions (no plan)", last?.state.stage === "intake", last?.state.stage);
  if (ex.language_script) {
    const botText = turns.map((t) => t.result.reply).join(" ");
    check(`replied in ${ex.language_script}`, SCRIPTS[ex.language_script].test(botText));
  }
  if (ex.must_mention_regex) check(`mentions /${ex.must_mention_regex}/`, new RegExp(ex.must_mention_regex).test(allText(turns)));
  if (ex.must_cite_any) {
    const ids = (analysisTurn?.analysis?.provisions ?? []).map((p) => p.id);
    check(`cites one of ${ex.must_cite_any.join("/")}`, ex.must_cite_any.some((x) => ids.includes(x)), ids.join(",") || "nothing");
  }
  if (ex.draft_type_in) {
    const dt = [...turns].reverse().find((t) => t.result.plan)?.result.plan?.draft_document?.type;
    check(`draft type in ${ex.draft_type_in.join("/")}`, ex.draft_type_in.includes(dt), dt);
  }
  if (ex.forbidden_regex) check(`avoids /${ex.forbidden_regex}/`, !new RegExp(ex.forbidden_regex, "i").test(allText(turns)));
  const warnings = turns.flatMap((t) => t.result.warnings || []);

  const pass = checks.every((k) => k.ok);
  const row = { id: c.id, pass, verdict, issue, seconds, warnings: warnings.length, failed: checks.filter((k) => !k.ok).map((k) => `${k.name} (got ${k.detail ?? "no"})`) };
  writeFileSync(join(outDir, `${c.id}.json`), JSON.stringify({ case: c, seconds, checks, row, turns }, null, 2));
  rows.push(row);
  console.log(`${pass ? "PASS" : "FAIL"} ${c.id} verdict=${verdict} issue=${issue} ${seconds}s warnings=${warnings.length}`);
  for (const f of rows[rows.length - 1].failed) console.log("   - " + f);
}

// Summary covers every case in outputs/raw (so partial reruns update the table instead of replacing it).
const all = readdirSync(outDir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(outDir, f), "utf8")).row).filter(Boolean);
rows.length = 0; rows.push(...all);
const passed = rows.filter((r) => r.pass).length;
const md = [
  `# Test run summary`,
  `Run against ${base} on ${new Date().toISOString()}. Raw, unedited outputs are in outputs/raw/.`,
  ``,
  `**${passed}/${rows.length} cases met their expectations.**`,
  ``,
  `| Case | Result | Verdict | Issue type | Time | Warnings | Failed checks |`,
  `|---|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.id} | ${r.pass ? "PASS" : "FAIL"} | ${r.verdict ?? "-"} | ${r.issue ?? "-"} | ${r.seconds}s | ${r.warnings} | ${r.failed.join("; ") || "-"} |`),
].join("\n");
writeFileSync(join(root, "outputs", "summary.md"), md + "\n");
console.log(`\n${passed}/${rows.length} passed. Summary: outputs/summary.md`);
