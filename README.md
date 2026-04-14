# ContractCounsel AI

AI contract analysis with RAG. Upload a PDF, ask questions, get grounded answers with citations to the exact section and page.

## Stack

- **Next.js 16** (App Router, Turbopack) + React 19 + TypeScript + Tailwind v4
- **Groq** — LLM (`llama-3.3-70b-versatile`, streaming)
- **@xenova/transformers** — local embeddings (all-MiniLM-L6-v2, no extra API key)
- **pdf-parse** v2 — server-side PDF text extraction
- In-memory per-session vector store (module-scoped `Map`, 30-min TTL, swept every 5 min)

## Setup

```bash
cp .env.local.example .env.local
# add your Groq API key:
# GROQ_API_KEY=gsk_...
npm install
npm run dev
```

Open http://localhost:3000.

## Architecture

### Request flow

- **Upload** — `POST /api/contract/upload` — multipart PDF → `extractPdf` → `chunkContract` → `embed` (batched 16) → `createSession`. Responds with `{sessionId, filename, pageCount, chunkCount}` and sets an `HttpOnly` `cc_sid` cookie.
- **Chat** — `POST /api/contract/chat` — `{messages: [{role, content}, ...]}`. Embeds the last user message, retrieves top-6 via cosine (pre-normalized dot product), builds a grounded prompt, streams Groq's response as SSE frames: `sources` → `delta*` → `done`.
- **Reset** — `DELETE /api/contract/session` — drops the server-side session and clears the cookie.

### Chunking

Section-aware splitter: first tries to segment on contract heading patterns (`SECTION 7.2`, `ARTICLE IV`, `1.1 Definitions`, etc.), then sliding-window by sentence boundaries (target ~2000 chars, ~320 overlap). Each chunk carries `{id, heading, pageStart, pageEnd}` used in citations.

### System prompt

Lives in `lib/groq/prompts.ts`. Enforces: grounded-only answers, exact citation format `[§heading p.N]`, risk flagging, quotation of critical phrases, and a "not legal advice" disclaimer on substantive claims. Out-of-scope answers must be exactly `"I don't see that in the document."`.

### File map

```
app/
  page.tsx                         — renders <Workbench />
  api/contract/
    upload/route.ts                — PDF → chunks → embeddings → session
    chat/route.ts                  — retrieve + stream Groq SSE
    session/route.ts               — DELETE / GET sessionId
lib/
  constants.ts                     — ragConfig (model, sizes, TTL)
  rag/{types,pdf,chunker,embedder,vectorStore,retriever,session}.ts
  groq/{client,prompts,stream}.ts
components/
  Workbench.tsx                    — top-level state
  UploadDropzone.tsx               — drag/drop upload
  ChatPanel.tsx                    — message list + composer
  MessageBubble.tsx                — user/assistant bubbles
  Citations.tsx                    — parses [§…] tokens into clickable chips
  SourcePanel.tsx                  — side drawer with the cited chunk
  useChatStream.ts                 — SSE client hook
instrumentation.ts                 — 5-min session sweep
```

## Known limits (MVP)

- Session store is per-process in-memory — lost on restart, doesn't scale across workers. Swap for Redis or pgvector when you need persistence or multiple workers.
- Scanned/image-only PDFs aren't supported (no OCR).
- No auth — anyone with a valid `sessionId` can query that session.
- First request triggers a MiniLM cold start (~20–30s) while the model downloads to `./.cache`.

## Tuning

Edit `lib/constants.ts` → `ragConfig`:

- `model` — swap Groq model (`openai/gpt-oss-120b` for stronger reasoning, `llama-3.1-8b-instant` for speed).
- `chunkTargetChars` / `chunkOverlapChars` — chunk granularity.
- `topK` — retrieved chunks per query.
- `maxContextChars` — hard cap on total context sent to the LLM.
- `sessionTtlMs`, `maxPdfBytes`.
