import raw from "../../data/laws.json";

export interface Entry {
  id: string;
  kind: string;
  instrument: string;
  reference: string;
  title: string;
  summary: string;
  applies_when: string;
  issue_types: string[];
  source_url: string;
  source_type: "official" | "secondary";
  verification: string;
  verified_on: string;
  caveats?: string;
}

export const corpus = raw as unknown as {
  meta: { scope: string; rules: string; disclaimer: string };
  issue_types: { id: string; label: string; description: string }[];
  entries: Entry[];
};

export const entryById = new Map(corpus.entries.map((e) => [e.id, e]));

/** Compact text of the whole law file, placed in the prompt. */
export function corpusForPrompt(): string {
  const types = corpus.issue_types.map((t) => `${t.id}: ${t.label}`).join("\n");
  const entries = corpus.entries
    .map(
      (e) =>
        `[${e.id}] ${e.instrument}, ${e.reference} - ${e.title}\n  ${e.summary}\n  Applies when: ${e.applies_when}` +
        (e.caveats ? `\n  Caveat: ${e.caveats}` : "")
    )
    .join("\n");
  return `ISSUE TYPES:\n${types}\n\nLAW FILE (the only legal sources you may cite):\n${entries}`;
}

export interface Citation {
  id: string;
  why: string;
}

export interface ResolvedCitation extends Citation {
  reference: string;
  instrument: string;
  title: string;
  source_url: string;
  source_type: string;
}

/** Keep only citations whose id exists in the law file. Anything else is dropped. */
export function resolveCitations(items: Citation[] | undefined): {
  valid: ResolvedCitation[];
  dropped: string[];
} {
  const valid: ResolvedCitation[] = [];
  const dropped: string[] = [];
  for (const c of items ?? []) {
    const e = entryById.get(c?.id);
    if (!e) {
      dropped.push(String(c?.id));
      continue;
    }
    valid.push({
      id: e.id,
      why: c.why ?? "",
      reference: e.reference,
      instrument: e.instrument,
      title: e.title,
      source_url: e.source_url,
      source_type: e.source_type,
    });
  }
  return { valid, dropped };
}

const knownNumbers = new Set<string>();
for (const e of corpus.entries) {
  const blob = [e.reference, e.title, e.summary, e.applies_when, e.caveats ?? ""].join(" ");
  for (const m of blob.matchAll(/\d+/g)) knownNumbers.add(m[0]);
}

/**
 * Safety net on free text: flags section/rule/article numbers, case citations, and
 * "IPC" mentions that do not appear in the verified law file.
 */
export function unverifiedMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(section|sec\.?|s\.|article|rule|order)\s*(\d+)/gi)) {
    if (!knownNumbers.has(m[2])) out.add(`${m[1]} ${m[2]}`);
  }
  if (/\bIPC\b|Indian Penal Code/i.test(text)) out.add("IPC (replaced by BNS from 1 July 2024)");
  if (/\b[A-Z][\w.&']+(?: [A-Z][\w.&']+)* (?:v\.|vs\.?) [A-Z]/.test(text)) out.add("a court case citation");
  return [...out];
}
