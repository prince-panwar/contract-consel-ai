# Document service (embed-server)

Internal service of the ContractConsel review platform. Proprietary and confidential; see the repository [LICENSE](../../LICENSE).

It performs the document work that must never leave our infrastructure:

- **Processing** (`POST /process-report`): loads an uploaded agreement from the database, decrypts it, extracts page text, splits it into section-aware passages, computes embeddings locally (all-MiniLM-L6-v2 on CPU), and stores the results back **encrypted**. Jobs are queued one at a time and resume automatically after a restart.
- **Embeddings** (`POST /embed`): vectors for search queries.
- **Health** (`GET /health`).

All endpoints except `/health` require a shared API key. In production the service runs on a private network inside the platform's Docker Compose stack and has **no public port**; no third party receives the documents it processes.

Configuration (`.env`, see `.env.example`): `API_KEY`, `MONGODB_URI`, `MONGODB_DB`, `CONTENT_ENCRYPTION_KEY` (same as the application) and the tuning values `MAX_CONCURRENCY`, `INTERNAL_BATCH`, `FANOUT`, `MAX_UPLOAD_BYTES`.

Development: `npm install && npm run dev`. Deployment and operations are documented internally.
