import { llmJson as rawLlmJson } from "./llm";
import { corpusForPrompt, resolveCitations, unverifiedMentions, type Citation, type ResolvedCitation } from "./corpus";

// ---------- types ----------
export type Stage = "intake" | "confirm" | "evidence" | "done";

export interface Story {
  summary: string;
  timeline: { when: string; what: string }[];
  opposite_party: string | null;
  platform: string | null;
  amount_inr: number | null;
  payment_method: string | null;
  proof_mentioned: string[];
  user_goal: string | null;
  months_since_event: number | null;
  event_date?: string | null; // earliest relevant event, YYYY-MM-DD or YYYY-MM
  flags: { threats_or_violence: boolean; court_case_filed: boolean; out_of_scope: boolean };
}

export interface Analysis {
  issue_type: string;
  plain_explanation: string;
  provisions: ResolvedCitation[];
  evidence_checklist: { item: string; why: string; mentioned_by_user: boolean }[];
  ask: string;
}

export interface Plan {
  evidence_have: string[];
  evidence_missing: string[];
  steps: { title: string; detail: string; where: string }[];
  forum: string;
  confidence: "high" | "medium" | "low";
  summary: string;
  draft_document: { type: "legal_notice" | "complaint" | "reply_to_notice" | "application" | "none"; text: string };
}

export interface Verdict {
  level: "can_help" | "partly" | "needs_lawyer";
  reasons: string[];
}

export interface CaseState {
  stage: Stage;
  story: Story | null;
  analysis: Analysis | null;
  plan: Plan | null;
  verdict: Verdict | null;
  transcript: { role: "user" | "assistant"; text: string }[];
  mode?: "advice" | "practice";
  practice?: { turns: { role: "opponent" | "user"; text: string }[] };
}

export interface PracticeFeedback {
  strength: "weak" | "ok" | "strong";
  what_worked: string;
  what_to_fix: string;
  better_answer: string;
}
export interface PracticeSummary {
  strengths: string[];
  weak_spots: string[];
  bring_to_hearing: string[];
  tips: string[];
}
export interface PracticeOut {
  briefing?: { tactic: string; how_it_is_used: string }[];
  feedback?: PracticeFeedback;
  tactic_used?: string;
  summary?: PracticeSummary;
}

export interface TurnResult {
  state: CaseState;
  reply: string;
  analysis?: Analysis;
  plan?: Plan;
  verdict?: Verdict;
  practice?: PracticeOut;
  warnings: string[];
}

export const newCase = (): CaseState => ({
  stage: "intake", story: null, analysis: null, plan: null, verdict: null, transcript: [],
});

// ---------- prompts ----------
const BASE = `You are an AI legal-information assistant for ordinary people in India, focused on consumer disputes, refunds, and online payment scams. You are NOT a lawyer and you never claim to be.
RULES:
- Reply in the language given on the "REPLY LANGUAGE" line of the input, and no other. Keep all JSON keys in English. Use plain, simple words.
- NEVER invent laws, sections, rules, amounts, deadlines, court cases or website names. You may cite a legal source only by an id from the LAW FILE when one is provided. If the LAW FILE does not cover something, say you are not sure and suggest a lawyer.
- Never mention the IPC; criminal law now is the BNS. Never cite court cases. Never promise outcomes or refund dates.
- Do not give legal advice as certain; give information and next steps.
- Return ONLY one JSON object, matching the schema asked.`;

const INTAKE = `STAGE: INTAKE. Turn the user's messy story into a structured case. Merge the new message into the previous story.
Schema:
{"reply": string, "ready": boolean,
 "story": {"summary": string, "timeline": [{"when": string, "what": string}], "opposite_party": string|null, "platform": string|null, "amount_inr": number|null, "payment_method": string|null, "proof_mentioned": string[], "user_goal": string|null, "months_since_event": number|null, "event_date": string|null,
   "flags": {"threats_or_violence": boolean, "court_case_filed": boolean, "out_of_scope": boolean}}}
- NEVER refuse, and never tell the user to see a lawyer at this stage. Always keep gathering facts, whatever the problem (consumer refund, scam, rental deposit, unpaid salary, loan or documents held by a lender, a notice received, etc.).
- court_case_filed = true ONLY if the user says a court case has actually been FILED or they received a court summons or court order. A demand letter, legal notice, or a threat to "file a case" from a company or lawyer is NOT a court case: set false.
- out_of_scope = true ONLY for problems that are not about money, property, documents or services at all (e.g. divorce, child custody, serious violence).
- If key facts are missing (what was bought/paid, how much, when, what the seller said/did, what the user wants), set ready=false and make "reply" a short acknowledgement plus at most 2 simple questions.
- If you have enough, set ready=true and make "reply" a short restatement of the story in the user's language: what happened, when, amount, and what they want, then ask "Is this correct? Say yes, or tell me what to change."
- event_date = the date the WRONG happened, i.e. when the claim arose, NOT the original deal date: the date delivery/refund was due or refused, the date the tenant vacated or the deposit was refused, the date salary became overdue, or the date a lender refused to return documents after repayment. If that date is unknown, use null. Format YYYY-MM-DD, or YYYY-MM if only month is known, resolved using TODAY'S DATE for phrases like "two weeks ago". Never guess; use null if not stated.
- Use null when unknown. Do not guess amounts or dates.`;

const CONFIRM = `STAGE: CONFIRM. The user was shown a restated story. Decide if they confirmed it.
Schema: {"confirmed": boolean, "reply": string, "story": <full updated story, same shape as before>}
- confirmed=true only if they clearly agree. If they correct something, update the story, set confirmed=false, and make "reply" a short restatement ending with "Is this correct?".`;

const ANALYZE = `STAGE: ANALYSIS. Using the confirmed story and ONLY the LAW FILE, explain where the user stands.
Schema:
{"issue_type": string (one id from ISSUE TYPES, or "other"),
 "plain_explanation": string (4-6 plain sentences in the user's language: what rights/options exist; say what is uncertain),
 "provisions": [{"id": string (from LAW FILE), "why": string (one sentence in the user's language: why it helps this case)}],
 "evidence_checklist": [{"item": string, "why": string, "mentioned_by_user": boolean}] (5-8 items, in the user's language),
 "ask": string (in the user's language: ask which of these proofs they have, and whether they have already contacted the seller/platform/bank)}
- Cite at most 6 provisions, only ids that exist in the LAW FILE and truly fit. Prefer fewer. Respect each Caveat. An entry that fits but is state-specific, a model law, or flagged as a general route is STILL worth citing: cite it and say the caveat in "why" (for example "applies only if your state has adopted it").
- If nothing in the LAW FILE fits, return an empty provisions list, but STILL explain in plain words the general practical position (what the person can usually do), and say clearly that this part is general guidance and not from the verified law file. NEVER answer only with "see a lawyer": always help as far as you honestly can first.`;

const PLAN = `STAGE: ACTION PLAN. Using the story, the analysis and ONLY the LAW FILE, make a step-by-step plan.
Schema:
{"evidence_have": string[], "evidence_missing": string[],
 "steps": [{"title": string, "detail": string, "where": string}] (ordered, 3-7 steps, e.g. contact seller in writing, call NCH 1915, send legal notice, file on the e-Jagriti portal, report at cybercrime.gov.in / 1930, tell the bank, RBI Ombudsman, free legal aid; prefer steps supported by the LAW FILE; if the case is not covered, still give practical general steps such as a written demand with proof, keeping records, a formal notice, free legal aid (DLSA / NALSA 15100, Lok Adalat, if in the LAW FILE), and a police complaint where a crime like cheating or intimidation is involved, and start such a step's title with "(General) "; NEVER reply with only "consult a lawyer"),
 "forum": string (which forum and why, e.g. District Consumer Commission; use the amount paid and the LAW FILE limits),
 "confidence": "high"|"medium"|"low" (how well the LAW FILE covers this case),
 "summary": string (short wrap-up in the user's language),
 "draft_document": {"type": "legal_notice"|"complaint"|"reply_to_notice"|"application"|"none", "text": string}}
- draft_document.text is in ENGLISH, formal but simple, using placeholders like [YOUR NAME], [DATE], [ORDER ID]. Include only facts from the story. If citing law, use only ids/sections from the LAW FILE, written as the file writes them. Choose "legal_notice" for a first demand (to a seller, landlord, employer or lender); "reply_to_notice" if the user RECEIVED a notice and needs a reply; "complaint" or "application" when a complaint or application to an authority fits better; "none" if a notice makes no sense (e.g. an unauthorised bank transaction: then the first move is reporting to the bank and 1930).
- Do not state deadlines or numbers that are not in the LAW FILE.
- LANGUAGE: "summary", "forum" and every step's title/detail/where must be in the REPLY LANGUAGE. Only draft_document.text is always English.`;

const QA = `STAGE: FOLLOW-UP. Answer the user's follow-up question using the case, the analysis and ONLY the LAW FILE.
Schema: {"reply": string, "provisions": [{"id": string, "why": string}]}
- If the answer is not in the LAW FILE, say you are not sure and suggest a lawyer or the free legal aid helpline (NALSA 15100) if that is in the LAW FILE.`;

// ---------- helpers ----------
const MAX_TURNS = 16;

const SCRIPTS: [RegExp, string][] = [
  [/[ऀ-ॿ]/, "Hindi or Marathi (Devanagari script)"],
  [/[ఀ-౿]/, "Telugu (Telugu script)"],
  [/[஀-௿]/, "Tamil (Tamil script)"],
  [/[ಀ-೿]/, "Kannada (Kannada script)"],
  [/[ഀ-ൿ]/, "Malayalam (Malayalam script)"],
  [/[ঀ-৿]/, "Bengali (Bengali script)"],
  [/[઀-૿]/, "Gujarati (Gujarati script)"],
];

/** Language is detected in code from the user's own text, not left to the model. */
function replyLanguage(state: CaseState, latest: string): string {
  const userText = [...state.transcript.filter((t) => t.role === "user").map((t) => t.text), latest].join(" ");
  for (const [re, name] of SCRIPTS) if (re.test(userText)) return name;
  return "ENGLISH ONLY. The user wrote in English, so every text field must be in plain English with Latin letters. Do NOT use Hindi or Devanagari";
}

function convo(state: CaseState, latest: string): string {
  const past = state.transcript
    .slice(-MAX_TURNS)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
    .join("\n");
  return `TODAY'S DATE: ${new Date().toISOString().slice(0, 10)}\nREPLY LANGUAGE: ${replyLanguage(state, latest)}\n\nCONVERSATION SO FAR:\n${past || "(none)"}\n\nLATEST USER MESSAGE:\n${latest}`;
}

const ctx = (s: CaseState) =>
  `CASE STORY (JSON): ${JSON.stringify(s.story)}\nANALYSIS (JSON): ${JSON.stringify(s.analysis)}`;

/** Deterministic rules decide "can this tool handle it" - not the model alone. */
export function decideVerdict(story: Story, analysis: Analysis, confidence?: Plan["confidence"]): Verdict {
  const lawyer: string[] = [];
  const partly: string[] = [];

  // A lawyer is suggested IN ADDITION to the steps below, never instead of them.
  const consumerTypes = ["refund_or_nondelivery", "ecommerce_platform", "misleading_ads_dark_patterns"];
  const isConsumer = consumerTypes.includes(analysis.issue_type);

  if (story.flags.threats_or_violence)
    lawyer.push("There are threats, blackmail or violence involved. Report it to the police now, keep all messages, and involve a lawyer. The steps below still apply.");
  if (story.flags.court_case_filed)
    lawyer.push("A court case or summons already exists. Do not ignore it. A lawyer should appear for you; Legal Aid (NALSA 15100) is free if you qualify.");
  // Limits from Consumer Protection (Jurisdiction) Rules, 2021 (corpus RULES-JURIS-2021) and CPA s.69 / Limitation Act (CPA-69, LIM-47-55).
  if (isConsumer && story.amount_inr !== null && story.amount_inr > 5_000_000)
    lawyer.push("The amount is above Rs 50 lakh, which is beyond the District Consumer Commission. A lawyer is strongly advised.");
  if (story.months_since_event !== null && story.months_since_event >= (isConsumer ? 21 : 33))
    lawyer.push(isConsumer
      ? "The problem is close to or past the 2-year consumer complaint time limit. A lawyer should check whether you can still file."
      : "The problem is close to or past the usual 3-year limit for civil claims. A lawyer should check whether you can still sue.");

  if (lawyer.length) return { level: "needs_lawyer", reasons: lawyer };

  if (story.flags.out_of_scope || analysis.issue_type === "other")
    partly.push("This kind of problem is only partly covered by the verified laws in this tool, so parts of the guidance below are general.");
  if (analysis.provisions.length === 0 && !partly.length)
    partly.push("None of the verified laws in this tool clearly fit, so the guidance below is general.");
  if (analysis.issue_type === "cheating_scam" || analysis.issue_type === "payment_fraud")
    partly.push("Scam and fraud cases need police and bank action that this tool can only guide you to. Get a lawyer if the police or bank refuse to act.");
  if (confidence === "low" || confidence === "medium") partly.push("Some parts of your case are not clearly covered by the verified laws here.");
  if (story.amount_inr !== null && story.amount_inr > 1_000_000)
    partly.push("The amount is large. Consider a lawyer even if you start on your own.");
  if (partly.length) return { level: "partly", reasons: partly };

  return { level: "can_help", reasons: ["This is covered by the verified laws in this tool. You can start on your own with the steps below."] };
}

/** Age of the problem is computed in code from event_date, not trusted from the model. */
function withComputedAge(story: Story): Story {
  const m = story.event_date?.match(/^(\d{4})-(\d{2})/);
  if (m) {
    const now = new Date();
    const months = (now.getFullYear() - +m[1]) * 12 + (now.getMonth() + 1 - +m[2]);
    story.months_since_event = Math.max(0, months);
  }
  return story;
}

function warn(texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const m of unverifiedMentions(t)) found.add(m);
  return [...found].map((m) => `Could not verify against our law file: ${m}. Please ignore it or ask a lawyer.`);
}

// Hindi/Hinglish detector for the English case: Indic script, or several common romanised-Hindi words.
const HINGLISH = /\b(aapne|aap|kiya|kiye|hai|hain|nahi|kya|liye|toh|aur|bhi|chahte|chahta|boliye|batayiye|sahi|nikal|karna|mera|meri|paise|rupees|ne|ko|ke|ka|ki)\b/gi;
function notEnglish(obj: unknown): boolean {
  const t = JSON.stringify(obj);
  if (/[ऀ-෿]/.test(t)) return true;
  return (t.match(HINGLISH) ?? []).length >= 4;
}

/** One model call with the language enforced: if the user wrote English and the reply is not, retry once. */
async function ask<T>(req: { system: string; user: string }, lang: string): Promise<T> {
  const english = lang.startsWith("ENGLISH");
  const system = `${req.system}\nREPLY LANGUAGE (mandatory): ${lang}`;
  let r = await rawLlmJson<T>({ system, user: req.user });
  if (english && notEnglish(r)) {
    r = await rawLlmJson<T>({
      system,
      user: req.user + "\n\nYour previous answer used Hindi or Hinglish. Return the JSON again with EVERY text field in plain English. No Hindi words, even written in English letters.",
    });
  }
  return r;
}

// ---------- practice mode: the AI plays the other side ----------
const PRACTICE_ROLE = `ROLE: You play the OPPOSING side's lawyer or representative (the seller / company / platform / bank) in a mock hearing or negotiation, so the user can practise. Be firm but fair and polite, never abusive. This is a learning simulation, not a prediction of what any real forum will decide.
- Use only the CASE and the LAW FILE. Never invent laws, sections, court cases, or facts about the user's case that the user did not state.
- Tactics you may use, only if plausible for THIS case: doubting the proof, pointing to delay or the time limit, "terms and conditions / no-refund policy", blaming the user (shared OTP, installed an app, did not read the policy), saying the claim is exaggerated, wrong forum, user did not complain to the grievance officer first, commercial-purpose purchase, denying delivery attempts, blaming the courier.`;

const PRACTICE_START = `STAGE: PRACTICE START.
Schema: {"intro": string (2 sentences: who you are playing and that this is practice), "briefing": [{"tactic": string, "how_it_is_used": string}] (4-6 tactics most likely against THIS user, one line each), "question": string (your first hard question)}`;

const PRACTICE_ANSWER = `STAGE: PRACTICE ANSWER. Judge the user's last answer, then ask the next question.
Schema: {"feedback": {"strength": "weak"|"ok"|"strong", "what_worked": string, "what_to_fix": string, "better_answer": string (short model answer using only the user's stated facts and the LAW FILE)}, "tactic_used": string (the tactic your last question used), "question": string (next question; switch or escalate the tactic; return "" if the user has answered 5 or more questions)}`;

const PRACTICE_SUMMARY = `STAGE: PRACTICE SUMMARY. Summarise how the user did across the whole practice.
Schema: {"strengths": string[], "weak_spots": string[], "bring_to_hearing": string[] (documents and proof to carry), "tips": string[] (3-5 short, practical)}`;

async function runPractice(
  s: CaseState, action: string | undefined, userText: string, lang: string, warnings: string[]
): Promise<TurnResult> {
  const sys = (stage: string) => BASE + "\n\n" + PRACTICE_ROLE + "\n\n" + stage + "\n\n" + corpusForPrompt();
  const base = `${ctx(s)}\nPLAN (JSON): ${JSON.stringify(s.plan)}`;
  const log = () => (s.practice?.turns ?? []).map((t) => `${t.role === "opponent" ? "Opposing lawyer" : "User"}: ${t.text}`).join("\n");
  const summarize = async (): Promise<PracticeSummary> => {
    const sum = await ask<PracticeSummary>({ system: sys(PRACTICE_SUMMARY), user: `${base}\nPRACTICE SO FAR:\n${log()}` }, lang);
    s.mode = "advice";
    return sum;
  };

  if (action === "practice_start") {
    const r = await ask<{ intro: string; briefing: PracticeOut["briefing"]; question: string }>(
      { system: sys(PRACTICE_START), user: base }, lang);
    s.mode = "practice";
    s.practice = { turns: [{ role: "opponent", text: r.question }] };
    warnings.push(...warn([r.intro, r.question, ...(r.briefing ?? []).map((b) => b.how_it_is_used)]));
    return { state: s, reply: `${r.intro}\n\n${r.question}`, practice: { briefing: r.briefing }, warnings };
  }
  if (action === "practice_end") {
    const summary = await summarize();
    return { state: s, reply: "Practice ended. Here is how you did.", practice: { summary }, warnings };
  }
  // normal turn inside practice: the user answered the opposing lawyer
  s.practice ??= { turns: [] };
  s.practice.turns.push({ role: "user", text: userText });
  const r = await ask<{ feedback: PracticeFeedback; tactic_used: string; question: string }>(
    { system: sys(PRACTICE_ANSWER), user: `${base}\nPRACTICE SO FAR:\n${log()}` }, lang);
  warnings.push(...warn([r.feedback?.better_answer ?? "", r.question ?? ""]));
  if (!r.question) {
    const summary = await summarize();
    return { state: s, reply: "That is the end of the practice round.", practice: { feedback: r.feedback, tactic_used: r.tactic_used, summary }, warnings };
  }
  s.practice.turns.push({ role: "opponent", text: r.question });
  return { state: s, reply: r.question, practice: { feedback: r.feedback, tactic_used: r.tactic_used }, warnings };
}

// ---------- main entry ----------
export async function runTurn(
  state: CaseState, userText: string, action?: "practice_start" | "practice_end"
): Promise<TurnResult> {
  const s: CaseState = JSON.parse(JSON.stringify(state));
  const lang = replyLanguage(s, userText);
  const llmJson = <T,>(req: { system: string; user: string }) => ask<T>(req, lang);
  const warnings: string[] = [];
  let reply = "";
  let analysis: Analysis | undefined;
  let plan: Plan | undefined;

  if ((action === "practice_start" || action === "practice_end" || s.mode === "practice") && s.stage === "done") {
    return runPractice(s, action, userText, lang, warnings);
  }

  if (s.stage === "intake") {
    const r = await llmJson<{ reply: string; ready: boolean; story: Story }>({
      system: BASE + "\n\n" + INTAKE,
      user: `PREVIOUS STORY: ${JSON.stringify(s.story)}\n\n${convo(s, userText)}`,
    });
    s.story = withComputedAge(r.story);
    reply = r.reply;
    if (r.ready) s.stage = "confirm";
  } else if (s.stage === "confirm") {
    const r = await llmJson<{ confirmed: boolean; reply: string; story: Story }>({
      system: BASE + "\n\n" + CONFIRM,
      user: `STORY SHOWN: ${JSON.stringify(s.story)}\n\n${convo(s, userText)}`,
    });
    if (r.story) s.story = withComputedAge(r.story);
    if (r.confirmed) {
      const a = await llmJson<{ issue_type: string; plain_explanation: string; provisions: Citation[]; evidence_checklist: Analysis["evidence_checklist"]; ask: string }>({
        system: BASE + "\n\n" + ANALYZE + "\n\n" + corpusForPrompt(),
        user: `CONFIRMED STORY: ${JSON.stringify(s.story)}\n\n${convo(s, userText)}`,
      });
      const { valid, dropped } = resolveCitations(a.provisions);
      if (dropped.length) warnings.push(`Removed ${dropped.length} citation(s) that are not in the verified law file.`);
      analysis = {
        issue_type: a.issue_type,
        plain_explanation: a.plain_explanation,
        provisions: valid,
        evidence_checklist: a.evidence_checklist ?? [],
        ask: a.ask,
      };
      warnings.push(...warn([a.plain_explanation, ...valid.map((v) => v.why)]));
      s.analysis = analysis;
      s.stage = "evidence";
      reply = `${a.plain_explanation}\n\n${a.ask}`;
    } else {
      reply = r.reply;
    }
  } else if (s.stage === "evidence") {
    const p = await llmJson<Plan>({
      system: BASE + "\n\n" + PLAN + "\n\n" + corpusForPrompt(),
      user: `${ctx(s)}\n\n${convo(s, userText)}`,
    });
    plan = p;
    s.plan = p;
    s.verdict = decideVerdict(s.story!, s.analysis!, p.confidence);
    warnings.push(...warn([p.summary, p.forum, ...p.steps.map((x) => x.detail), p.draft_document?.text ?? ""]));
    s.stage = "done";
    reply = p.summary;
  } else {
    const r = await llmJson<{ reply: string; provisions: Citation[] }>({
      system: BASE + "\n\n" + QA + "\n\n" + corpusForPrompt(),
      user: `${ctx(s)}\n\n${convo(s, userText)}`,
    });
    const { valid, dropped } = resolveCitations(r.provisions);
    if (dropped.length) warnings.push(`Removed ${dropped.length} citation(s) that are not in the verified law file.`);
    warnings.push(...warn([r.reply]));
    reply = r.reply;
    if (valid.length) reply += "\n\nSources: " + valid.map((v) => `${v.instrument}, ${v.reference}`).join("; ");
  }

  s.transcript.push({ role: "user", text: userText }, { role: "assistant", text: reply });
  return { state: s, reply, analysis, plan, verdict: s.verdict ?? undefined, warnings };
}
