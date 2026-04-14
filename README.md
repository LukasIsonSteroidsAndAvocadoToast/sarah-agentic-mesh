# SARAH-MESH-V1 — Sovereign Intelligence Mesh

> **Architecture reference:** *Designing Data-Intensive Applications* (Kleppmann) × Agentic Mesh patterns.
> **Scale target:** MacBook M3 Max → Nvidia H100 cluster with zero code rewrites — only configuration changes.

---

## What This Is

A **event-sourced, hexagonally-architected content intelligence engine** that:

1. **Ingests** content from YouTube (and future platforms) via a strict `UniversalContent` Zod contract
2. **Persists** every event atomically using the **Outbox Pattern** (Postgres → Kafka)
3. **Embeds** content into `pgvector(1536)` semantic memory via local Ollama (Metal-accelerated on M3 Max)
4. **Evaluates** content quality via an **AI Judge Port** (bootstrap rule engine → Gemma 4 local)
5. **Orchestrates** multi-step workflows via **Temporal.io** (crash-safe, resumable at any line of code)
6. **Exposes** all tools to any LLM (Gemma, Claude, GPT) via a **JSON-RPC 2.0 MCP Server Hub**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SOVEREIGN INTELLIGENCE MESH                   │
├──────────────────┬──────────────────┬───────────────────────────┤
│   SENSORY LAYER  │  INTELLIGENCE    │  ORCHESTRATION LAYER       │
│                  │  LAYER           │                            │
│  YouTube API ──► │  pgvector        │  Temporal Workflows        │
│  (view_count>500)│  Embeddings      │  (crash-safe, resumable)   │
│       │          │  (all-minilm)    │           │                │
│       ▼          │       │          │           ▼                │
│  MeshContentItem │       ▼          │  DiscoveryIngestion        │
│  (Postgres 17)   │  Gemma 4 31B     │  Workflow                  │
│       │          │  DNA Extraction  │  1. Fetch YouTube          │
│       ▼          │  (Temp: 0.85)    │  2. Embed vectors          │
│  MeshEventOutbox │                  │  3. Extract DNA            │
│  (SKIP LOCKED)   │                  │                            │
│       │          ├──────────────────┤                            │
│       ▼          │   MCP HUB        │                            │
│  Apache Kafka    │  /api/mcp        │                            │
│  (KRaft mode)    │  JSON-RPC 2.0    │                            │
│                  │  (any LLM client)│                            │
└──────────────────┴──────────────────┴───────────────────────────┘
```

---

## Hexagonal Architecture (Ports & Adapters)

```
core/
├── ports/
│   ├── UniversalContentIngestPort.ts   ← interface: what ingestion looks like
│   └── EvaluationJudgePort.ts          ← interface: what evaluation looks like
├── services/
│   ├── UniversalContentIngestService.ts ← orchestrates ingest + outbox
│   ├── MeshEvaluationService.ts         ← orchestrates judge + record
│   └── mesh/
│       └── IngestionWorkflow.ts         ← Temporal workflow (3 activities)
└── architecture/
    └── meshBoundaries.test.ts           ← 25 fitness functions (Strangler Fig)

adapters/
└── intelligence/
    └── MeshJudgeAdapter.ts   ← rule engine judge (swap for Gemma without changing ports)

lib/mesh/
├── universalContentSchema.ts  ← Zod: the universal data contract (v1)
├── eventStore.ts              ← Prisma: transactional content + outbox write
├── outboxRelay.ts             ← raw pg: SKIP LOCKED polling → Kafka publish
├── embeddingWorker.ts         ← Ollama Metal: MeshContentItem.embedding fill
├── kafkaClient.ts             ← KafkaJS singleton + publishToKafka()
├── env.ts                     ← Zod-validated mesh environment
└── youtubeSchema.ts           ← YouTube API v3 response shapes
```

---

## Infrastructure (Docker Compose — `--profile mesh`)

| Service | Image | Purpose |
|---|---|---|
| `mesh_kafka` | `bitnami/kafka:3.7` | Apache Kafka in **KRaft mode** (no Zookeeper). The event circulatory system. |
| `mesh_temporal` | `temporalio/auto-setup:1.24` | Durable workflow orchestration. Coinbase/Snap-grade reliability. |
| `mesh_temporal_ui` | `temporalio/ui:2.31` | Temporal Web UI at `localhost:8088` |
| `monster_db` | `pgvector/pgvector:pg17` | Postgres 17 with pgvector. Source of truth + outbox vault. |

```bash
# Start the full mesh infrastructure
docker compose --profile mesh up -d

# Temporal UI
open http://localhost:8088
```

---

## Key Patterns

### 1. Outbox Pattern (Netflix/LinkedIn style)
Every content write atomically creates a `MeshEventOutbox` row in the same Postgres transaction.
The `outboxRelay` uses `SELECT … FOR UPDATE SKIP LOCKED` to claim batches and publish to Kafka.
**Guarantee:** If the DB write succeeds, the Kafka event is guaranteed to eventually publish.

### 2. Universal Content Contract (Zod v1)
All external data (YouTube, X, sensors) normalizes to `UniversalContent` before touching any storage.
```typescript
universalContentSchema.parse(rawData) // throws on contract violation
```

### 3. pgvector Semantic Memory
Every `MeshContentItem` gets an `embedding vector(1536)` populated by the embedding worker.
Enables semantic search and similarity queries across all ingested content.

### 4. AI Evaluation Port
The `EvaluationJudgePort` interface is the boundary between evaluation logic and the judge implementation.
Currently: deterministic rule engine. Swap for Gemma 4 without changing any caller.

### 5. MCP Server Hub (`POST /api/mcp`)
JSON-RPC 2.0 endpoint. Any MCP-compatible LLM client can call:
- `mcp/manifest` — discover available tools
- `mesh/list_content` — query ingested content
- `mesh/list_events` — inspect outbox events
- `mesh/service_health` — monitor service heartbeats
- `mesh/list_evaluations` — review AI verdicts

### 6. Temporal Workflow (Crash-Safe)
`discoveryIngestionWorkflow` runs 3 sequential activities:
1. Fetch YouTube metadata (channel `UCipXVNRvJIBoZt7O_aPIgzg`, `view_count > 500`)
2. Generate pgvector embeddings (Ollama Metal)
3. Extract Creative DNA via Gemma 4 (Temp: 0.85, Top-p: 0.95) — no brand persona imposed

---

## Quick Start

```bash
# 1. Install deps
npm install

# 2. Copy and fill environment
cp .env.example .env

# 3. Start mesh infrastructure
npm run mesh:up

# 4. Apply DB schema
npx prisma migrate deploy

# 5. Run first Discovery Mine (needs YOUTUBE_API_KEY)
YOUTUBE_API_KEY=your_key npm run mesh:discover

# 6. Start outbox relay (Postgres → Kafka)
npm run mesh:relay

# 7. Start embedding worker (Ollama Metal)
ollama pull all-minilm
npm run mesh:embed
```

---

## npm Scripts

| Script | What it does |
|---|---|
| `mesh:discover` | Full discovery run: YouTube fetch → embed → Gemma DNA extraction |
| `mesh:relay` | Outbox relay daemon (raw pg SKIP LOCKED → Kafka) |
| `mesh:embed` | Embedding worker daemon (Ollama Metal → pgvector) |
| `mesh:youtube:ingest` | YouTube-only ingestion (no DNA extraction) |
| `mesh:up` | `docker compose --profile mesh up -d` |
| `mesh:down` | `docker compose --profile mesh down` |
| `test:architecture` | 25 architecture fitness functions |

---

## Architecture Fitness Functions

`core/architecture/meshBoundaries.test.ts` runs 25 tests enforcing:
- Schema contract integrity
- Outbox pattern (no direct Kafka publish from eventStore)
- Hexagonal isolation (core/services has zero UI imports — Strangler Fig)
- Mesh-to-legacy firewall (lib/mesh cannot import SqueezePages/legacy)
- Raw-pg relay (no Prisma on the hot event path)
- Kafka client singleton exports
- MCP hub JSON-RPC coverage
- Temporal workflow contract
- Embedding Metal path correctness
- Docker Compose mesh profile presence

```bash
npm run test:architecture
# → 25/25 passing
```

---

## Scaling Path

| Stage | Config change | Code change |
|---|---|---|
| MacBook M3 Max | Ollama localhost:11434 | none |
| Dedicated GPU server | `OLLAMA_HOST=http://gpu-box:11434` | none |
| Nvidia H100 cluster | `KAFKA_BROKERS=h100-kafka:9092` + Temporal cloud | none |
| Multi-region | Kafka MirrorMaker 2 | none |

---

## Identity

- **Creative Human Partner:** `CREATIVE_HUMAN_PARTNER` (placeholder — identity is discovered, not invented)
- **Channel:** `UCipXVNRvJIBoZt7O_aPIgzg`
- **Discovery Filter:** `view_count > 500` (proven winners only)
- **DNA Engine:** Gemma 4 31B Dense, local, zero cloud dependency
