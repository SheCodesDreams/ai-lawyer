"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis, CaseState, Plan, PracticeOut, Story, TurnResult, Verdict } from "@/lib/pipeline";

interface Msg {
  role: "user" | "bot";
  text: string;
  story?: Story;
  practice?: PracticeOut;
  analysis?: Analysis;
  plan?: Plan;
  verdict?: Verdict;
  warnings?: string[];
}

const STAGES: { id: CaseState["stage"]; label: string }[] = [
  { id: "intake", label: "1 Your story" },
  { id: "confirm", label: "2 Confirm" },
  { id: "evidence", label: "3 Proofs" },
  { id: "done", label: "4 Plan" },
];

const LANGS = [
  { code: "en-IN", label: "English" }, { code: "hi-IN", label: "हिन्दी" }, { code: "te-IN", label: "తెలుగు" },
  { code: "ta-IN", label: "தமிழ்" }, { code: "kn-IN", label: "ಕನ್ನಡ" }, { code: "ml-IN", label: "മലയാളം" },
  { code: "bn-IN", label: "বাংলা" }, { code: "mr-IN", label: "मराठी" },
];

const VERDICT_TEXT = {
  can_help: "This tool can guide you through this",
  partly: "This tool can guide you, and a lawyer would help with some parts",
  needs_lawyer: "Start with the steps below, and get a lawyer involved too",
};

// Minimal typing for the browser Web Speech API (not in TS lib).
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start(): void; stop(): void;
}

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState<CaseState | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lang, setLang] = useState("en-IN");
  const [listening, setListening] = useState(false);
  const [canVoice, setCanVoice] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    setCanVoice(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  function toggleVoice() {
    if (listening) return rec.current?.stop();
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const R = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    r.lang = lang; r.interimResults = false; r.continuous = false;
    r.onresult = (e) => {
      const t = Array.from(e.results).map((x) => x[0].transcript).join(" ");
      setInput((p) => (p ? p + " " : "") + t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  }

  function speak(t: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang;
    window.speechSynthesis.speak(u);
  }

  function download(text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "draft-notice.txt"; a.click();
    URL.revokeObjectURL(url);
  }

  async function send(action?: "practice_start" | "practice_end") {
    const text = action ? "" : input.trim();
    if ((!text && !action) || busy) return;
    setInput(""); setError(""); setBusy(true);
    if (!action) setMsgs((m) => [...m, { role: "user", text }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, message: text, action }),
      });
      const data = (await res.json()) as TurnResult & { error?: string };
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setState(data.state);
      setMsgs((m) => [...m, { role: "bot", text: data.reply, story: data.analysis ? data.state.story ?? undefined : undefined, practice: data.practice, analysis: data.analysis, plan: data.plan, verdict: data.verdict, warnings: data.warnings }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  function reset() { setMsgs([]); setState(null); setError(""); setInput(""); }
  const stage = state?.stage ?? "intake";
  const practicing = state?.mode === "practice";

  return (
    <main className="wrap">
      <div>
        <h1>AI Lawyer India</h1>
        <p className="sub">Refunds, online scams, rental deposits, unpaid salary, loans and legal notices. Tell me what happened, in your language.</p>
      </div>
      <div className="banner">
        General legal information, not legal advice, and not a lawyer. It can make mistakes. Do not type Aadhaar, card numbers, OTPs or passwords. Your messages are sent to an AI service.
      </div>
      <div className="steps">
        {STAGES.map((s) => <span key={s.id} className={"step" + (s.id === stage ? " on" : "")}>{s.label}</span>)}
      </div>

      <div className="chat">
        {msgs.length === 0 && (
          <div className="card">
            Example: &quot;I ordered a phone on a website for ₹18,000 two weeks ago. They took the money, never delivered, and now they do not answer my messages.&quot;
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: m.role === "user" ? "flex-end" : "stretch" }}>
            <div className={"msg " + m.role}>{m.text}</div>
            {m.role === "bot" && <button className="mini" onClick={() => speak(m.text)} aria-label="Read aloud">🔊 Read aloud</button>}
            {m.story && (
              <div className="card">
                <h3>Your case file</h3>
                <p style={{ margin: "0 0 6px" }}>{m.story.summary}</p>
                <ul>
                  {m.story.timeline.map((t, k) => <li key={k}><b>{t.when}:</b> {t.what}</li>)}
                  {m.story.amount_inr !== null && <li><b>Amount:</b> ₹{m.story.amount_inr.toLocaleString("en-IN")}{m.story.payment_method ? ` via ${m.story.payment_method}` : ""}</li>}
                  {m.story.opposite_party && <li><b>Other side:</b> {m.story.opposite_party}</li>}
                  {m.story.proof_mentioned.length > 0 && <li><b>Proof mentioned:</b> {m.story.proof_mentioned.join(", ")}</li>}
                  {m.story.user_goal && <li><b>You want:</b> {m.story.user_goal}</li>}
                </ul>
              </div>
            )}
            {m.practice?.briefing && (
              <div className="card practice">
                <h3>🥊 Tricks the other side may use against you</h3>
                <ul>{m.practice.briefing.map((b, k) => <li key={k}><b>{b.tactic}</b> — {b.how_it_is_used}</li>)}</ul>
              </div>
            )}
            {m.practice?.feedback && (
              <div className="card practice">
                <h3>Feedback on your answer <span className="tag">{m.practice.feedback.strength}</span>{m.practice.tactic_used && <span className="tag">tactic: {m.practice.tactic_used}</span>}</h3>
                <p style={{ margin: "4px 0" }}><b>Worked:</b> {m.practice.feedback.what_worked}</p>
                <p style={{ margin: "4px 0" }}><b>Fix:</b> {m.practice.feedback.what_to_fix}</p>
                <p style={{ margin: "4px 0" }}><b>A stronger answer:</b> {m.practice.feedback.better_answer}</p>
              </div>
            )}
            {m.practice?.summary && (
              <div className="card practice">
                <h3>Practice summary</h3>
                <p style={{ margin: "4px 0" }}><b>Strengths:</b></p><ul>{m.practice.summary.strengths.map((x, k) => <li key={k}>{x}</li>)}</ul>
                <p style={{ margin: "4px 0" }}><b>Weak spots:</b></p><ul>{m.practice.summary.weak_spots.map((x, k) => <li key={k}>{x}</li>)}</ul>
                <p style={{ margin: "4px 0" }}><b>Bring to the hearing:</b></p><ul>{m.practice.summary.bring_to_hearing.map((x, k) => <li key={k}>{x}</li>)}</ul>
                <p style={{ margin: "4px 0" }}><b>Tips:</b></p><ul>{m.practice.summary.tips.map((x, k) => <li key={k}>{x}</li>)}</ul>
              </div>
            )}
            {m.analysis && m.analysis.provisions.length > 0 && (
              <div className="card">
                <h3>Laws that may help you</h3>
                <ul>
                  {m.analysis.provisions.map((p) => (
                    <li key={p.id}>
                      <a href={p.source_url} target="_blank" rel="noreferrer">{p.instrument}, {p.reference}</a>
                      <span className="tag">{p.source_type}</span><br />{p.why}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {m.analysis && m.analysis.evidence_checklist.length > 0 && (
              <div className="card">
                <h3>Proofs to gather</h3>
                <ul>
                  {m.analysis.evidence_checklist.map((x, k) => (
                    <li key={k}>{x.mentioned_by_user ? "✅ " : "☐ "}<b>{x.item}</b> — {x.why}</li>
                  ))}
                </ul>
              </div>
            )}
            {m.verdict && (
              <div className={"card verdict " + m.verdict.level}>
                <h3>Can this tool handle your case?</h3>
                <div className="lvl">{VERDICT_TEXT[m.verdict.level]}</div>
                <ul>{m.verdict.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul>
              </div>
            )}
            {m.plan && (
              <div className="card">
                <h3>Your step-by-step plan</h3>
                <p style={{ margin: "0 0 6px" }}><b>Where to go:</b> {m.plan.forum}</p>
                <ol>{m.plan.steps.map((s, k) => <li key={k}><b>{s.title}</b> ({s.where})<br />{s.detail}</li>)}</ol>
                {m.plan.evidence_missing.length > 0 && <p><b>Still missing:</b> {m.plan.evidence_missing.join("; ")}</p>}
              </div>
            )}
            {m.plan && m.plan.draft_document?.type !== "none" && m.plan.draft_document?.text && (
              <div className="card">
                <h3>Draft {({ legal_notice: "legal notice", complaint: "complaint", reply_to_notice: "reply to the notice", application: "application", none: "" })[m.plan.draft_document.type]} (English)</h3>
                <pre>{m.plan.draft_document.text}</pre>
                <button onClick={() => navigator.clipboard?.writeText(m.plan!.draft_document.text)}>Copy</button>{" "}
                <button onClick={() => download(m.plan!.draft_document.text)}>Download</button>
                <p className="sub">Check every detail and fill in the [PLACEHOLDERS] before sending.</p>
              </div>
            )}
            {m.warnings?.map((w, k) => <div key={k} className="warn">⚠ {w}</div>)}
          </div>
        ))}
        {busy && <div className="msg bot">Thinking…</div>}
        {error && <div className="err">{error}</div>}
        <div ref={endRef} />
      </div>

      <div className="tools">
        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Voice language">
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <span>{canVoice ? "Voice language" : "Voice input not supported in this browser"}</span>
        {stage === "done" && !practicing && <button onClick={() => send("practice_start")} disabled={busy}>🥊 Practice against the other side</button>}
        {practicing && <button onClick={() => send("practice_end")} disabled={busy}>End practice</button>}
        {msgs.length > 0 && <button onClick={reset} style={{ marginLeft: "auto" }}>New case</button>}
      </div>
      {practicing && <div className="banner">Practice mode: I am playing the other side&apos;s lawyer. Answer my questions as you would in a hearing. This is a simulation, not a prediction of what a real forum will do.</div>}
      <div className="row">
        <textarea
          value={input} onChange={(e) => setInput(e.target.value)} rows={2}
          placeholder={practicing ? "Your answer to the other side's lawyer…" : stage === "done" ? "Ask a follow-up question…" : "Type or speak here…"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        {canVoice && <button onClick={toggleVoice} aria-label="Voice input">{listening ? "⏹" : "🎤"}</button>}
        <button className="primary" onClick={() => send()} disabled={busy || !input.trim()}>Send</button>
      </div>
    </main>
  );
}
