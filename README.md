# AI Lawyer India

Conversational legal-information assistant for everyday money problems in India: refunds and e-commerce, online scams, rental deposits, unpaid salary, private loans, and demand notices. Text or voice, replies in the user's language. Not legal advice.

**Live:** https://ai-lawyer-eta.vercel.app  |  **Solution doc:** `docs/solution-doc.pdf`  |  **Raw test outputs:** `outputs/raw/` (table in `outputs/summary.md`)

## Run locally
```bash
npm install
cp env.template .env.local      # then put your key in GEMINI_API_KEY
npm run dev                    # http://localhost:3000
```
Windows PowerShell: if `npx` is blocked, use `npx.cmd`.

## Swap the model
Default is Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash-lite`). For any OpenAI-compatible API set `LLM_PROVIDER=openai`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`. See `src/lib/llm.ts`.

## How it works
- `data/laws.json`: 53 hand-checked provisions and procedures, each with a source URL, official/secondary label and verified date. The model may cite only these ids.
- `src/lib/pipeline.ts`: staged flow (story, confirm, analysis, plan, follow-up, practice mode), verdict rules, citation checks, language enforcement.
- `src/app/page.tsx`: minimal chat UI (voice in, read aloud, case file, draft download, practice mode).

## Checks
```bash
node scripts/validate-corpus.mjs                       # validate the law file
node scripts/run-tests.mjs https://ai-lawyer-eta.vercel.app   # run tests/cases.json (ONLY=01,11 to rerun some)
```
Free-tier Gemini rate-limits per minute; the runner pauses between calls.
