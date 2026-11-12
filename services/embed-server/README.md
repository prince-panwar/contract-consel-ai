# Document service (embed-server)

Internal service of the ContractConsel review platform. Proprietary and confidential; see the repository [LICENSE](../../LICENSE).

It performs the document work that must never leave our infrastructure:

- **Processing** (`POST /process-report`): loads an uploaded agreement from the database, decrypts it, extracts page text (pages without a text layer go through Tesseract OCR), splits it into section-aware passages, computes embeddings locally (bge-small-en-v1.5 on CPU), and stores the results back **encrypted** with the id of the embedding model. Jobs are queued one at a time and resume automatically after a restart.
- **Embeddings** (`POST /embed`): `{ texts, kind: "query" | "passage" }` → `{ vectors, model }`. Queries get the model's search instruction; the model id lets the application re-embed reports made with an older model.
- **Health** (`GET /health`).

All endpoints except `/health` require a shared API key. In production the service runs on a private network inside the platform's Docker Compose stack and has **no public port**; no third party receives the documents it processes.

Configuration (`.env`, see `.env.example`): `API_KEY`, `MONGODB_URI`, `MONGODB_DB`, `CONTENT_ENCRYPTION_KEY` (same as the application) the tuning values `MAX_CONCURRENCY`, `INTERNAL_BATCH`, `FANOUT`, `MAX_UPLOAD_BYTES`, `MODEL_ID` (embedding model), and OCR: `OCR_DISABLED`, `OCR_LANG` (default `eng`), `OCR_MAX_PAGES`, `OCR_PAGE_TIMEOUT_MS`. The Docker image includes Tesseract and poppler; without them OCR is skipped.

Development: `npm install && npm run dev`. Deployment and operations are documented internally.
