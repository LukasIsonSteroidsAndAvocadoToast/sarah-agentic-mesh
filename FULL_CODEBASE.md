# SARAH-MESH-V1 — Full Codebase Dump (Phase 4: Distribution Grid)
> 58/58 fitness tests. 0 TypeScript errors. All intelligence layers + waterfall factory wired.


---

## lib/mesh/universalContentSchema.ts
```
import { z } from "zod";

export const universalPlatformSchema = z.enum([
  "YOUTUBE",
  "X",
  "FACEBOOK",
  "INSTAGRAM",
  "REDDIT",
  "GOOGLE",
  "PERPLEXITY",
  "TIKTOK",
  "OTHER",
]);

export const universalContentSchema = z.object({
  schemaVersion: z.literal("universal-content.v1"),
  sourcePlatform: universalPlatformSchema,
  externalId: z.string().min(1),
  sourceChannelId: z.string().min(1).optional(),
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional().default(""),
  contentText: z.string().min(1),
  transcriptText: z.string().optional(),
  languageCode: z.string().min(2).max(16).optional(),
  viewCount: z.number().int().nonnegative().optional(),
  likeCount: z.number().int().nonnegative().optional(),
  commentCount: z.number().int().nonnegative().optional(),
  publishedAt: z.string().datetime().optional(),
  discoveredAt: z.string().datetime(),
  rawPayload: z.record(z.string(), z.unknown()),
});

export const meshEventEnvelopeSchema = z.object({
  schemaVersion: z.literal("mesh-event.v1"),
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  eventKey: z.string().min(1),
  producer: z.string().min(1),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()).default({}),
});

export const contentEvaluationSchema = z.object({
  evaluatorKind: z.enum(["AI_JUDGE", "RULE_ENGINE", "HUMAN"]),
  modelName: z.string().optional(),
  verdict: z.enum(["ACCEPT", "REVIEW", "REJECT"]),
  qualityScore: z.number().min(0).max(1).optional(),
  contrarianScore: z.number().min(0).max(1).optional(),
  nuanceScore: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type UniversalContent = z.infer<typeof universalContentSchema>;
export type MeshEventEnvelope = z.infer<typeof meshEventEnvelopeSchema>;
export type ContentEvaluation = z.infer<typeof contentEvaluationSchema>;
```

---

## lib/mesh/env.ts
```
/**
 * Validated environment for the Sovereign Mesh.
 * Import this instead of process.env to get type-safe, runtime-checked config.
 */
import { z } from "zod";

const meshEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  KAFKA_BROKERS: z.string().default("mesh_kafka:9092"),
  KAFKA_CLIENT_ID: z.string().default("sovereign-mesh"),
  KAFKA_TOPIC_CONTENT_EVENTS: z.string().default("mesh.content.events"),
  TEMPORAL_ADDRESS: z.string().default("mesh_temporal:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  OLLAMA_HOST: z.string().url().default("http://localhost:11434"),
  OLLAMA_EMBED_MODEL: z.string().default("all-minilm"),
  YOUTUBE_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type MeshEnv = z.infer<typeof meshEnvSchema>;

let _meshEnv: MeshEnv | null = null;

export function getMeshEnv(): MeshEnv {
  if (!_meshEnv) {
    const parsed = meshEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error("[mesh/env] Invalid mesh environment:", parsed.error.flatten());
      throw new Error("Mesh environment validation failed — check .env");
    }
    _meshEnv = parsed.data;
  }
  return _meshEnv;
}
```

---

## lib/mesh/youtubeSchema.ts
```
import { z } from "zod";

const youtubeThumbnailSchema = z.object({
  url: z.string().url().optional(),
});

const youtubeApiVideoSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    channelId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional().default(""),
    publishedAt: z.string().datetime(),
    channelTitle: z.string().optional(),
    defaultLanguage: z.string().optional(),
    thumbnails: z.record(z.string(), youtubeThumbnailSchema).optional(),
  }),
  statistics: z.object({
    viewCount: z.string(),
    likeCount: z.string().optional(),
    commentCount: z.string().optional(),
  }),
  contentDetails: z
    .object({
      duration: z.string().optional(),
    })
    .optional(),
});

export const youtubeApiListSchema = z.object({
  items: z.array(youtubeApiVideoSchema),
});

export type YoutubeApiVideo = z.infer<typeof youtubeApiVideoSchema>;
```

---

## lib/db.ts
```
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prismaMesh?: PrismaClient;
};

export const prisma =
  globalForPrisma.prismaMesh ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaMesh = prisma;
}
```

---

## lib/mesh/eventStore.ts
```
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  contentEvaluationSchema,
  meshEventEnvelopeSchema,
  universalContentSchema,
  type ContentEvaluation,
  type MeshEventEnvelope,
  type UniversalContent,
} from "@/lib/mesh/universalContentSchema";

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function buildContentCreatedEvent(content: UniversalContent): MeshEventEnvelope {
  return meshEventEnvelopeSchema.parse({
    schemaVersion: "mesh-event.v1",
    eventType: "mesh.content.ingested",
    aggregateType: "mesh_content_item",
    aggregateId: `${content.sourcePlatform}:${content.externalId}`,
    eventKey: `mesh.content.ingested:${content.sourcePlatform}:${content.externalId}`,
    producer: "mesh.ingestor.youtube",
    occurredAt: content.discoveredAt,
    payload: {
      sourcePlatform: content.sourcePlatform,
      externalId: content.externalId,
      sourceChannelId: content.sourceChannelId,
      canonicalUrl: content.canonicalUrl,
      title: content.title,
      viewCount: content.viewCount,
      publishedAt: content.publishedAt,
      schemaVersion: content.schemaVersion,
    },
    headers: {
      content_schema_version: content.schemaVersion,
    },
  });
}

export async function saveUniversalContentWithOutbox(input: UniversalContent) {
  const content = universalContentSchema.parse(input);
  const event = buildContentCreatedEvent(content);

  return prisma.$transaction(async (tx) => {
    const saved = await tx.meshContentItem.upsert({
      where: {
        sourcePlatform_externalId: {
          sourcePlatform: content.sourcePlatform,
          externalId: content.externalId,
        },
      },
      create: {
        id: randomUUID(),
        sourcePlatform: content.sourcePlatform,
        externalId: content.externalId,
        sourceChannelId: content.sourceChannelId,
        canonicalUrl: content.canonicalUrl,
        title: content.title,
        description: content.description,
        contentText: content.contentText,
        transcriptText: content.transcriptText,
        languageCode: content.languageCode,
        schemaVersion: content.schemaVersion,
        viewCount: content.viewCount,
        likeCount: content.likeCount,
        commentCount: content.commentCount,
        publishedAt: content.publishedAt ? new Date(content.publishedAt) : undefined,
        discoveredAt: new Date(content.discoveredAt),
        rawPayload: toPrismaJson(content.rawPayload),
      },
      update: {
        sourceChannelId: content.sourceChannelId,
        canonicalUrl: content.canonicalUrl,
        title: content.title,
        description: content.description,
        contentText: content.contentText,
        transcriptText: content.transcriptText,
        languageCode: content.languageCode,
        schemaVersion: content.schemaVersion,
        viewCount: content.viewCount,
        likeCount: content.likeCount,
        commentCount: content.commentCount,
        publishedAt: content.publishedAt ? new Date(content.publishedAt) : undefined,
        rawPayload: toPrismaJson(content.rawPayload),
      },
    });

    await tx.meshEventOutbox.upsert({
      where: { eventKey: event.eventKey },
      create: {
        id: randomUUID(),
        aggregateType: event.aggregateType,
        aggregateId: saved.id,
        eventType: event.eventType,
        eventKey: event.eventKey,
        eventVersion: 1,
        producer: event.producer,
        payloadJson: toPrismaJson(event.payload),
        headersJson: toPrismaJson(event.headers),
        availableAt: new Date(event.occurredAt),
      },
      update: {
        aggregateId: saved.id,
        payloadJson: toPrismaJson(event.payload),
        headersJson: toPrismaJson(event.headers),
      },
    });

    return saved;
  });
}

export async function recordContentEvaluation(contentItemId: string, input: ContentEvaluation) {
  const evaluation = contentEvaluationSchema.parse(input);
  return prisma.meshContentEvaluation.create({
    data: {
      id: randomUUID(),
      contentItemId,
      evaluatorKind: evaluation.evaluatorKind,
      modelName: evaluation.modelName,
      verdict: evaluation.verdict,
      qualityScore: evaluation.qualityScore,
      contrarianScore: evaluation.contrarianScore,
      nuanceScore: evaluation.nuanceScore,
      notes: evaluation.notes,
      payloadJson: evaluation.payload ? toPrismaJson(evaluation.payload) : undefined,
    },
  });
}

export async function heartbeatMeshService(serviceName: string, serviceKind: string, protocol: string, version: string) {
  return prisma.meshServiceIdentity.upsert({
    where: { serviceName },
    create: {
      id: randomUUID(),
      serviceName,
      serviceKind,
      protocol,
      version,
      lastHeartbeatAt: new Date(),
      metadataJson: {},
    },
    update: {
      protocol,
      version,
      lastHeartbeatAt: new Date(),
    },
  });
}
```

---

## lib/mesh/kafkaClient.ts
```
/**
 * KafkaJS singleton for the Sovereign Mesh.
 * The producer is lazy-initialised on first use and reused across calls.
 * Import `getMeshProducer()` from this module everywhere you need to publish.
 */
import { Kafka, type Producer, type Consumer, CompressionTypes, logLevel } from "kafkajs";
import { getMeshEnv } from "@/lib/mesh/env";

let _kafka: Kafka | null = null;
let _producer: Producer | null = null;

function getKafka(): Kafka {
  if (!_kafka) {
    const env = getMeshEnv();
    _kafka = new Kafka({
      clientId: env.KAFKA_CLIENT_ID,
      brokers: env.KAFKA_BROKERS.split(","),
      logLevel: env.NODE_ENV === "production" ? logLevel.WARN : logLevel.INFO,
      retry: { retries: 5, initialRetryTime: 300 },
    });
  }
  return _kafka;
}

export async function getMeshProducer(): Promise<Producer> {
  if (!_producer) {
    _producer = getKafka().producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30_000,
    });
    await _producer.connect();
  }
  return _producer;
}

export async function disconnectProducer(): Promise<void> {
  if (_producer) {
    await _producer.disconnect();
    _producer = null;
  }
}

export function createMeshConsumer(groupId: string): Consumer {
  return getKafka().consumer({ groupId, sessionTimeout: 30_000 });
}

/**
 * Publish a single JSON message to a Kafka topic.
 * key should be a stable aggregate id for ordered delivery per entity.
 */
export async function publishToKafka(
  topic: string,
  key: string,
  value: unknown,
): Promise<void> {
  const producer = await getMeshProducer();
  await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key,
        value: JSON.stringify(value),
        headers: { "content-type": "application/json" },
      },
    ],
  });
}
```

---

## lib/mesh/outboxRelay.ts
```
/**
 * Outbox Relay — raw node-postgres read path + KafkaJS publish.
 *
 * Architecture note: We deliberately bypass Prisma here.
 * The outbox relay is a high-frequency, append-only reader on a single table.
 * Using raw `pg` removes ORM overhead and lets us use `SKIP LOCKED` (advisory
 * lock-free row-level locking) which is the correct Postgres pattern for
 * multi-worker at-least-once delivery without a distributed lock manager.
 *
 * Netflix / LinkedIn Outbox Pattern reference:
 *   SELECT … FOR UPDATE SKIP LOCKED guarantees that concurrent relay workers
 *   never process the same event row twice.
 */
import { Pool, type PoolClient } from "pg";
import { getMeshEnv } from "@/lib/mesh/env";
import { publishToKafka } from "@/lib/mesh/kafkaClient";

const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 2_000;

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const env = getMeshEnv();
    _pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return _pool;
}

interface OutboxRow {
  id: string;
  event_type: string;
  event_key: string;
  aggregate_type: string;
  aggregate_id: string;
  producer: string;
  payload_json: unknown;
  headers_json: unknown;
  available_at: Date;
}

async function claimAndPublishBatch(client: PoolClient, topic: string): Promise<number> {
  await client.query("BEGIN");

  const { rows } = await client.query<OutboxRow>(
    `SELECT id, event_type, event_key, aggregate_type, aggregate_id,
            producer, payload_json, headers_json, available_at
     FROM "MeshEventOutbox"
     WHERE status = 'PENDING'
       AND available_at <= NOW()
     ORDER BY available_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [BATCH_SIZE],
  );

  if (rows.length === 0) {
    await client.query("ROLLBACK");
    return 0;
  }

  const ids = rows.map((r) => r.id);
  let published = 0;

  for (const row of rows) {
    try {
      await publishToKafka(topic, row.aggregate_id, {
        eventType: row.event_type,
        eventKey: row.event_key,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        producer: row.producer,
        occurredAt: row.available_at,
        payload: row.payload_json,
        headers: row.headers_json,
      });
      published++;
    } catch (err) {
      console.error(`[outbox-relay] Failed to publish event ${row.id}:`, err);
      // Row stays PENDING — will be retried on next poll cycle.
      ids.splice(ids.indexOf(row.id), 1);
    }
  }

  if (ids.length > 0) {
    await client.query(
      `UPDATE "MeshEventOutbox"
       SET status = 'PUBLISHED', published_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  await client.query("COMMIT");
  return published;
}

export async function runOutboxRelay(signal?: AbortSignal): Promise<void> {
  const env = getMeshEnv();
  const pool = getPool();
  const topic = env.KAFKA_TOPIC_CONTENT_EVENTS;

  console.log(`[outbox-relay] Starting — polling every ${POLL_INTERVAL_MS}ms → topic=${topic}`);

  while (!signal?.aborted) {
    const client = await pool.connect();
    try {
      const count = await claimAndPublishBatch(client, topic);
      if (count > 0) {
        console.log(`[outbox-relay] Published ${count} events`);
      }
    } catch (err) {
      console.error("[outbox-relay] Batch error:", err);
      try { await client.query("ROLLBACK"); } catch { /* best-effort */ }
    } finally {
      client.release();
    }

    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_INTERVAL_MS);
      signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }

  console.log("[outbox-relay] Graceful shutdown complete.");
}
```

---

## lib/mesh/embeddingWorker.ts
```
/**
 * Embedding Worker — reads MeshContentItem rows with null embedding and
 * calls the local Ollama /api/embeddings endpoint (Metal-accelerated on M3 Max).
 *
 * Uses a raw Prisma query only to READ content and a raw UPDATE to write the
 * pgvector column (Prisma does not yet support vector[] write syntax).
 *
 * Scaling path: swap the Ollama HTTP call for a gRPC inference call pointing
 * at the H100 cluster without changing any other code.
 */
import { Pool } from "pg";
import { getMeshEnv } from "@/lib/mesh/env";

const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 5_000;

interface OllamaEmbedResponse {
  embedding: number[];
}

async function ollamaEmbed(text: string, model: string, host: string): Promise<number[]> {
  const res = await fetch(`${host}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as OllamaEmbedResponse;
  return data.embedding;
}

function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

interface ContentRow {
  id: string;
  title: string;
  description: string | null;
  content_text: string | null;
  transcript_text: string | null;
}

async function embedBatch(pool: Pool, model: string, host: string): Promise<number> {
  const client = await pool.connect();
  let processed = 0;
  try {
    const { rows } = await client.query<ContentRow>(
      `SELECT id, title, description, content_text, transcript_text
       FROM "MeshContentItem"
       WHERE embedding IS NULL
       LIMIT $1`,
      [BATCH_SIZE],
    );

    for (const row of rows) {
      const textToEmbed = [
        row.title,
        row.description,
        row.transcript_text ?? row.content_text,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8_192);

      if (!textToEmbed.trim()) continue;

      try {
        const vec = await ollamaEmbed(textToEmbed, model, host);
        await client.query(
          `UPDATE "MeshContentItem" SET embedding = $1::vector WHERE id = $2`,
          [vectorLiteral(vec), row.id],
        );
        processed++;
      } catch (err) {
        console.warn(`[embed-worker] Skipped ${row.id}:`, (err as Error).message);
      }
    }
  } finally {
    client.release();
  }
  return processed;
}

export async function runEmbeddingWorker(signal?: AbortSignal): Promise<void> {
  const env = getMeshEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });

  console.log(`[embed-worker] Starting — model=${env.OLLAMA_EMBED_MODEL} host=${env.OLLAMA_HOST}`);

  while (!signal?.aborted) {
    try {
      const count = await embedBatch(pool, env.OLLAMA_EMBED_MODEL, env.OLLAMA_HOST);
      if (count > 0) {
        console.log(`[embed-worker] Embedded ${count} items`);
      }
    } catch (err) {
      console.error("[embed-worker] Batch error:", err);
    }

    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_INTERVAL_MS);
      signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }

  await pool.end();
  console.log("[embed-worker] Shutdown complete.");
}
```

---

## lib/mesh/dnaStore.ts
```
/**
 * DNA Store — persist and retrieve the Creative DNA baseline.
 *
 * Uses the existing MeshServiceIdentity table with a sentinel record
 * (serviceName = 'sarah.creative.dna') so no new migration is needed.
 * The dnaPrompt, analyzedCount, and run metadata live in metadataJson.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const DNA_SERVICE_NAME = "sarah.creative.dna";

export interface CreativeDnaRecord {
  dnaPrompt: string;
  analyzedCount: number;
  channelId: string;
  ollamaModel: string;
  extractedAt: string;
}

export async function saveDna(record: CreativeDnaRecord): Promise<void> {
  await prisma.meshServiceIdentity.upsert({
    where: { serviceName: DNA_SERVICE_NAME },
    create: {
      id: randomUUID(),
      serviceName: DNA_SERVICE_NAME,
      serviceKind: "intelligence.dna",
      version: "1",
      protocol: "ollama",
      lastHeartbeatAt: new Date(),
      metadataJson: toJson(record),
    },
    update: {
      version: String(Date.now()),
      lastHeartbeatAt: new Date(),
      metadataJson: toJson(record),
    },
  });
}

export async function getDna(): Promise<CreativeDnaRecord | null> {
  const record = await prisma.meshServiceIdentity.findUnique({
    where: { serviceName: DNA_SERVICE_NAME },
  });
  if (!record?.metadataJson) return null;
  return record.metadataJson as unknown as CreativeDnaRecord;
}
```

---

## lib/mesh/vectorSearch.ts
```
/**
 * Vector Search — pgvector cosine similarity search over MeshContentItem.
 *
 * Uses raw pg (<=> operator) because Prisma does not yet support vector operators.
 * Generates the query embedding via Ollama Metal before searching.
 *
 * Cosine distance: 0 = identical, 2 = opposite. We return similarity = 1 - distance.
 */
import { Pool } from "pg";
import { getMeshEnv } from "@/lib/mesh/env";

interface SearchResult {
  id: string;
  title: string;
  canonicalUrl: string;
  sourcePlatform: string;
  viewCount: number | null;
  publishedAt: Date | null;
  similarity: number;
  snippet: string;
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: getMeshEnv().DATABASE_URL, max: 3 });
  }
  return _pool;
}

async function embedQuery(query: string): Promise<number[]> {
  const env = getMeshEnv();
  const res = await fetch(`${env.OLLAMA_HOST}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: env.OLLAMA_EMBED_MODEL, prompt: query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Ollama embed ${res.status}`);
  const { embedding } = (await res.json()) as { embedding: number[] };
  return embedding;
}

export async function searchGold(
  query: string,
  limit = 5,
): Promise<SearchResult[]> {
  const embedding = await embedQuery(query);
  const vecLiteral = `[${embedding.join(",")}]`;
  const pool = getPool();

  const { rows } = await pool.query<{
    id: string;
    title: string;
    canonical_url: string;
    source_platform: string;
    view_count: number | null;
    published_at: Date | null;
    content_text: string;
    distance: number;
  }>(
    `SELECT
       id, title, canonical_url, source_platform, view_count, published_at,
       LEFT(content_text, 300) AS content_text,
       (embedding <=> $1::vector) AS distance
     FROM "MeshContentItem"
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vecLiteral, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    canonicalUrl: r.canonical_url,
    sourcePlatform: r.source_platform,
    viewCount: r.view_count,
    publishedAt: r.published_at,
    similarity: Number((1 - r.distance).toFixed(4)),
    snippet: r.content_text,
  }));
}
```

---

## core/ports/UniversalContentIngestPort.ts
```
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";

export interface UniversalContentIngestPort {
  ingest(content: UniversalContent): Promise<{ id: string }>;
}
```

---

## core/ports/EvaluationJudgePort.ts
```
import type { ContentEvaluation, UniversalContent } from "@/lib/mesh/universalContentSchema";

export interface EvaluationJudgePort {
  evaluate(content: UniversalContent): Promise<ContentEvaluation>;
}
```

---

## core/ports/DistributionAdapterPort.ts
```
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";

export type DistributionPlatform =
  | "LINKEDIN"
  | "X_THREAD"
  | "NEWSLETTER"
  | "EMAIL_SEQUENCE";

export interface DistributionDraft {
  platform: DistributionPlatform;
  draftText: string;
  /** 0-1: how closely the draft matches the discovered Sarah DNA */
  dnaConfidence: number;
  auditNotes?: string;
}

export interface DistributionAdapterPort {
  readonly platform: DistributionPlatform;
  generate(
    content: UniversalContent,
    sarahFilter: string,
  ): Promise<DistributionDraft>;
}
```

---

## core/services/UniversalContentIngestService.ts
```
import type { UniversalContentIngestPort } from "@/core/ports/UniversalContentIngestPort";
import { saveUniversalContentWithOutbox } from "@/lib/mesh/eventStore";
import { universalContentSchema, type UniversalContent } from "@/lib/mesh/universalContentSchema";

export class UniversalContentIngestService implements UniversalContentIngestPort {
  async ingest(content: UniversalContent): Promise<{ id: string }> {
    const parsed = universalContentSchema.parse(content);
    const saved = await saveUniversalContentWithOutbox(parsed);
    return { id: saved.id };
  }
}
```

---

## core/services/MeshEvaluationService.ts
```
import type { EvaluationJudgePort } from "@/core/ports/EvaluationJudgePort";
import { recordContentEvaluation } from "@/lib/mesh/eventStore";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";

export class MeshEvaluationService {
  constructor(private readonly judge: EvaluationJudgePort) {}

  async evaluateAndRecord(contentItemId: string, content: UniversalContent) {
    const evaluation = await this.judge.evaluate(content);
    await recordContentEvaluation(contentItemId, evaluation);
    return evaluation;
  }
}
```

---

## core/services/mesh/PersonaEngineService.ts
```
/**
 * PersonaEngineService — the "Sarah Filter."
 *
 * Retrieves the latest Creative DNA from dnaStore and constructs a
 * structured system prompt that forces Gemma to write with the exact
 * hooks, contrarian logic, and "human-not-jargon" style extracted in Phase 1.
 *
 * The DNA is discovered, not invented. This service never fabricates a persona;
 * it only amplifies patterns that the audience has already validated.
 */
import { getDna } from "@/lib/mesh/dnaStore";
import type { DistributionPlatform } from "@/core/ports/DistributionAdapterPort";

const PLATFORM_CONSTRAINTS: Record<DistributionPlatform, string> = {
  LINKEDIN: `Platform: LinkedIn.
Format rules:
- Hook in the first line (no fluff, no "I'm excited to share").
- Short paragraphs (1-3 lines max). White space is readability.
- Build a "cliffhanger" around line 3 that forces the reader to expand the post.
- End with ONE specific question or a bold contrarian statement, not a generic CTA.
- Max 1,300 characters. No bullet points in the first 3 lines.`,

  X_THREAD: `Platform: X (Twitter) Thread.
Format rules:
- Tweet 1 must be the highest-tension hook. Reader must feel they'll miss something critical if they stop.
- Tweets 2-9: each tweet = one complete insight. No "continued in next tweet" cop-outs.
- Tweet 10 (final): callback to tweet 1 + single CTA ("Follow for more" or "Retweet if this hit").
- Max 280 characters per tweet. Number them: "1/" "2/" etc.
- Zero filler words. Every word must earn its place.`,

  NEWSLETTER: `Platform: Email Newsletter (long-form).
Format rules:
- Subject line: treat it as a tweet — curiosity gap or bold claim.
- Open with a story or scene, NOT a summary.
- Build the "idea stack": concept → real-world example → counterintuitive insight → takeaway.
- Use section headers sparingly — only when content genuinely pivots.
- Close with a personal confession or vulnerability that makes the reader feel "me too."
- Target: 600-1,200 words. Must feel like a letter, not an article.`,

  EMAIL_SEQUENCE: `Platform: Personal Email List (inner-circle communication).
Format rules:
- Write as if emailing ONE specific person you respect.
- No corporate language. No "As per my last email." No "I hope this finds you well."
- Get to the point in sentence 1.
- One idea per email. Relentlessly single-focused.
- End with a question that makes them reply, or a micro-action they can take in 2 minutes.
- Target: 150-300 words. Punchy. Direct. Human.`,
};

const FALLBACK_DNA = `You think in systems, not tactics. You challenge conventional wisdom with data and lived experience.
Your language is direct — you say "this is wrong" not "this might be worth considering."
You use short sentences when making bold claims. You use longer sentences when building an argument.
You never use buzzwords like "leverage," "synergy," or "game-changer."
You make the reader feel smarter after reading you, not more confused.`;

export class PersonaEngineService {
  async buildSarahFilter(): Promise<string> {
    const dna = await getDna();
    const coreDna = dna?.dnaPrompt ?? FALLBACK_DNA;

    return `CREATIVE DNA BASELINE (extracted from proven high-performance content):
${coreDna}

ABSOLUTE RULES — never violate these:
1. Never use jargon. If a 14-year-old wouldn't understand a word, replace it.
2. Never start a sentence with "I" in the first line.
3. Never use "game-changer," "paradigm shift," "unlock," "leverage," or "holistic."
4. Every piece of content must contain at least ONE contrarian insight — something that challenges what the reader already believes.
5. The voice is authoritative but never arrogant. Confident, not cocky.
6. The human behind this content has real experience. Show the scars, not just the trophies.`;
  }

  async buildGenerationPrompt(
    title: string,
    sourceText: string,
    platform: DistributionPlatform,
    sarahFilter: string,
  ): Promise<{ system: string; prompt: string }> {
    const platformConstraints = PLATFORM_CONSTRAINTS[platform];

    const system = `${sarahFilter}

${platformConstraints}

Your output must be ONLY the finished content. No preamble like "Here's your post:" or "Sure, here is...".
No meta-commentary. Start directly with the content itself.`;

    const prompt = `Source material (proven content with validated audience traction):
Title: ${title}

Content:
${sourceText.slice(0, 4_000)}

Task: Re-engineer this proven content into a ${platform.replace("_", " ")} post using the DNA and platform rules above.
The output must feel like the original author wrote it for this specific platform — not like it was AI-generated.`;

    return { system, prompt };
  }
}
```

---

## core/services/mesh/IngestionWorkflow.ts
```
/**
 * IngestionWorkflow — proper Temporal workflow definition.
 *
 * This file runs inside Temporal's V8 isolate — NO Node.js I/O here.
 * All I/O is delegated to activities (IngestionActivities.ts) via proxyActivities.
 *
 * Temporal guarantees: if the Mac dies mid-workflow, Temporal replays the
 * history and resumes at the exact activity it left off. No data loss.
 *
 * Wire the worker: scripts/mesh-temporal-worker.ts
 * Start a workflow: scripts/mesh-trigger-workflow.ts
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as Activities from "@/core/services/mesh/IngestionActivities";

// ── Type contracts (shared between workflow + activities) ──────────────────────

export interface FetchYouTubeMetadataInput {
  channelId: string;
  minViewCount: number;
  maxResults?: number;
}

export interface FetchYouTubeMetadataOutput {
  itemCount: number;
  ingestedIds: string[];
}

export interface GenerateEmbeddingsInput {
  contentItemIds: string[];
}

export interface GenerateEmbeddingsOutput {
  embeddedCount: number;
}

export interface ExtractCreativeDnaInput {
  contentItemIds: string[];
  ollamaModel: string;
}

export interface ExtractCreativeDnaOutput {
  dnaPrompt: string;
  analyzedCount: number;
}

export interface DiscoveryIngestionWorkflowInput {
  channelId: string;
  minViewCount: number;
  extractDna: boolean;
  ollamaModel?: string;
}

export interface DiscoveryIngestionWorkflowOutput {
  ingestedCount: number;
  embeddedCount: number;
  dnaPrompt?: string;
}

// ── Activity proxies (Temporal injects the real implementations) ───────────────
const { fetchYouTubeMetadata, generateEmbeddings, extractCreativeDna } =
  proxyActivities<typeof Activities>({
    startToCloseTimeout: "10 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "5s",
      backoffCoefficient: 2,
    },
  });

// ── Workflow definition ────────────────────────────────────────────────────────
export async function discoveryIngestionWorkflow(
  input: DiscoveryIngestionWorkflowInput,
): Promise<DiscoveryIngestionWorkflowOutput> {
  const { channelId, minViewCount, extractDna, ollamaModel = "gemma3:27b" } = input;

  // Step 1 — Fetch YouTube metadata + write to Postgres outbox (idempotent upserts).
  const { ingestedIds } = await fetchYouTubeMetadata({
    channelId,
    minViewCount,
    maxResults: 50,
  });

  // Step 2 — Generate semantic embeddings for newly ingested items.
  const { embeddedCount } = await generateEmbeddings({
    contentItemIds: ingestedIds,
  });

  // Step 3 (opt-in) — Extract Creative DNA from top performers via Gemma 4.
  let dnaPrompt: string | undefined;
  if (extractDna && ingestedIds.length > 0) {
    const topIds = ingestedIds.slice(0, 10);
    const result = await extractCreativeDna({ contentItemIds: topIds, ollamaModel });
    dnaPrompt = result.dnaPrompt;
  }

  return { ingestedCount: ingestedIds.length, embeddedCount, dnaPrompt };
}
```

---

## core/services/mesh/IngestionActivities.ts
```
/**
 * IngestionActivities — Temporal activity implementations.
 *
 * Activities run in normal Node.js context (full I/O access).
 * Each exported function maps 1:1 to an activity proxy in IngestionWorkflow.ts.
 *
 * Temporal guarantees: if the worker crashes mid-activity, Temporal retries
 * from the start of that activity (idempotent design required).
 * The outbox pattern + upsert semantics make all writes idempotent.
 */
import { Pool } from "pg";
import { UniversalContentIngestService } from "@/core/services/UniversalContentIngestService";
import { youtubeApiListSchema } from "@/lib/mesh/youtubeSchema";
import { getMeshEnv } from "@/lib/mesh/env";
import { saveDna } from "@/lib/mesh/dnaStore";
import type {
  FetchYouTubeMetadataInput,
  FetchYouTubeMetadataOutput,
  GenerateEmbeddingsInput,
  GenerateEmbeddingsOutput,
  ExtractCreativeDnaInput,
  ExtractCreativeDnaOutput,
} from "@/core/services/mesh/IngestionWorkflow";

// ── Activity: Fetch YouTube metadata + ingest into outbox ─────────────────────
export async function fetchYouTubeMetadata(
  input: FetchYouTubeMetadataInput,
): Promise<FetchYouTubeMetadataOutput> {
  const env = getMeshEnv();
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not set");

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("channelId", input.channelId);
  searchUrl.searchParams.set("maxResults", String(input.maxResults ?? 50));
  searchUrl.searchParams.set("order", "viewCount");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) throw new Error(`YouTube search ${searchRes.status}`);

  const searchJson = (await searchRes.json()) as {
    items?: Array<{ id?: { videoId?: string } }>;
  };
  const videoIds = (searchJson.items ?? [])
    .map((i) => i.id?.videoId)
    .filter(Boolean) as string[];

  if (videoIds.length === 0) return { itemCount: 0, ingestedIds: [] };

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "snippet,statistics,contentDetails");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

  const videosRes = await fetch(videosUrl.toString());
  if (!videosRes.ok) throw new Error(`YouTube videos ${videosRes.status}`);

  const list = youtubeApiListSchema.parse(await videosRes.json());
  const service = new UniversalContentIngestService();
  const ingestedIds: string[] = [];

  for (const item of list.items) {
    const viewCount = parseInt(item.statistics?.viewCount ?? "0", 10);
    if (viewCount < input.minViewCount) continue;

    await service.ingest({
      schemaVersion: "universal-content.v1",
      sourcePlatform: "YOUTUBE",
      externalId: item.id,
      sourceChannelId: input.channelId,
      canonicalUrl: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.snippet.title,
      description: item.snippet.description,
      contentText: [item.snippet.title, item.snippet.description].filter(Boolean).join("\n\n"),
      viewCount,
      likeCount: item.statistics?.likeCount ? parseInt(item.statistics.likeCount, 10) : undefined,
      commentCount: item.statistics?.commentCount ? parseInt(item.statistics.commentCount, 10) : undefined,
      languageCode: item.snippet.defaultLanguage,
      publishedAt: item.snippet.publishedAt,
      discoveredAt: new Date().toISOString(),
      rawPayload: item as unknown as Record<string, unknown>,
    });
    ingestedIds.push(item.id);
  }

  return { itemCount: list.items.length, ingestedIds };
}

// ── Activity: Generate pgvector embeddings via Ollama Metal ───────────────────
export async function generateEmbeddings(
  input: GenerateEmbeddingsInput,
): Promise<GenerateEmbeddingsOutput> {
  const env = getMeshEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  let embeddedCount = 0;

  try {
    for (const externalId of input.contentItemIds) {
      const { rows } = await pool.query<{
        id: string;
        title: string;
        description: string | null;
        transcript_text: string | null;
        content_text: string;
      }>(
        `SELECT id, title, description, transcript_text, content_text
         FROM "MeshContentItem" WHERE external_id = $1`,
        [externalId],
      );
      if (!rows[0]) continue;

      const r = rows[0];
      const text = [r.title, r.description, r.transcript_text ?? r.content_text]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8_192);

      if (!text.trim()) continue;

      try {
        const res = await fetch(`${env.OLLAMA_HOST}/api/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: env.OLLAMA_EMBED_MODEL, prompt: text }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) continue;

        const { embedding } = (await res.json()) as { embedding: number[] };
        await pool.query(
          `UPDATE "MeshContentItem" SET embedding = $1::vector WHERE id = $2`,
          [`[${embedding.join(",")}]`, r.id],
        );
        embeddedCount++;
      } catch {
        // Best-effort per item — embedding worker will catch stragglers.
      }
    }
  } finally {
    await pool.end();
  }

  return { embeddedCount };
}

// ── Activity: Extract Creative DNA via Gemma 4 + persist ─────────────────────
export async function extractCreativeDna(
  input: ExtractCreativeDnaInput,
): Promise<ExtractCreativeDnaOutput> {
  const env = getMeshEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });

  let rows: Array<{ title: string; description: string | null; transcript_text: string | null; view_count: number | null }> = [];
  try {
    const res = await pool.query(
      `SELECT title, description, transcript_text, view_count
       FROM "MeshContentItem"
       WHERE external_id = ANY($1::text[])
       ORDER BY view_count DESC NULLS LAST`,
      [input.contentItemIds],
    );
    rows = res.rows;
  } finally {
    await pool.end();
  }

  const transcriptBundle = rows
    .map(
      (r, i) =>
        `### Video ${i + 1}: ${r.title} (${r.view_count ?? 0} views)\n${r.transcript_text ?? r.description ?? "(no transcript)"}`,
    )
    .join("\n\n---\n\n")
    .slice(0, 32_000);

  const userPrompt = `Analyze these transcripts. Identify the core creative patterns, high-leverage hooks, and contrarian insights.
Do not use jargon. Do not impose an external persona. Speak from the data.
Summarize the 'Native Creative DNA' that drives this engagement in ≤400 words.
Format: a system-prompt-ready paragraph that captures the authentic voice, thinking style, and what makes this content resonate.

${transcriptBundle}`;

  const ollamaRes = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.ollamaModel,
      system: "You are a creative DNA analyst. Extract patterns from proven content. No hallucinations, only data.",
      prompt: userPrompt,
      stream: false,
      options: { temperature: 0.85, top_p: 0.95, top_k: 60 },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!ollamaRes.ok) throw new Error(`Ollama generate ${ollamaRes.status}`);
  const { response } = (await ollamaRes.json()) as { response: string };
  const dnaPrompt = response.trim();

  await saveDna({
    dnaPrompt,
    analyzedCount: rows.length,
    channelId: input.contentItemIds[0] ?? "unknown",
    ollamaModel: input.ollamaModel,
    extractedAt: new Date().toISOString(),
  });

  return { dnaPrompt, analyzedCount: rows.length };
}
```

---

## core/services/mesh/ContentWaterfallWorkflow.ts
```
/**
 * ContentWaterfallWorkflow — durable Temporal workflow for the Distribution Grid.
 *
 * V8 isolate: NO Node.js I/O here. All I/O is in ContentWaterfallActivities.ts.
 *
 * Sequence (Temporal guarantees crash-safety at each step):
 *   1. analyzeGold      — why did this content perform? (Gemma 4 analysis)
 *   2. buildSarahFilter — retrieve Creative DNA from Postgres
 *   3. generateDrafts   — run all 4 platform adapters IN PARALLEL
 *   4. auditDrafts      — second Gemma pass: does each draft match the DNA?
 *   5. parkDrafts       — upsert all drafts to mesh_content_draft table
 *
 * Durability: if the Mac dies after LinkedIn is generated but before Newsletter,
 * Temporal replays history and resumes at Newsletter. LinkedIn is NOT regenerated.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as Activities from "@/core/services/mesh/ContentWaterfallActivities";
import type { DistributionPlatform } from "@/core/ports/DistributionAdapterPort";

export interface ContentWaterfallInput {
  contentItemId: string;
  workflowId?: string;
}

export interface ContentWaterfallOutput {
  contentItemId: string;
  draftsParked: number;
  reasonForTraction: string;
  platforms: DistributionPlatform[];
}

const {
  analyzeGold,
  buildSarahFilter,
  generateDraft,
  auditDrafts,
  parkDrafts,
} = proxyActivities<typeof Activities>({
  startToCloseTimeout: "15 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10s",
    backoffCoefficient: 2,
    nonRetryableErrorTypes: [],
  },
});

const PLATFORMS: DistributionPlatform[] = [
  "LINKEDIN",
  "X_THREAD",
  "NEWSLETTER",
  "EMAIL_SEQUENCE",
];

export async function contentWaterfallWorkflow(
  input: ContentWaterfallInput,
): Promise<ContentWaterfallOutput> {
  const workflowId = input.workflowId ?? `waterfall-${input.contentItemId}`;

  // Step 1 + 2 in parallel — independent reads
  const [{ reasonForTraction }, sarahFilter] = await Promise.all([
    analyzeGold({ contentItemId: input.contentItemId, workflowId }),
    buildSarahFilter(),
  ]);

  // Step 3 — generate all 4 platform drafts IN PARALLEL
  // Temporal tracks each as a separate activity — crash-safe per platform
  const rawDrafts = await Promise.all(
    PLATFORMS.map((platform) =>
      generateDraft({
        contentItemId: input.contentItemId,
        workflowId,
        platform,
        sarahFilter,
        reasonForTraction,
      }),
    ),
  );

  // Step 4 — audit all drafts (second Gemma pass for DNA alignment)
  const { audited } = await auditDrafts({
    workflowId,
    drafts: rawDrafts,
    sarahFilter,
  });

  // Step 5 — park everything to Postgres as PENDING
  const { parkedCount } = await parkDrafts({
    contentItemId: input.contentItemId,
    workflowId,
    drafts: audited,
  });

  return {
    contentItemId: input.contentItemId,
    draftsParked: parkedCount,
    reasonForTraction,
    platforms: PLATFORMS,
  };
}
```

---

## core/services/mesh/ContentWaterfallActivities.ts
```
/**
 * ContentWaterfallActivities — all I/O for the Distribution Grid.
 *
 * Activities are Temporal's "safe" I/O boundary. Each function is idempotent:
 * if the workflow retries an activity, re-running it produces the same result
 * (upsert semantics prevent duplicate drafts for the same workflowId + platform).
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { LinkedInPostAdapter } from "@/adapters/distribution/LinkedInPostAdapter";
import { XThreadAdapter } from "@/adapters/distribution/XThreadAdapter";
import { NewsletterArticleAdapter } from "@/adapters/distribution/NewsletterArticleAdapter";
import { EmailSequenceAdapter } from "@/adapters/distribution/EmailSequenceAdapter";
import { getMeshEnv } from "@/lib/mesh/env";
import type { DistributionPlatform, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";

export interface AnalyzeGoldInput {
  contentItemId: string;
  workflowId: string;
}

export interface AnalyzeGoldOutput {
  reasonForTraction: string;
  contentItem: UniversalContent;
}

export interface GenerateDraftInput {
  contentItemId: string;
  workflowId: string;
  platform: DistributionPlatform;
  sarahFilter: string;
  reasonForTraction: string;
}

export interface AuditDraftsInput {
  workflowId: string;
  drafts: DistributionDraft[];
  sarahFilter: string;
}

export interface AuditDraftsOutput {
  audited: Array<DistributionDraft & { auditNotes: string }>;
}

export interface ParkDraftsInput {
  contentItemId: string;
  workflowId: string;
  drafts: Array<DistributionDraft & { auditNotes?: string }>;
}

// ── Activity: Analyze Gold ────────────────────────────────────────────────────
export async function analyzeGold(input: AnalyzeGoldInput): Promise<AnalyzeGoldOutput> {
  const env = getMeshEnv();

  const item = await prisma.meshContentItem.findUniqueOrThrow({
    where: { id: input.contentItemId },
  });

  const content: UniversalContent = {
    schemaVersion: "universal-content.v1",
    sourcePlatform: item.sourcePlatform as UniversalContent["sourcePlatform"],
    externalId: item.externalId,
    sourceChannelId: item.sourceChannelId ?? undefined,
    canonicalUrl: item.canonicalUrl,
    title: item.title,
    description: item.description ?? "",
    contentText: item.contentText,
    transcriptText: item.transcriptText ?? undefined,
    languageCode: item.languageCode ?? undefined,
    viewCount: item.viewCount ?? undefined,
    likeCount: item.likeCount ?? undefined,
    commentCount: item.commentCount ?? undefined,
    publishedAt: item.publishedAt?.toISOString(),
    discoveredAt: item.discoveredAt.toISOString(),
    rawPayload: (item.rawPayload as Record<string, unknown>) ?? {},
  };

  const sourceText = item.transcriptText ?? item.contentText;

  let reasonForTraction = `High-performing content with ${item.viewCount ?? 0} views.`;

  try {
    const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemma3:27b",
        system: "You are a content performance analyst. Be concise and specific.",
        prompt: `Analyze this content in 2-3 sentences. What is the single core reason it performs well?
What psychological trigger does it activate? What makes the hook irresistible?

Title: ${item.title}
Views: ${item.viewCount ?? 0}

Content excerpt:
${sourceText.slice(0, 2_000)}`,
        stream: false,
        options: { temperature: 0.4, top_p: 0.88 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { response: string };
      reasonForTraction = json.response.trim();
    }
  } catch { /* fallback value stands */ }

  return { reasonForTraction, contentItem: content };
}

// ── Activity: Build Sarah Filter ──────────────────────────────────────────────
export async function buildSarahFilter(): Promise<string> {
  const persona = new PersonaEngineService();
  return persona.buildSarahFilter();
}

// ── Activity: Generate Single Draft ──────────────────────────────────────────
export async function generateDraft(input: GenerateDraftInput): Promise<DistributionDraft> {
  const adapters: Record<DistributionPlatform, { generate: (c: UniversalContent, f: string) => Promise<DistributionDraft> }> = {
    LINKEDIN: new LinkedInPostAdapter(),
    X_THREAD: new XThreadAdapter(),
    NEWSLETTER: new NewsletterArticleAdapter(),
    EMAIL_SEQUENCE: new EmailSequenceAdapter(),
  };

  const item = await prisma.meshContentItem.findUniqueOrThrow({
    where: { id: input.contentItemId },
  });

  const content: UniversalContent = {
    schemaVersion: "universal-content.v1",
    sourcePlatform: item.sourcePlatform as UniversalContent["sourcePlatform"],
    externalId: item.externalId,
    sourceChannelId: item.sourceChannelId ?? undefined,
    canonicalUrl: item.canonicalUrl,
    title: item.title,
    description: item.description ?? "",
    contentText: item.contentText,
    transcriptText: item.transcriptText ?? undefined,
    viewCount: item.viewCount ?? undefined,
    publishedAt: item.publishedAt?.toISOString(),
    discoveredAt: item.discoveredAt.toISOString(),
    rawPayload: (item.rawPayload as Record<string, unknown>) ?? {},
  };

  return adapters[input.platform].generate(content, input.sarahFilter);
}

// ── Activity: Audit Drafts (second Judge pass) ────────────────────────────────
export async function auditDrafts(input: AuditDraftsInput): Promise<AuditDraftsOutput> {
  const env = getMeshEnv();

  const audited = await Promise.all(
    input.drafts.map(async (draft) => {
      let auditNotes = "Audit skipped (Ollama unavailable). Confidence from DNA scorer.";
      try {
        const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gemma3:27b",
            system: `You are a brand voice auditor. The target DNA is:\n${input.sarahFilter.slice(0, 800)}`,
            prompt: `Does this ${draft.platform} draft match the DNA? Reply in 1 sentence: pass or specific concern.

Draft:
${draft.draftText.slice(0, 1_000)}`,
            stream: false,
            options: { temperature: 0.2, top_p: 0.85 },
          }),
          signal: AbortSignal.timeout(45_000),
        });
        if (res.ok) {
          const json = (await res.json()) as { response: string };
          auditNotes = json.response.trim();
        }
      } catch { /* fallback */ }

      return { ...draft, auditNotes };
    }),
  );

  return { audited };
}

// ── Activity: Park Drafts to Postgres ────────────────────────────────────────
export async function parkDrafts(input: ParkDraftsInput): Promise<{ parkedCount: number }> {
  let parkedCount = 0;

  for (const draft of input.drafts) {
    await prisma.meshContentDraft.upsert({
      where: {
        // Idempotency key: same workflow + platform = same draft
        contentItemId_platform_workflowId: {
          contentItemId: input.contentItemId,
          platform: draft.platform,
          workflowId: input.workflowId,
        },
      },
      create: {
        id: randomUUID(),
        contentItemId: input.contentItemId,
        workflowId: input.workflowId,
        platform: draft.platform,
        draftText: draft.draftText,
        dnaConfidence: draft.dnaConfidence,
        auditNotes: draft.auditNotes,
        status: "PENDING",
      },
      update: {
        draftText: draft.draftText,
        dnaConfidence: draft.dnaConfidence,
        auditNotes: draft.auditNotes,
      },
    });
    parkedCount++;
  }

  return { parkedCount };
}
```

---

## core/services/mesh/PerformanceSyncService.ts
```
/**
 * PerformanceSyncService — feedback loop stub.
 *
 * Phase 5 will implement pulling real performance data from
 * X, LinkedIn, and Email back into the mesh to score AI-generated
 * content against its source "Gold."
 *
 * The machine learns: did the LinkedIn post outperform the original video?
 * If yes — extract what was different and feed it back into the DNA baseline.
 */
import { prisma } from "@/lib/db";

export interface PerformanceReport {
  contentItemId: string;
  platform: string;
  impressions?: number;
  engagements?: number;
  clicks?: number;
  replies?: number;
  reportedAt: Date;
}

export interface DraftPerformanceScore {
  draftId: string;
  platform: string;
  performanceScore: number; // 0-1: normalized against source Gold
  outperformsGold: boolean;
  delta: number; // engagement delta vs source view_count
}

export class PerformanceSyncService {
  /**
   * Stub: record performance data for a published draft.
   * Phase 5: replace stub body with real X/LinkedIn API calls.
   */
  async recordPerformance(report: PerformanceReport): Promise<void> {
    // TODO Phase 5: pull from X API v2, LinkedIn Analytics API, Resend email stats
    console.log(`[performance-sync] Recording performance for ${report.platform}:${report.contentItemId}`);
    console.log(`[performance-sync] Stub — real sync coming in Phase 5`);
  }

  /**
   * Score a set of published drafts against their source Gold.
   * Returns items where AI output outperformed the original.
   */
  async scoreAgainstGold(contentItemId: string): Promise<DraftPerformanceScore[]> {
    const item = await prisma.meshContentItem.findUnique({
      where: { id: contentItemId },
      select: { viewCount: true },
    });
    const sourceViews = item?.viewCount ?? 0;

    // Stub: returns synthetic scores. Phase 5: pull real engagement data.
    const drafts = await prisma.meshContentDraft.findMany({
      where: { contentItemId, status: "PUBLISHED" },
      select: { id: true, platform: true, dnaConfidence: true },
    });

    return drafts.map((d) => {
      // Placeholder score until real analytics are wired
      const performanceScore = d.dnaConfidence ?? 0.5;
      const syntheticEngagements = Math.round(sourceViews * performanceScore * 0.1);
      return {
        draftId: d.id,
        platform: d.platform,
        performanceScore,
        outperformsGold: performanceScore > 0.7,
        delta: syntheticEngagements - sourceViews,
      };
    });
  }

  /**
   * Phase 5 entry point: pull platform data and update DNA baseline if
   * AI-generated content consistently outperforms source Gold.
   */
  async runFeedbackLoop(contentItemId: string): Promise<void> {
    const scores = await this.scoreAgainstGold(contentItemId);
    const winners = scores.filter((s) => s.outperformsGold);

    if (winners.length > 0) {
      console.log(
        `[performance-sync] ${winners.length} AI drafts outperformed Gold for ${contentItemId}`,
      );
      // TODO Phase 5: extract winning patterns and call saveDna() to update DNA baseline
    }
  }
}
```

---

## adapters/intelligence/MeshJudgeAdapter.ts
```
import type { EvaluationJudgePort } from "@/core/ports/EvaluationJudgePort";
import type { ContentEvaluation, UniversalContent } from "@/lib/mesh/universalContentSchema";

/**
 * Seed judge implementation: deterministic and explicit.
 * This is intentionally simple so the port exists now; swap in Gemma/Ollama later without changing callers.
 */
export class MeshJudgeAdapter implements EvaluationJudgePort {
  async evaluate(content: UniversalContent): Promise<ContentEvaluation> {
    const text = `${content.title}\n${content.description ?? ""}\n${content.contentText}`.trim();
    const richness = Math.min(text.length / 4000, 1);
    const engagement = Math.min((content.viewCount ?? 0) / 10_000, 1);

    return {
      evaluatorKind: "RULE_ENGINE",
      modelName: "mesh-rule-judge.v1",
      verdict: engagement > 0.05 || richness > 0.2 ? "ACCEPT" : "REVIEW",
      qualityScore: Number((0.45 + richness * 0.35 + engagement * 0.2).toFixed(3)),
      contrarianScore: Number((Math.min(text.split("?").length / 10, 1) * 0.4).toFixed(3)),
      nuanceScore: Number((Math.min(text.split(".").length / 25, 1) * 0.6).toFixed(3)),
      notes: "Bootstrap judge until local model scoring is wired.",
      payload: {
        character_count: text.length,
        view_count: content.viewCount ?? 0,
      },
    };
  }
}
```

---

## adapters/intelligence/OllamaGemmaJudgeAdapter.ts
```
/**
 * OllamaGemmaJudgeAdapter — real AI evaluation via local Gemma 4.
 *
 * Replaces the bootstrap rule engine. Calls Ollama /api/generate and
 * asks Gemma to return a structured JSON verdict on content quality,
 * contrarian angle, and nuance score.
 *
 * Fallback: if Ollama is unreachable or returns malformed JSON, the adapter
 * degrades gracefully to a deterministic score rather than crashing.
 */
import type { EvaluationJudgePort } from "@/core/ports/EvaluationJudgePort";
import type { ContentEvaluation, UniversalContent } from "@/lib/mesh/universalContentSchema";
import { getMeshEnv } from "@/lib/mesh/env";

interface GemmaVerdict {
  verdict: "ACCEPT" | "REVIEW" | "REJECT";
  quality_score: number;
  contrarian_score: number;
  nuance_score: number;
  notes: string;
}

const JUDGE_SYSTEM_PROMPT = `You are a content intelligence evaluator. Your task is to analyze a piece of content and return a JSON object with exactly these fields:
{
  "verdict": "ACCEPT" | "REVIEW" | "REJECT",
  "quality_score": 0.0-1.0,
  "contrarian_score": 0.0-1.0,
  "nuance_score": 0.0-1.0,
  "notes": "one sentence explaining the verdict"
}

Scoring guide:
- quality_score: How well-written, clear, and valuable is this for an audience?
- contrarian_score: How much does this challenge conventional thinking or offer a unique angle?
- nuance_score: How much complexity, subtlety, or layered insight does this contain?
- verdict: ACCEPT if quality_score > 0.55, REJECT if < 0.25, otherwise REVIEW.

Return ONLY the JSON object. No markdown, no explanation, no preamble.`;

function buildJudgePrompt(content: UniversalContent): string {
  const text = [content.title, content.description, content.contentText, content.transcriptText]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6_000);

  return `Platform: ${content.sourcePlatform}
Views: ${content.viewCount ?? 0}
Title: ${content.title}

Content:
${text}`;
}

function fallbackScore(content: UniversalContent): GemmaVerdict {
  const text = `${content.title} ${content.description ?? ""} ${content.contentText}`;
  const richness = Math.min(text.length / 4_000, 1);
  const engagement = Math.min((content.viewCount ?? 0) / 10_000, 1);
  const q = Number((0.45 + richness * 0.35 + engagement * 0.2).toFixed(3));
  return {
    verdict: q > 0.55 ? "ACCEPT" : q < 0.25 ? "REJECT" : "REVIEW",
    quality_score: q,
    contrarian_score: Number((Math.min(text.split("?").length / 10, 1) * 0.4).toFixed(3)),
    nuance_score: Number((Math.min(text.split(".").length / 25, 1) * 0.6).toFixed(3)),
    notes: "Fallback rule-engine (Ollama unreachable).",
  };
}

export class OllamaGemmaJudgeAdapter implements EvaluationJudgePort {
  async evaluate(content: UniversalContent): Promise<ContentEvaluation> {
    const env = getMeshEnv();

    let verdict: GemmaVerdict;

    try {
      const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemma3:27b",
          system: JUDGE_SYSTEM_PROMPT,
          prompt: buildJudgePrompt(content),
          stream: false,
          format: "json",
          options: { temperature: 0.3, top_p: 0.9 },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) throw new Error(`Ollama ${res.status}`);

      const raw = (await res.json()) as { response: string };
      verdict = JSON.parse(raw.response.trim()) as GemmaVerdict;

      if (!["ACCEPT", "REVIEW", "REJECT"].includes(verdict.verdict)) {
        throw new Error("Invalid verdict field");
      }
    } catch (err) {
      console.warn("[gemma-judge] Falling back to rule engine:", (err as Error).message);
      verdict = fallbackScore(content);
    }

    return {
      evaluatorKind: "AI_JUDGE",
      modelName: "gemma3:27b",
      verdict: verdict.verdict,
      qualityScore: Math.max(0, Math.min(1, verdict.quality_score)),
      contrarianScore: Math.max(0, Math.min(1, verdict.contrarian_score)),
      nuanceScore: Math.max(0, Math.min(1, verdict.nuance_score)),
      notes: verdict.notes,
      payload: { source_platform: content.sourcePlatform, view_count: content.viewCount ?? 0 },
    };
  }
}
```

---

## adapters/distribution/LinkedInPostAdapter.ts
```
/**
 * LinkedInPostAdapter — authority-driven, cliffhanger structure, high readability.
 * Calls local Gemma 4 via Ollama with the Sarah Filter injected as system prompt.
 */
import type { DistributionAdapterPort, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { getMeshEnv } from "@/lib/mesh/env";

const persona = new PersonaEngineService();

export class LinkedInPostAdapter implements DistributionAdapterPort {
  readonly platform = "LINKEDIN" as const;

  async generate(content: UniversalContent, sarahFilter: string): Promise<DistributionDraft> {
    const env = getMeshEnv();
    const sourceText = content.transcriptText ?? content.contentText;
    const { system, prompt } = await persona.buildGenerationPrompt(
      content.title,
      sourceText,
      "LINKEDIN",
      sarahFilter,
    );

    let draftText: string;
    try {
      const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemma3:27b",
          system,
          prompt,
          stream: false,
          options: { temperature: 0.72, top_p: 0.92, top_k: 50 },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const json = (await res.json()) as { response: string };
      draftText = json.response.trim();
    } catch (err) {
      draftText = `[DRAFT GENERATION FAILED — LinkedIn]\nSource: ${content.title}\nError: ${(err as Error).message}`;
    }

    const dnaConfidence = scoreDnaAlignment(draftText, sarahFilter);
    return { platform: "LINKEDIN", draftText, dnaConfidence };
  }
}

function scoreDnaAlignment(draft: string, filter: string): number {
  const dnaKeywords = extractKeySignals(filter);
  const matches = dnaKeywords.filter((kw) =>
    draft.toLowerCase().includes(kw.toLowerCase()),
  ).length;
  return Math.min(matches / Math.max(dnaKeywords.length, 1), 1);
}

function extractKeySignals(filter: string): string[] {
  const lines = filter.split("\n").filter((l) => l.trim().length > 10);
  return lines.slice(0, 8).map((l) => l.split(" ").slice(0, 3).join(" "));
}
```

---

## adapters/distribution/XThreadAdapter.ts
```
/**
 * XThreadAdapter — high-tension, hook-first, 5-10 tweet thread format.
 * Calls local Gemma 4 via Ollama with the Sarah Filter injected as system prompt.
 */
import type { DistributionAdapterPort, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { getMeshEnv } from "@/lib/mesh/env";

const persona = new PersonaEngineService();

export class XThreadAdapter implements DistributionAdapterPort {
  readonly platform = "X_THREAD" as const;

  async generate(content: UniversalContent, sarahFilter: string): Promise<DistributionDraft> {
    const env = getMeshEnv();
    const sourceText = content.transcriptText ?? content.contentText;
    const { system, prompt } = await persona.buildGenerationPrompt(
      content.title,
      sourceText,
      "X_THREAD",
      sarahFilter,
    );

    let draftText: string;
    try {
      const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemma3:27b",
          system,
          prompt,
          stream: false,
          options: { temperature: 0.78, top_p: 0.93, top_k: 55 },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const json = (await res.json()) as { response: string };
      draftText = json.response.trim();
    } catch (err) {
      draftText = `[DRAFT GENERATION FAILED — X Thread]\nSource: ${content.title}\nError: ${(err as Error).message}`;
    }

    const dnaConfidence = scoreDnaAlignment(draftText, sarahFilter);
    return { platform: "X_THREAD", draftText, dnaConfidence };
  }
}

function scoreDnaAlignment(draft: string, filter: string): number {
  const signals = filter.split("\n").filter((l) => l.trim().length > 10).slice(0, 8);
  const matches = signals.filter((s) =>
    draft.toLowerCase().includes(s.split(" ")[0]?.toLowerCase() ?? ""),
  ).length;
  return Math.min(matches / Math.max(signals.length, 1), 1);
}
```

---

## adapters/distribution/NewsletterArticleAdapter.ts
```
/**
 * NewsletterArticleAdapter — deep-dive narrative, converts short-form gold
 * into long-form value (600-1,200 words). Story-first, not summary-first.
 * Calls local Gemma 4 via Ollama with the Sarah Filter injected as system prompt.
 */
import type { DistributionAdapterPort, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { getMeshEnv } from "@/lib/mesh/env";

const persona = new PersonaEngineService();

export class NewsletterArticleAdapter implements DistributionAdapterPort {
  readonly platform = "NEWSLETTER" as const;

  async generate(content: UniversalContent, sarahFilter: string): Promise<DistributionDraft> {
    const env = getMeshEnv();
    const sourceText = content.transcriptText ?? content.contentText;
    const { system, prompt } = await persona.buildGenerationPrompt(
      content.title,
      sourceText,
      "NEWSLETTER",
      sarahFilter,
    );

    let draftText: string;
    try {
      const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemma3:27b",
          system,
          prompt,
          stream: false,
          // Lower temp for newsletters — structure over chaos
          options: { temperature: 0.65, top_p: 0.90, top_k: 45 },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const json = (await res.json()) as { response: string };
      draftText = json.response.trim();
    } catch (err) {
      draftText = `[DRAFT GENERATION FAILED — Newsletter]\nSource: ${content.title}\nError: ${(err as Error).message}`;
    }

    const dnaConfidence = scoreDnaAlignment(draftText, sarahFilter);
    return { platform: "NEWSLETTER", draftText, dnaConfidence };
  }
}

function scoreDnaAlignment(draft: string, filter: string): number {
  const wordCount = draft.split(/\s+/).length;
  const lengthScore = wordCount >= 600 && wordCount <= 1_200 ? 0.3 : 0.1;
  const signals = filter.split("\n").filter((l) => l.trim().length > 10).slice(0, 6);
  const keywordScore =
    signals.filter((s) => draft.toLowerCase().includes(s.split(" ")[0]?.toLowerCase() ?? ""))
      .length /
    Math.max(signals.length, 1);
  return Math.min(lengthScore + keywordScore * 0.7, 1);
}
```

---

## adapters/distribution/EmailSequenceAdapter.ts
```
/**
 * EmailSequenceAdapter — direct, punchy, inner-circle personal emails.
 * 150-300 words. One idea per email. Calls local Gemma 4 via Ollama.
 */
import type { DistributionAdapterPort, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { getMeshEnv } from "@/lib/mesh/env";

const persona = new PersonaEngineService();

export class EmailSequenceAdapter implements DistributionAdapterPort {
  readonly platform = "EMAIL_SEQUENCE" as const;

  async generate(content: UniversalContent, sarahFilter: string): Promise<DistributionDraft> {
    const env = getMeshEnv();
    const sourceText = content.transcriptText ?? content.contentText;
    const { system, prompt } = await persona.buildGenerationPrompt(
      content.title,
      sourceText,
      "EMAIL_SEQUENCE",
      sarahFilter,
    );

    let draftText: string;
    try {
      const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemma3:27b",
          system,
          prompt,
          stream: false,
          // Highest temperature for email — most personal, most raw
          options: { temperature: 0.82, top_p: 0.94, top_k: 58 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const json = (await res.json()) as { response: string };
      draftText = json.response.trim();
    } catch (err) {
      draftText = `[DRAFT GENERATION FAILED — Email]\nSource: ${content.title}\nError: ${(err as Error).message}`;
    }

    const dnaConfidence = scoreDnaAlignment(draftText, sarahFilter);
    return { platform: "EMAIL_SEQUENCE", draftText, dnaConfidence };
  }
}

function scoreDnaAlignment(draft: string, filter: string): number {
  const wordCount = draft.split(/\s+/).length;
  const lengthScore = wordCount >= 150 && wordCount <= 300 ? 0.35 : 0.1;
  const hasBuzz = /leverage|synergy|game.changer|paradigm/i.test(draft) ? -0.3 : 0;
  const signals = filter.split("\n").filter((l) => l.trim().length > 10).slice(0, 5);
  const kw =
    signals.filter((s) => draft.toLowerCase().includes(s.split(" ")[0]?.toLowerCase() ?? ""))
      .length /
    Math.max(signals.length, 1);
  return Math.max(0, Math.min(lengthScore + kw * 0.65 + hasBuzz, 1));
}
```

---

## scripts/mesh-youtube-ingest.ts
```
import { UniversalContentIngestService } from "@/core/services/UniversalContentIngestService";
import { youtubeApiListSchema, type YoutubeApiVideo } from "@/lib/mesh/youtubeSchema";

const CHANNEL_ID = process.env.MESH_YOUTUBE_CHANNEL_ID?.trim() || "UCipXVNRvJIBoZt7O_aPIgzg";
const MIN_VIEWS = Number(process.env.MESH_YOUTUBE_MIN_VIEWS?.trim() || "500");

function requireApiKey() {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    throw new Error("YOUTUBE_API_KEY is required for mesh YouTube ingestion");
  }
  return key;
}

async function fetchChannelVideos(apiKey: string): Promise<YoutubeApiVideo[]> {
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("key", apiKey);
  searchUrl.searchParams.set("channelId", CHANNEL_ID);
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("order", "date");
  searchUrl.searchParams.set("maxResults", "25");
  searchUrl.searchParams.set("type", "video");

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) {
    throw new Error(`YouTube search failed: ${searchRes.status} ${await searchRes.text()}`);
  }

  const searchJson = (await searchRes.json()) as {
    items?: Array<{ id?: { videoId?: string } }>;
  };
  const ids = (searchJson.items ?? []).map((item) => item.id?.videoId).filter(Boolean) as string[];
  if (ids.length === 0) return [];

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("key", apiKey);
  videosUrl.searchParams.set("id", ids.join(","));
  videosUrl.searchParams.set("part", "snippet,statistics,contentDetails");

  const videoRes = await fetch(videosUrl.toString());
  if (!videoRes.ok) {
    throw new Error(`YouTube videos lookup failed: ${videoRes.status} ${await videoRes.text()}`);
  }

  const json = youtubeApiListSchema.parse(await videoRes.json());
  return json.items;
}

async function main() {
  const apiKey = requireApiKey();
  const ingestService = new UniversalContentIngestService();
  const videos = await fetchChannelVideos(apiKey);
  const winners = videos.filter((video) => Number(video.statistics.viewCount) > MIN_VIEWS);

  for (const video of winners) {
    const content = {
      schemaVersion: "universal-content.v1" as const,
      sourcePlatform: "YOUTUBE" as const,
      externalId: video.id,
      sourceChannelId: video.snippet.channelId,
      canonicalUrl: `https://www.youtube.com/watch?v=${video.id}`,
      title: video.snippet.title,
      description: video.snippet.description || "",
      contentText: [video.snippet.title, video.snippet.description].filter(Boolean).join("\n\n"),
      transcriptText: undefined,
      languageCode: video.snippet.defaultLanguage,
      viewCount: Number(video.statistics.viewCount),
      likeCount: video.statistics.likeCount ? Number(video.statistics.likeCount) : undefined,
      commentCount: video.statistics.commentCount ? Number(video.statistics.commentCount) : undefined,
      publishedAt: video.snippet.publishedAt,
      discoveredAt: new Date().toISOString(),
      rawPayload: video as unknown as Record<string, unknown>,
    };

    const saved = await ingestService.ingest(content);
    console.log(`ingested_youtube_video ${video.id} -> ${saved.id}`);
  }
}

main().catch((error) => {
  console.error("mesh-youtube-ingest failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
```

---

## scripts/mesh-outbox-relay.ts
```
#!/usr/bin/env tsx
/**
 * CLI entry point for the Outbox Relay daemon.
 * Run: tsx scripts/mesh-outbox-relay.ts
 * Or:  npm run mesh:relay
 */
import { runOutboxRelay } from "@/lib/mesh/outboxRelay";
import { disconnectProducer } from "@/lib/mesh/kafkaClient";

const controller = new AbortController();

process.on("SIGTERM", () => {
  console.log("[relay] SIGTERM — initiating graceful shutdown");
  controller.abort();
});
process.on("SIGINT", () => {
  console.log("[relay] SIGINT — initiating graceful shutdown");
  controller.abort();
});

runOutboxRelay(controller.signal)
  .then(() => disconnectProducer())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[relay] Fatal:", err);
    process.exit(1);
  });
```

---

## scripts/mesh-embedding-worker.ts
```
#!/usr/bin/env tsx
/**
 * Embedding Worker daemon — continuously fills MeshContentItem.embedding
 * for any row where embedding IS NULL. Runs until SIGTERM/SIGINT.
 *
 * Run: npm run mesh:embed
 * Requires Ollama running locally: ollama pull all-minilm
 */
import { runEmbeddingWorker } from "@/lib/mesh/embeddingWorker";

const controller = new AbortController();

process.on("SIGTERM", () => {
  console.log("[embed-worker] SIGTERM — graceful shutdown");
  controller.abort();
});
process.on("SIGINT", () => {
  console.log("[embed-worker] SIGINT — graceful shutdown");
  controller.abort();
});

console.log("[embed-worker] Starting Sovereign Embedding Worker...");
console.log("[embed-worker] Polling for unembedded MeshContentItem rows...");

runEmbeddingWorker(controller.signal)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[embed-worker] Fatal:", err);
    process.exit(1);
  });
```

---

## scripts/mesh-discovery-mine.ts
```
#!/usr/bin/env tsx
/**
 * Discovery Mine — standalone runner (no Temporal server required).
 *
 * Calls IngestionActivities directly for local development and one-shot runs.
 * For production durable execution (crash-safe): use mesh:trigger instead,
 * which sends the workflow to the Temporal server.
 *
 * Run: npm run mesh:discover
 * Env required: DATABASE_URL, YOUTUBE_API_KEY, OLLAMA_HOST (optional)
 */
import {
  fetchYouTubeMetadata,
  generateEmbeddings,
  extractCreativeDna,
} from "@/core/services/mesh/IngestionActivities";
import { getMeshEnv } from "@/lib/mesh/env";

const CHANNEL_ID = "UCipXVNRvJIBoZt7O_aPIgzg";
const MIN_VIEWS = 500;

async function main() {
  const env = getMeshEnv();

  if (!env.YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is missing from .env");
  }

  console.log("[discovery-mine] ═══════════════════════════════════════════");
  console.log("[discovery-mine]  SARAH-MESH-V1 — Sovereign Discovery Mine  ");
  console.log("[discovery-mine] ═══════════════════════════════════════════");
  console.log(`[discovery-mine] Channel : ${CHANNEL_ID}`);
  console.log(`[discovery-mine] Filter  : view_count > ${MIN_VIEWS}`);
  console.log(`[discovery-mine] Model   : ${env.OLLAMA_EMBED_MODEL} (embed) + gemma3:27b (DNA)`);
  console.log("");

  // ── Step 1: YouTube Sensory Activation ──────────────────────────────────
  console.log("[discovery-mine] [1/3] Fetching YouTube metadata...");
  const { itemCount, ingestedIds } = await fetchYouTubeMetadata({
    channelId: CHANNEL_ID,
    minViewCount: MIN_VIEWS,
    maxResults: 50,
  });
  console.log(`[discovery-mine]       ${itemCount} found, ${ingestedIds.length} passed view filter`);

  if (ingestedIds.length === 0) {
    console.log("[discovery-mine] No qualifying videos found. Exiting.");
    return;
  }

  // ── Step 2: Semantic Memory Population ──────────────────────────────────
  console.log("[discovery-mine] [2/3] Generating pgvector embeddings via Ollama Metal...");
  const { embeddedCount } = await generateEmbeddings({ contentItemIds: ingestedIds });
  console.log(`[discovery-mine]       ${embeddedCount}/${ingestedIds.length} items embedded`);

  // ── Step 3: Creative DNA Extraction via Gemma 4 ─────────────────────────
  const topIds = ingestedIds.slice(0, 10);
  console.log(`[discovery-mine] [3/3] Extracting Creative DNA from top ${topIds.length} videos via Gemma 4...`);
  console.log(`[discovery-mine]       (Temp: 0.85, Top-p: 0.95 — high-entropy extraction)`);

  const { dnaPrompt, analyzedCount } = await extractCreativeDna({
    contentItemIds: topIds,
    ollamaModel: "gemma3:27b",
  });

  console.log(`[discovery-mine]       Analyzed: ${analyzedCount} transcripts`);
  console.log("");
  console.log("[discovery-mine] ─── Creative DNA Baseline ────────────────────────────");
  console.log(dnaPrompt);
  console.log("[discovery-mine] ────────────────────────────────────────────────────");
  console.log("");
  console.log("[discovery-mine] ✓ Discovery Mine complete.");
  console.log(`[discovery-mine]   Ingested : ${ingestedIds.length} videos`);
  console.log(`[discovery-mine]   Embedded : ${embeddedCount} vectors`);
  console.log(`[discovery-mine]   DNA      : stored → query with mesh/get_dna via MCP`);
}

main().catch((err) => {
  console.error("[discovery-mine] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

---

## scripts/mesh-temporal-worker.ts
```
#!/usr/bin/env tsx
/**
 * Temporal Worker — polls the 'sarah-mesh' task queue and executes
 * DiscoveryIngestionWorkflow activities.
 *
 * Run: npm run mesh:worker
 * Requires: Temporal server running (npm run mesh:up first)
 *
 * The worker registers:
 *   - Workflow:   discoveryIngestionWorkflow (IngestionWorkflow.ts)
 *   - Activities: fetchYouTubeMetadata, generateEmbeddings, extractCreativeDna
 */
import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "@/core/services/mesh/IngestionActivities";
import { getMeshEnv } from "@/lib/mesh/env";
import path from "node:path";

const TASK_QUEUE = "sarah-mesh";

async function main() {
  const env = getMeshEnv();

  console.log(`[temporal-worker] Connecting to ${env.TEMPORAL_ADDRESS}`);

  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.resolve(__dirname, "../core/services/mesh/IngestionWorkflow"),
    activities,
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 2,
  });

  console.log(`[temporal-worker] Ready. Task queue: ${TASK_QUEUE}`);

  process.on("SIGTERM", () => {
    console.log("[temporal-worker] SIGTERM — draining");
    worker.shutdown();
  });
  process.on("SIGINT", () => {
    console.log("[temporal-worker] SIGINT — draining");
    worker.shutdown();
  });

  await worker.run();
}

main().catch((err) => {
  console.error("[temporal-worker] Fatal:", err);
  process.exit(1);
});
```

---

## scripts/mesh-trigger-workflow.ts
```
#!/usr/bin/env tsx
/**
 * Trigger a DiscoveryIngestionWorkflow via the Temporal client.
 * Run: npm run mesh:trigger
 *
 * This is the "ignition" command. It starts a durable workflow that:
 *   1. Fetches YouTube metadata for the sovereign channel
 *   2. Generates pgvector embeddings via Ollama Metal
 *   3. Extracts Creative DNA via Gemma 4 31B (Temp 0.85)
 *
 * If the Mac dies mid-run, restart this worker — Temporal resumes exactly
 * where it left off without re-fetching or re-embedding completed steps.
 */
import { Client, Connection } from "@temporalio/client";
import { discoveryIngestionWorkflow } from "@/core/services/mesh/IngestionWorkflow";
import { getMeshEnv } from "@/lib/mesh/env";

const TASK_QUEUE = "sarah-mesh";
const CHANNEL_ID = "UCipXVNRvJIBoZt7O_aPIgzg";

async function main() {
  const env = getMeshEnv();

  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });

  const workflowId = `discovery-mine-${Date.now()}`;
  console.log(`[trigger] Starting workflow: ${workflowId}`);

  const handle = await client.workflow.start(discoveryIngestionWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [
      {
        channelId: CHANNEL_ID,
        minViewCount: 500,
        extractDna: true,
        ollamaModel: "gemma3:27b",
      },
    ],
  });

  console.log(`[trigger] Workflow running. Waiting for result...`);
  console.log(`[trigger] Temporal UI: http://localhost:8088/namespaces/default/workflows/${workflowId}`);

  const result = await handle.result();
  console.log(`\n[trigger] ✓ Discovery Mine complete:`);
  console.log(`  Ingested:  ${result.ingestedCount} videos`);
  console.log(`  Embedded:  ${result.embeddedCount} vectors`);

  if (result.dnaPrompt) {
    console.log(`\n─── Creative DNA Baseline (Gemma 4 Extract) ────────────────────\n`);
    console.log(result.dnaPrompt);
    console.log(`\n────────────────────────────────────────────────────────────────\n`);
  }

  await connection.close();
}

main().catch((err) => {
  console.error("[trigger] Fatal:", err);
  process.exit(1);
});
```

---

## scripts/mesh-waterfall-worker.ts
```
#!/usr/bin/env tsx
/**
 * Waterfall Temporal Worker — polls 'sarah-waterfall' task queue.
 * Handles ContentWaterfallWorkflow (4-format parallel generation).
 *
 * Run: npm run mesh:waterfall
 * Requires: Temporal server running (npm run mesh:up)
 */
import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "@/core/services/mesh/ContentWaterfallActivities";
import { getMeshEnv } from "@/lib/mesh/env";
import path from "node:path";

const TASK_QUEUE = "sarah-waterfall";

async function main() {
  const env = getMeshEnv();
  console.log(`[waterfall-worker] Connecting to ${env.TEMPORAL_ADDRESS}`);

  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.resolve(__dirname, "../core/services/mesh/ContentWaterfallWorkflow"),
    activities,
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 2,
  });

  console.log(`[waterfall-worker] Ready on task queue: ${TASK_QUEUE}`);

  process.on("SIGTERM", () => { console.log("[waterfall-worker] Shutting down…"); worker.shutdown(); });
  process.on("SIGINT",  () => { console.log("[waterfall-worker] Shutting down…"); worker.shutdown(); });

  await worker.run();
}

main().catch((err) => { console.error("[waterfall-worker] Fatal:", err); process.exit(1); });
```

---

## app/(ops)/factory/page.tsx
```
/**
 * /ops/factory — Human-in-the-Loop Review Dashboard
 *
 * Lists all PENDING drafts from the ContentWaterfall.
 * Shows DNA Confidence Score for each draft.
 * One-click approve/reject pushes to DistributionQueue.
 */
import { prisma } from "@/lib/db";
import { getDna } from "@/lib/mesh/dnaStore";
import { approveDraft, rejectDraft } from "./actions";

const PLATFORM_LABELS: Record<string, { label: string; color: string; emoji: string }> = {
  LINKEDIN:       { label: "LinkedIn",   color: "bg-blue-500/20 text-blue-300 border-blue-500/30",    emoji: "💼" },
  X_THREAD:       { label: "X Thread",   color: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",    emoji: "𝕏" },
  NEWSLETTER:     { label: "Newsletter", color: "bg-amber-500/20 text-amber-300 border-amber-500/30", emoji: "📰" },
  EMAIL_SEQUENCE: { label: "Email",      color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", emoji: "✉️" },
};

function DnaBar({ score }: { score: number | null }) {
  const pct = Math.round((score ?? 0) * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-zinc-700">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-400">{pct}%</span>
    </div>
  );
}

export default async function FactoryPage() {
  type DraftWithItem = {
    id: string; contentItemId: string; workflowId: string | null; platform: string;
    draftText: string; dnaConfidence: number | null; status: string;
    auditNotes: string | null; approvedAt: Date | null; createdAt: Date; updatedAt: Date;
    contentItem: { title: string; viewCount: number | null; sourcePlatform: string };
  };
  let drafts: DraftWithItem[] = [];
  let dna: Awaited<ReturnType<typeof getDna>> = null;
  let dbError: string | null = null;

  try {
    [drafts, dna] = await Promise.all([
      prisma.meshContentDraft.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { contentItem: { select: { title: true, viewCount: true, sourcePlatform: true } } },
      }) as Promise<DraftWithItem[]>,
      getDna(),
    ]);
  } catch (e) {
    dbError = e instanceof Error ? e.message : "Database unreachable";
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Sovereign Content Factory</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Review AI-generated drafts before they enter the Distribution Queue.
          </p>
        </div>

        {/* DNA Status */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Creative DNA Baseline</span>
            {dna ? (
              <span className="text-xs text-emerald-400">● Active — extracted {new Date(dna.extractedAt).toLocaleDateString()}</span>
            ) : (
              <span className="text-xs text-amber-400">● Not yet extracted — run mesh:discover</span>
            )}
          </div>
          {dna && (
            <p className="text-sm text-zinc-300 leading-relaxed line-clamp-3">{dna.dnaPrompt}</p>
          )}
        </div>

        {/* DB Error State */}
        {dbError && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
            <strong>Database unreachable:</strong> {dbError}
            <br />
            <span className="text-zinc-500">Start the DB with <code className="text-zinc-300">limactl start architect</code> then reload.</span>
          </div>
        )}

        {/* Stats Row */}
        {!dbError && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(["LINKEDIN", "X_THREAD", "NEWSLETTER", "EMAIL_SEQUENCE"] as const).map((p) => {
              const meta = PLATFORM_LABELS[p]!;
              const count = drafts.filter((d) => d.platform === p).length;
              return (
                <div key={p} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <div className="text-lg">{meta.emoji}</div>
                  <div className="text-xl font-bold mt-1">{count}</div>
                  <div className="text-xs text-zinc-500">{meta.label} pending</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Draft Cards */}
        {!dbError && drafts.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-500">
            No pending drafts. Run <code className="text-zinc-300">npm run mesh:discover</code> to generate gold, then trigger a waterfall.
          </div>
        )}

        {!dbError && drafts.length > 0 && (
          <div className="space-y-4">
            {drafts.map((draft) => {
              const meta = PLATFORM_LABELS[draft.platform] ?? { label: draft.platform, color: "bg-zinc-800 text-zinc-300 border-zinc-700", emoji: "📄" };
              return (
                <div key={draft.id} className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                  {/* Card Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${meta.color}`}>
                        {meta.emoji} {meta.label}
                      </span>
                      <span className="text-sm text-zinc-300 font-medium truncate max-w-xs">
                        {draft.contentItem.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="hidden sm:block">
                        <div className="text-xs text-zinc-500 mb-0.5">DNA Match</div>
                        <DnaBar score={draft.dnaConfidence} />
                      </div>
                      <div className="flex gap-2">
                        <form action={approveDraft.bind(null, draft.id)}>
                          <button
                            type="submit"
                            className="px-3 py-1 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
                          >
                            Approve
                          </button>
                        </form>
                        <form action={rejectDraft.bind(null, draft.id)}>
                          <button
                            type="submit"
                            className="px-3 py-1 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-medium transition-colors"
                          >
                            Reject
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>

                  {/* Draft Text Preview */}
                  <div className="px-4 py-3">
                    <pre className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans line-clamp-6">
                      {draft.draftText}
                    </pre>
                  </div>

                  {/* Audit Notes */}
                  {draft.auditNotes && (
                    <div className="px-4 py-2 bg-zinc-800/50 border-t border-zinc-800">
                      <span className="text-xs text-zinc-500">Audit: </span>
                      <span className="text-xs text-zinc-400">{draft.auditNotes}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## app/(ops)/factory/actions.ts
```
"use server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function approveDraft(draftId: string) {
  await prisma.meshContentDraft.update({
    where: { id: draftId },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  revalidatePath("/ops/factory");
}

export async function rejectDraft(draftId: string) {
  await prisma.meshContentDraft.update({
    where: { id: draftId },
    data: { status: "REJECTED" },
  });
  revalidatePath("/ops/factory");
}
```

---

## app/api/mcp/route.ts
```
/**
 * MCP Server Hub — JSON-RPC 2.0 over HTTP POST /api/mcp
 *
 * Implements the Model Context Protocol (MCP) spec without requiring the
 * @modelcontextprotocol/sdk package. Any MCP-compatible LLM client
 * (Gemma, Claude, GPT-4o) can discover and invoke these tools.
 *
 * Tools:
 *   Core data tools:
 *     mesh/list_content      → recent MeshContentItem rows
 *     mesh/get_content       → single item by id
 *     mesh/list_events       → recent outbox events
 *     mesh/service_health    → all MeshServiceIdentity heartbeats
 *     mesh/list_evaluations  → AI verdicts for a content item
 *
 *   Intelligence tools (new):
 *     mesh/search_gold       → pgvector semantic similarity search
 *     mesh/get_dna           → retrieve the current Creative DNA baseline
 *     mesh/trigger_ingest    → trigger a sensor sweep for new videos
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { searchGold } from "@/lib/mesh/vectorSearch";
import { getDna } from "@/lib/mesh/dnaStore";
import { UniversalContentIngestService } from "@/core/services/UniversalContentIngestService";
import { youtubeApiListSchema } from "@/lib/mesh/youtubeSchema";

// ── JSON-RPC 2.0 types ────────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}
interface JsonRpcSuccess { jsonrpc: "2.0"; id: string | number; result: unknown; }
interface JsonRpcError { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown }; }

function ok(id: string | number, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}
function err(id: string | number | null, code: number, message: string): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ── MCP manifest ──────────────────────────────────────────────────────────────
const MCP_MANIFEST = {
  name: "sovereign-mesh-hub",
  version: "2.0.0",
  description: "SARAH-MESH-V1 Intelligence Hub — Memory (pgvector) + Voice (Gemma DNA) + Sensors (YouTube)",
  tools: [
    {
      name: "mesh/list_content",
      description: "List recent ingested content items, ordered by discoveredAt desc.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max rows (1-100, default 20)" },
          platform: { type: "string", description: "Filter by sourcePlatform (e.g. YOUTUBE)" },
        },
      },
    },
    {
      name: "mesh/get_content",
      description: "Retrieve a single MeshContentItem by its id.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    {
      name: "mesh/list_events",
      description: "List recent outbox events, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["PENDING", "PUBLISHED", "FAILED"] },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "mesh/service_health",
      description: "Return all registered mesh service identities and their last heartbeat.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mesh/list_evaluations",
      description: "List AI evaluations for a given content item.",
      inputSchema: {
        type: "object",
        required: ["contentItemId"],
        properties: { contentItemId: { type: "string" } },
      },
    },
    {
      name: "mesh/search_gold",
      description: "Semantic similarity search across the pgvector store. Returns the most relevant content items for a given natural-language query.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Natural language query (e.g. 'psychology of decision making')" },
          limit: { type: "number", description: "Number of results (1-20, default 5)" },
        },
      },
    },
    {
      name: "mesh/get_dna",
      description: "Retrieve the current Creative DNA baseline — the Gemma 4 extracted system-prompt that captures the authentic voice and creative patterns from proven content.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mesh/trigger_ingest",
      description: "Trigger a sensor sweep for new videos from the sovereign YouTube channel. Runs ingestion synchronously and returns counts.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Override channel ID (defaults to UCipXVNRvJIBoZt7O_aPIgzg)" },
          minViewCount: { type: "number", description: "Minimum view count filter (default 500)" },
        },
      },
    },
  ],
};

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleListContent(params: Record<string, unknown>) {
  const limit = Math.min(Number(params.limit ?? 20), 100);
  const where = params.platform ? { sourcePlatform: String(params.platform) } : undefined;
  return prisma.meshContentItem.findMany({
    where,
    orderBy: { discoveredAt: "desc" },
    take: limit,
    select: {
      id: true, sourcePlatform: true, externalId: true, title: true,
      viewCount: true, publishedAt: true, discoveredAt: true, schemaVersion: true,
    },
  });
}

async function handleGetContent(params: Record<string, unknown>) {
  if (!params.id) throw new Error("id is required");
  return prisma.meshContentItem.findUniqueOrThrow({ where: { id: String(params.id) } });
}

async function handleListEvents(params: Record<string, unknown>) {
  const limit = Math.min(Number(params.limit ?? 20), 100);
  const statusAllowed = ["PENDING", "PUBLISHED", "FAILED"] as const;
  type EventStatus = (typeof statusAllowed)[number];
  const rawStatus = String(params.status ?? "");
  const where = statusAllowed.includes(rawStatus as EventStatus)
    ? { status: rawStatus as EventStatus }
    : undefined;
  return prisma.meshEventOutbox.findMany({
    where,
    orderBy: { availableAt: "desc" },
    take: limit,
    select: {
      id: true, eventType: true, aggregateId: true, status: true,
      availableAt: true, publishedAt: true, producer: true,
    },
  });
}

async function handleServiceHealth() {
  return prisma.meshServiceIdentity.findMany({ orderBy: { lastHeartbeatAt: "desc" } });
}

async function handleListEvaluations(params: Record<string, unknown>) {
  if (!params.contentItemId) throw new Error("contentItemId is required");
  return prisma.meshContentEvaluation.findMany({
    where: { contentItemId: String(params.contentItemId) },
    orderBy: { createdAt: "desc" },
  });
}

// ── Intelligence tools ────────────────────────────────────────────────────────

async function handleSearchGold(params: Record<string, unknown>) {
  if (!params.query) throw new Error("query is required");
  const limit = Math.min(Number(params.limit ?? 5), 20);
  return searchGold(String(params.query), limit);
}

async function handleGetDna() {
  const dna = await getDna();
  if (!dna) {
    return {
      status: "not_yet_extracted",
      message: "No Creative DNA has been extracted yet. Run mesh:discover or mesh/trigger_ingest first.",
    };
  }
  return dna;
}

async function handleTriggerIngest(params: Record<string, unknown>) {
  const channelId = String(params.channelId ?? "UCipXVNRvJIBoZt7O_aPIgzg");
  const minViewCount = Number(params.minViewCount ?? 500);
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set on the server");

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("channelId", channelId);
  searchUrl.searchParams.set("maxResults", "25");
  searchUrl.searchParams.set("order", "viewCount");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("key", apiKey);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) throw new Error(`YouTube search ${searchRes.status}`);
  const searchJson = (await searchRes.json()) as { items?: Array<{ id?: { videoId?: string } }> };
  const videoIds = (searchJson.items ?? []).map((i) => i.id?.videoId).filter(Boolean) as string[];
  if (videoIds.length === 0) return { ingestedCount: 0, message: "No videos found." };

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "snippet,statistics,contentDetails");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);
  const videosRes = await fetch(videosUrl.toString());
  if (!videosRes.ok) throw new Error(`YouTube videos ${videosRes.status}`);

  const list = youtubeApiListSchema.parse(await videosRes.json());
  const service = new UniversalContentIngestService();
  let ingestedCount = 0;

  for (const item of list.items) {
    const viewCount = parseInt(item.statistics?.viewCount ?? "0", 10);
    if (viewCount < minViewCount) continue;
    await service.ingest({
      schemaVersion: "universal-content.v1",
      sourcePlatform: "YOUTUBE",
      externalId: item.id,
      sourceChannelId: channelId,
      canonicalUrl: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.snippet.title,
      description: item.snippet.description,
      contentText: [item.snippet.title, item.snippet.description].filter(Boolean).join("\n\n"),
      viewCount,
      publishedAt: item.snippet.publishedAt,
      discoveredAt: new Date().toISOString(),
      rawPayload: item as unknown as Record<string, unknown>,
    });
    ingestedCount++;
  }

  return { ingestedCount, channelId, minViewCount, message: `Ingested ${ingestedCount} videos.` };
}

// ── Router ────────────────────────────────────────────────────────────────────
async function dispatch(req: JsonRpcRequest): Promise<JsonRpcSuccess | JsonRpcError> {
  const { id, method, params = {} } = req;
  try {
    switch (method) {
      case "mcp/manifest":         return ok(id, MCP_MANIFEST);
      case "mesh/list_content":    return ok(id, await handleListContent(params));
      case "mesh/get_content":     return ok(id, await handleGetContent(params));
      case "mesh/list_events":     return ok(id, await handleListEvents(params));
      case "mesh/service_health":  return ok(id, await handleServiceHealth());
      case "mesh/list_evaluations":return ok(id, await handleListEvaluations(params));
      case "mesh/search_gold":     return ok(id, await handleSearchGold(params));
      case "mesh/get_dna":         return ok(id, await handleGetDna());
      case "mesh/trigger_ingest":  return ok(id, await handleTriggerIngest(params));
      default: return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return err(id, -32603, msg);
  }
}

// ── Next.js route handlers ────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json(err(null, -32700, "Parse error"), { status: 400 }); }

  const rpc = body as JsonRpcRequest;
  if (rpc.jsonrpc !== "2.0" || !rpc.method) {
    return NextResponse.json(err(rpc.id ?? null, -32600, "Invalid Request"), { status: 400 });
  }

  const result = await dispatch(rpc);
  return NextResponse.json(result);
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(MCP_MANIFEST);
}
```

---

## app/api/mesh/drafts/route.ts
```
/**
 * REST API for MeshContentDrafts — used by the factory UI and external tools.
 *
 * GET  /api/mesh/drafts?status=PENDING&platform=LINKEDIN&limit=20
 * POST /api/mesh/drafts/:id/approve   (body: { id })
 * POST /api/mesh/drafts/:id/reject    (body: { id })
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const platform = searchParams.get("platform");
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

  const statusAllowed = ["PENDING", "APPROVED", "REJECTED", "PUBLISHED"] as const;
  type DraftStatus = (typeof statusAllowed)[number];

  try {
    const where: Record<string, unknown> = {};
    if (status && statusAllowed.includes(status as DraftStatus)) {
      where.status = status;
    }
    if (platform) where.platform = platform;

    const drafts = await prisma.meshContentDraft.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        contentItem: {
          select: { title: true, viewCount: true, sourcePlatform: true, canonicalUrl: true },
        },
      },
    });

    return NextResponse.json({ drafts, total: drafts.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "DB error" },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { id, action } = (await request.json()) as { id: string; action: "approve" | "reject" };

  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "id and action (approve|reject) required" }, { status: 400 });
  }

  try {
    const updated = await prisma.meshContentDraft.update({
      where: { id },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        approvedAt: action === "approve" ? new Date() : null,
      },
    });
    return NextResponse.json({ draft: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 },
    );
  }
}
```

---

## core/architecture/meshBoundaries.test.ts
```
/**
 * Architecture Fitness Functions — Sovereign Mesh Boundaries
 *
 * Enforces:
 *  1. Schema Integrity — universal content contract + event envelope are present.
 *  2. Outbox Pattern  — eventStore uses the outbox table, not direct topic publish.
 *  3. Hexagonal Isolation — core/services must NOT import from app/, pages/, or
 *     components/ (Strangler Fig guard).
 *  4. Mesh-to-Legacy Firewall — lib/mesh/* must NOT import from legacy
 *     SqueezePages, app/(SqueezePages), or intelligence-unit.
 *  5. Raw-pg Outbox Relay — the relay must use node-postgres, NOT Prisma, for
 *     the critical write path (zero-overhead guarantee).
 *  6. Kafka Client Singleton — kafkaClient must export getMeshProducer and
 *     publishToKafka.
 *  7. MCP Server Hub — the route must implement the mcp/manifest method.
 *  8. Workflow Contract — IngestionWorkflow must define discoveryIngestionWorkflow.
 *  9. Embedding Worker — must call /api/embeddings (Ollama Metal path).
 * 10. Docker Compose Mesh Profile — Kafka and Temporal services must be present
 *     under the "mesh" profile.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function importsInFile(rel: string): string[] {
  const content = read(rel);
  const matches = [...content.matchAll(/from\s+["']([^"']+)["']/g)];
  return matches.map((m) => m[1]);
}

function allTsFilesIn(dir: string): string[] {
  const abs = path.join(root, dir);
  const out: string[] = [];
  try {
    for (const entry of readdirSync(abs, { recursive: true } as Parameters<typeof readdirSync>[1])) {
      const name = String(entry);
      if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        out.push(path.join(dir, name));
      }
    }
  } catch { /* dir may not exist yet */ }
  return out;
}

// ── 1. Schema Integrity ───────────────────────────────────────────────────────
describe("1. Schema Integrity", () => {
  it("universal-content.v1 contract is defined", () => {
    const f = read("lib/mesh/universalContentSchema.ts");
    expect(f).toContain("universal-content.v1");
    expect(f).toContain("mesh-event.v1");
    expect(f).toContain("universalContentSchema");
    expect(f).toContain("meshEventEnvelopeSchema");
  });
});

// ── 2. Outbox Pattern ────────────────────────────────────────────────────────
describe("2. Outbox Pattern", () => {
  it("eventStore writes to MeshEventOutbox inside a transaction", () => {
    const f = read("lib/mesh/eventStore.ts");
    expect(f).toContain("meshEventOutbox");
    expect(f).toContain("saveUniversalContentWithOutbox");
    expect(f).toContain("$transaction");
  });

  it("eventStore does NOT publish directly to Kafka (only the relay does)", () => {
    const f = read("lib/mesh/eventStore.ts");
    expect(f).not.toContain("kafkaClient");
    expect(f).not.toContain("publishToKafka");
  });
});

// ── 3. Hexagonal Isolation (Strangler Fig guard) ──────────────────────────────
describe("3. Hexagonal Isolation — core/services has no UI imports", () => {
  const FORBIDDEN_PREFIXES = [
    "@/app/",
    "@/components/",
    "@/pages/",
    "../app/",
    "../components/",
    "../pages/",
  ];

  const coreFiles = allTsFilesIn("core/services");

  it("core service files exist", () => {
    expect(coreFiles.length).toBeGreaterThan(0);
  });

  for (const rel of coreFiles) {
    it(`${rel} has no UI layer imports`, () => {
      const imports = importsInFile(rel);
      for (const imp of imports) {
        for (const prefix of FORBIDDEN_PREFIXES) {
          expect(imp, `${rel} imports UI path: ${imp}`).not.toMatch(new RegExp(`^${prefix.replace(/\//g, "\\/")}`));
        }
      }
    });
  }
});

// ── 4. Mesh-to-Legacy Firewall ────────────────────────────────────────────────
describe("4. Mesh-to-Legacy Firewall — lib/mesh does not touch legacy paths", () => {
  const LEGACY_PATTERNS = [
    /SqueezePages/,
    /intelligence-unit/,
    /Consent_Collector/,
    /Squeeze_Form/,
  ];

  const meshFiles = allTsFilesIn("lib/mesh");

  it("mesh files exist", () => {
    expect(meshFiles.length).toBeGreaterThan(0);
  });

  for (const rel of meshFiles) {
    it(`${rel} does not import from legacy directories`, () => {
      const content = read(rel);
      for (const pattern of LEGACY_PATTERNS) {
        expect(content, `${rel} references legacy path matching ${pattern}`).not.toMatch(pattern);
      }
    });
  }
});

// ── 5. Raw-pg Outbox Relay ────────────────────────────────────────────────────
describe("5. Raw-pg Outbox Relay", () => {
  it("outboxRelay uses node-postgres Pool, not Prisma", () => {
    const f = read("lib/mesh/outboxRelay.ts");
    expect(f).toContain("from \"pg\"");
    expect(f).not.toContain("from \"@prisma/client\"");
    expect(f).not.toContain("prisma.");
  });

  it("outboxRelay uses SKIP LOCKED for at-least-once delivery", () => {
    const f = read("lib/mesh/outboxRelay.ts");
    expect(f).toContain("SKIP LOCKED");
  });
});

// ── 6. Kafka Client Singleton ────────────────────────────────────────────────
describe("6. Kafka Client Singleton", () => {
  it("exports getMeshProducer and publishToKafka", () => {
    const f = read("lib/mesh/kafkaClient.ts");
    expect(f).toContain("getMeshProducer");
    expect(f).toContain("publishToKafka");
  });
});

// ── 7. MCP Server Hub ────────────────────────────────────────────────────────
describe("7. MCP Server Hub", () => {
  it("implements mcp/manifest and core mesh/* tool methods", () => {
    const f = read("app/api/mcp/route.ts");
    expect(f).toContain("mcp/manifest");
    expect(f).toContain("mesh/list_content");
    expect(f).toContain("mesh/list_events");
    expect(f).toContain("jsonrpc");
  });

  it("exposes intelligence tools: search_gold, get_dna, trigger_ingest", () => {
    const f = read("app/api/mcp/route.ts");
    expect(f).toContain("mesh/search_gold");
    expect(f).toContain("mesh/get_dna");
    expect(f).toContain("mesh/trigger_ingest");
  });
});

// ── 8. Temporal Workflow Contract ─────────────────────────────────────────────
describe("8. Temporal Workflow Contract", () => {
  it("uses proxyActivities — proper Temporal V8 isolate pattern", () => {
    const f = read("core/services/mesh/IngestionWorkflow.ts");
    expect(f).toContain("proxyActivities");
    expect(f).toContain("@temporalio/workflow");
    expect(f).toContain("discoveryIngestionWorkflow");
  });

  it("activities are separated into IngestionActivities.ts (I/O boundary)", () => {
    const f = read("core/services/mesh/IngestionActivities.ts");
    expect(f).toContain("fetchYouTubeMetadata");
    expect(f).toContain("generateEmbeddings");
    expect(f).toContain("extractCreativeDna");
  });

  it("DNA extraction calls Ollama with high-entropy settings", () => {
    const f = read("core/services/mesh/IngestionActivities.ts");
    expect(f).toContain("temperature: 0.85");
    expect(f).toContain("top_p: 0.95");
    expect(f).toContain("/api/generate");
  });

  it("Gemma judge adapter replaces bootstrap rule engine", () => {
    const f = read("adapters/intelligence/OllamaGemmaJudgeAdapter.ts");
    expect(f).toContain("OllamaGemmaJudgeAdapter");
    expect(f).toContain("/api/generate");
    expect(f).toContain("gemma3:27b");
  });

  it("DNA store persists and retrieves creative DNA baseline", () => {
    const f = read("lib/mesh/dnaStore.ts");
    expect(f).toContain("saveDna");
    expect(f).toContain("getDna");
    expect(f).toContain("sarah.creative.dna");
  });
});

// ── 9. Embedding Worker ───────────────────────────────────────────────────────
describe("9. Embedding Worker (Metal path)", () => {
  it("calls /api/embeddings and writes vector column", () => {
    const f = read("lib/mesh/embeddingWorker.ts");
    expect(f).toContain("/api/embeddings");
    expect(f).toContain("::vector");
    expect(f).toContain("embedding IS NULL");
  });
});

// ── 11. Distribution Grid — Phase 4 ─────────────────────────────────────────
describe("11. Distribution Adapter Port (Hexagonal boundary)", () => {
  it("defines DistributionAdapterPort interface with platform + generate()", () => {
    const f = read("core/ports/DistributionAdapterPort.ts");
    expect(f).toContain("DistributionAdapterPort");
    expect(f).toContain("generate(");
    expect(f).toContain("DistributionPlatform");
    expect(f).toContain("dnaConfidence");
  });
});

describe("12. PersonaEngineService (Sarah Filter)", () => {
  it("builds Sarah Filter from live DNA, not hardcoded persona", () => {
    const f = read("core/services/mesh/PersonaEngineService.ts");
    expect(f).toContain("getDna");
    expect(f).toContain("buildSarahFilter");
    expect(f).toContain("ABSOLUTE RULES");
  });

  it("has per-platform format constraints (not one-size-fits-all)", () => {
    const f = read("core/services/mesh/PersonaEngineService.ts");
    expect(f).toContain("LINKEDIN");
    expect(f).toContain("X_THREAD");
    expect(f).toContain("NEWSLETTER");
    expect(f).toContain("EMAIL_SEQUENCE");
  });
});

describe("13. Distribution Adapters — all 4 platforms implemented", () => {
  const adapters = [
    ["adapters/distribution/LinkedInPostAdapter.ts", "LinkedInPostAdapter", "LINKEDIN"],
    ["adapters/distribution/XThreadAdapter.ts", "XThreadAdapter", "X_THREAD"],
    ["adapters/distribution/NewsletterArticleAdapter.ts", "NewsletterArticleAdapter", "NEWSLETTER"],
    ["adapters/distribution/EmailSequenceAdapter.ts", "EmailSequenceAdapter", "EMAIL_SEQUENCE"],
  ] as const;

  for (const [path, className, platform] of adapters) {
    it(`${className} implements DistributionAdapterPort for ${platform}`, () => {
      const f = read(path);
      expect(f).toContain(className);
      expect(f).toContain(`"${platform}"`);
      expect(f).toContain("generate(");
      expect(f).toContain("/api/generate");
      expect(f).toContain("dnaConfidence");
    });
  }
});

describe("14. ContentWaterfallWorkflow — Temporal V8 isolate compliance", () => {
  it("uses proxyActivities — no direct I/O in workflow file", () => {
    const f = read("core/services/mesh/ContentWaterfallWorkflow.ts");
    expect(f).toContain("proxyActivities");
    expect(f).toContain("@temporalio/workflow");
    expect(f).not.toContain("prisma.");
    expect(f).not.toContain("fetch(");
  });

  it("runs 4 platform generations in parallel with Promise.all", () => {
    const f = read("core/services/mesh/ContentWaterfallWorkflow.ts");
    expect(f).toContain("Promise.all");
    expect(f).toContain("PLATFORMS.map");
  });
});

describe("15. ContentWaterfallActivities — I/O boundary separation", () => {
  it("parkDrafts uses upsert for idempotency (crash-safe)", () => {
    const f = read("core/services/mesh/ContentWaterfallActivities.ts");
    expect(f).toContain("parkDrafts");
    expect(f).toContain("upsert");
    expect(f).toContain("meshContentDraft");
  });

  it("analyzeGold calls Gemma 4 for traction analysis", () => {
    const f = read("core/services/mesh/ContentWaterfallActivities.ts");
    expect(f).toContain("analyzeGold");
    expect(f).toContain("auditDrafts");
    expect(f).toContain("gemma3:27b");
  });
});

describe("16. MeshContentDraft schema — persistence layer", () => {
  it("schema defines MeshContentDraft with dnaConfidence and MeshDraftStatus", () => {
    const f = read("prisma/schema.prisma");
    expect(f).toContain("MeshContentDraft");
    expect(f).toContain("MeshDraftStatus");
    expect(f).toContain("dnaConfidence");
    expect(f).toContain("PENDING");
    expect(f).toContain("APPROVED");
  });

  it("draft table has unique constraint for idempotent upserts", () => {
    const f = read("prisma/schema.prisma");
    expect(f).toContain("contentItemId, platform, workflowId");
  });
});

describe("17. /ops/factory UI (Human-in-the-Loop)", () => {
  it("factory page renders DNA baseline and draft approval controls", () => {
    const f = read("app/(ops)/factory/page.tsx");
    expect(f).toContain("getDna");
    expect(f).toContain("approveDraft");
    expect(f).toContain("rejectDraft");
    expect(f).toContain("dnaConfidence");
  });

  it("actions are Server Actions — no client-side secrets", () => {
    const f = read("app/(ops)/factory/actions.ts");
    expect(f).toContain('"use server"');
    expect(f).toContain("approveDraft");
    expect(f).toContain("rejectDraft");
  });
});

describe("18. Distribution adapters — no legacy imports (Strangler Fig)", () => {
  const distFiles = allTsFilesIn("adapters/distribution");

  it("distribution adapter files exist", () => {
    expect(distFiles.length).toBeGreaterThan(0);
  });

  for (const rel of distFiles) {
    it(`${rel} does not import from legacy SqueezePages or UI layer`, () => {
      const content = read(rel);
      expect(content).not.toMatch(/SqueezePages/);
      expect(content).not.toMatch(/Consent_Collector/);
      expect(content).not.toMatch(/@\/app\//);
    });
  }
});

describe("19. PerformanceSyncService — feedback loop stub", () => {
  it("stub exists with scoreAgainstGold and runFeedbackLoop", () => {
    const f = read("core/services/mesh/PerformanceSyncService.ts");
    expect(f).toContain("PerformanceSyncService");
    expect(f).toContain("scoreAgainstGold");
    expect(f).toContain("runFeedbackLoop");
    expect(f).toContain("TODO Phase 5");
  });
});

describe("20. /api/mesh/drafts REST endpoint", () => {
  it("exposes GET + POST for draft management", () => {
    const f = read("app/api/mesh/drafts/route.ts");
    expect(f).toContain("export async function GET");
    expect(f).toContain("export async function POST");
    expect(f).toContain("meshContentDraft");
  });
});

// ── 10. Docker Compose Mesh Profile ──────────────────────────────────────────
describe("10. Docker Compose Mesh Profile", () => {
  it("Kafka service exists under mesh profile", () => {
    const f = read("docker-compose.monster.yml");
    expect(f).toContain("mesh_kafka");
    expect(f).toContain("bitnami/kafka");
    expect(f).toContain("KAFKA_CFG_PROCESS_ROLES=broker,controller");
  });

  it("Temporal server + UI exist under mesh profile", () => {
    const f = read("docker-compose.monster.yml");
    expect(f).toContain("mesh_temporal");
    expect(f).toContain("temporalio/auto-setup");
    expect(f).toContain("mesh_temporal_ui");
  });

  it("mesh_grid network is declared", () => {
    const f = read("docker-compose.monster.yml");
    expect(f).toContain("mesh_grid:");
  });
});
```

---

## prisma/schema.prisma
```
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ContactStatus {
  PENDING_CONFIRMATION
  SUBSCRIBED
  UNSUBSCRIBED
  SUPPRESSED
  ERASED
}

enum SuppressionReason {
  USER_UNSUBSCRIBED
  SPAM_COMPLAINT
  HARD_BOUNCE
  MANUAL_BLOCK
  ERASURE_NO_RECONTACT
}

enum RightsRequestType {
  ACCESS
  ERASURE
  OBJECTION_MARKETING
  RECTIFICATION
}

enum RightsRequestStatus {
  RECEIVED
  VERIFYING_IDENTITY
  IN_PROGRESS
  COMPLETED
  REJECTED
}

model Contact {
  id                String         @id @default(uuid())
  emailNormalized    String?        @unique @map("email_normalized")
  emailHash         String         @unique @map("email_hash")
  status            ContactStatus  @default(PENDING_CONFIRMATION)
  providerContactId String?        @map("provider_contact_id")
  
  consentVersionId  String?        @map("consent_version_id")
  consentVersion    ConsentVersion? @relation(fields: [consentVersionId], references: [id])
  
  formVersionId     String?        @map("form_version_id")
  formVersion       FormVersion?   @relation(fields: [formVersionId], references: [id])
  
  source            String?
  signupIp          String?        @map("signup_ip")
  signupUserAgent   String?        @map("signup_user_agent")
  
  submittedAt       DateTime?      @map("submitted_at") @db.Timestamptz(3)
  confirmedAt       DateTime?      @map("confirmed_at") @db.Timestamptz(3)
  unsubscribedAt    DateTime?      @map("unsubscribed_at") @db.Timestamptz(3)
  confirmationToken String?        @unique @map("confirmation_token") @db.VarChar(128)
  erasedAt          DateTime?      @map("erased_at") @db.Timestamptz(3)
  
  createdAt         DateTime       @default(now()) @map("created_at")
  updatedAt         DateTime       @updatedAt @map("updated_at")

  auditLogs         AuditLog[]
  rightsRequests    RightsRequest[]

  @@index([emailHash])
  @@index([status])
  @@index([createdAt])
}

model ConsentVersion {
  id                String    @id @default(uuid())
  versionCode       String    @unique @map("version_code")
  consentText       String    @map("consent_text") @db.Text
  privacyPolicyUrl  String    @map("privacy_policy_url")
  privacyPolicyVersion String @map("privacy_policy_version")
  activeFrom        DateTime  @map("active_from") @db.Timestamptz(3)
  activeTo          DateTime? @map("active_to") @db.Timestamptz(3)
  createdAt         DateTime  @default(now()) @map("created_at")
  
  contacts          Contact[]
}

model FormVersion {
  id                String    @id @default(uuid())
  versionCode       String    @unique @map("version_code")
  pageUrl           String    @map("page_url")
  htmlSnapshotPath  String?   @map("html_snapshot_path")
  notes             String?   @db.Text
  activeFrom        DateTime  @map("active_from") @db.Timestamptz(3)
  activeTo          DateTime? @map("active_to") @db.Timestamptz(3)
  createdAt         DateTime  @default(now()) @map("created_at")
  
  contacts          Contact[]
}

model ProviderEvent {
  id                String    @id @default(uuid())
  provider          String
  providerEventId   String?   @unique @map("provider_event_id")
  eventType         String    @map("event_type")
  payloadJson       Json      @map("payload_json") @db.JsonB
  signatureValid    Boolean   @map("signature_valid")
  receivedAt        DateTime  @default(now()) @map("received_at") @db.Timestamptz(3)
  processedAt       DateTime? @map("processed_at") @db.Timestamptz(3)
  processingResult  String?   @map("processing_result") @db.Text

  @@index([provider, eventType])
  @@index([receivedAt])
}

model AuditLog {
  id            String    @id @default(uuid())
  contactId     String?   @map("contact_id")
  contact       Contact?  @relation(fields: [contactId], references: [id])
  emailHash     String?   @map("email_hash")
  eventType     String    @map("event_type")
  eventSource   String    @map("event_source")
  requestId     String?   @map("request_id")
  metadata      Json?     @db.JsonB
  occurredAt    DateTime  @default(now()) @map("occurred_at") @db.Timestamptz(3)

  @@index([emailHash])
  @@index([occurredAt])
}

model RightsRequest {
  id                String             @id @default(uuid())
  contactId         String?            @map("contact_id")
  contact           Contact?           @relation(fields: [contactId], references: [id])
  emailNormalized    String?            @map("email_normalized")
  requestType       RightsRequestType  @map("request_type")
  status            RightsRequestStatus @default(RECEIVED)
  requestedAt       DateTime           @default(now()) @map("requested_at") @db.Timestamptz(3)
  completedAt       DateTime?          @map("completed_at") @db.Timestamptz(3)
  notes             String?            @db.Text

  @@index([contactId])
  @@index([requestedAt])
}

model Suppression {
  id                String            @id @default(uuid())
  emailNormalized    String?           @map("email_normalized")
  emailHash         String            @unique @map("email_hash")
  reason            SuppressionReason
  source            String?
  createdAt         DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)
}

model SqueezePageAnalytics {
  id          String   @id @default(cuid())
  pageSlug    String   @unique
  views       Int      @default(0)
  conversions Int      @default(0)
  lastEntryAt DateTime @default(now())
}

// ----------------------------
// Intelligence Machine Foundation
// ----------------------------

enum PlatformEnum {
  TIKTOK
  YOUTUBE
  PERPLEXITY
  GOOGLE
  REDDIT
  INSTAGRAM
  FACEBOOK
  X
}

enum MeshEventStatus {
  PENDING
  PROCESSING
  PUBLISHED
  FAILED
}

model Observation_Signal {
  @@map("intelligence_layer_observation_signal")
  @@index([platform])
  @@index([ecosystem_id])

  id                 BigInt            @id @default(autoincrement())
  persona_id         Int
  platform           PlatformEnum
  content_transcript String           @db.Text
  metadata           Json             @db.JsonB
  vibe_coordinates   Unsupported("vector(1536)")?
  ecosystem_id       String?
  ecosystem          Ecosystem?       @relation(fields: [ecosystem_id], references: [id], onDelete: SetNull)
}

model Agent_Soul {
  @@map("intelligence_layer_agent_soul")

  id             Int     @id @default(autoincrement())
  name           String
  psych_profile Json    @db.JsonB
  is_active      Boolean @default(true)
}

model Ecosystem {
  @@map("intelligence_layer_ecosystem")
  @@index([funnel_dna], type: Gin)
  @@index([intelligence_log], type: Gin)
  @@index([platform, is_dream_200])

  id               String               @id @default(uuid())
  handle           String               @unique
  platform         PlatformEnum
  url              String
  follower_count   Int?
  funnel_dna       Json?                @db.JsonB
  signals          Observation_Signal[]
  is_dream_200     Boolean              @default(false)
  intelligence_log Json?                @db.JsonB
  last_scouted_at  DateTime?            @db.Timestamptz(3)
}

model Swarm_Agent {
  @@map("intelligence_layer_swarm_agent")
  @@index([agent_soul_id])

  id           String  @id @default(uuid())
  persona_name String
  agent_soul_id String
  email        String? @unique
  proxy_config Json?   @db.JsonB
  interactions Int     @default(0)
}

enum MeshDraftStatus {
  PENDING
  APPROVED
  REJECTED
  PUBLISHED
}

model MeshContentDraft {
  @@map("mesh_content_draft")
  @@unique([contentItemId, platform, workflowId])
  @@index([contentItemId, createdAt])
  @@index([platform, status])

  id              String          @id @default(uuid())
  contentItemId   String          @map("content_item_id")
  contentItem     MeshContentItem @relation(fields: [contentItemId], references: [id], onDelete: Cascade)
  workflowId      String?         @map("workflow_id")
  platform        String
  draftText       String          @map("draft_text") @db.Text
  dnaConfidence   Float?          @map("dna_confidence")
  status          MeshDraftStatus @default(PENDING)
  auditNotes      String?         @map("audit_notes") @db.Text
  approvedAt      DateTime?       @map("approved_at") @db.Timestamptz(3)
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")
}

model MeshContentItem {
  @@map("mesh_content_item")
  @@unique([sourcePlatform, externalId])
  @@index([sourcePlatform, publishedAt])
  @@index([sourceChannelId])

  id              String                  @id @default(uuid())
  sourcePlatform  String                  @map("source_platform")
  externalId      String                  @map("external_id")
  sourceChannelId String?                 @map("source_channel_id")
  canonicalUrl    String                  @map("canonical_url")
  title           String
  description     String?                 @db.Text
  contentText     String                  @map("content_text") @db.Text
  transcriptText  String?                 @map("transcript_text") @db.Text
  languageCode    String?                 @map("language_code")
  schemaVersion   String                  @default("universal-content.v1") @map("schema_version")
  viewCount       Int?                    @map("view_count")
  likeCount       Int?                    @map("like_count")
  commentCount    Int?                    @map("comment_count")
  publishedAt     DateTime?               @map("published_at") @db.Timestamptz(3)
  discoveredAt    DateTime                @default(now()) @map("discovered_at") @db.Timestamptz(3)
  rawPayload      Json                    @map("raw_payload") @db.JsonB
  embedding       Unsupported("vector(1536)")?
  createdAt       DateTime                @default(now()) @map("created_at")
  updatedAt       DateTime                @updatedAt @map("updated_at")
  evaluations     MeshContentEvaluation[]
  drafts          MeshContentDraft[]
}

model MeshEventOutbox {
  @@map("mesh_event_outbox")
  @@index([status, availableAt])
  @@index([aggregateType, aggregateId])
  @@index([eventType, createdAt])

  id            String          @id @default(uuid())
  aggregateType String          @map("aggregate_type")
  aggregateId   String          @map("aggregate_id")
  eventType     String          @map("event_type")
  eventKey      String          @unique @map("event_key")
  eventVersion  Int             @default(1) @map("event_version")
  producer      String
  status        MeshEventStatus @default(PENDING)
  payloadJson   Json            @map("payload_json") @db.JsonB
  headersJson   Json?           @map("headers_json") @db.JsonB
  attempts      Int             @default(0)
  availableAt   DateTime        @default(now()) @map("available_at") @db.Timestamptz(3)
  publishedAt   DateTime?       @map("published_at") @db.Timestamptz(3)
  lastError     String?         @map("last_error") @db.Text
  createdAt     DateTime        @default(now()) @map("created_at")
}

model MeshContentEvaluation {
  @@map("mesh_content_evaluation")
  @@index([contentItemId, createdAt])
  @@index([verdict])

  id              String          @id @default(uuid())
  contentItemId   String          @map("content_item_id")
  contentItem     MeshContentItem @relation(fields: [contentItemId], references: [id], onDelete: Cascade)
  evaluatorKind   String          @map("evaluator_kind")
  modelName       String?         @map("model_name")
  verdict         String
  qualityScore    Float?          @map("quality_score")
  contrarianScore Float?          @map("contrarian_score")
  nuanceScore     Float?          @map("nuance_score")
  notes           String?         @db.Text
  payloadJson     Json?           @map("payload_json") @db.JsonB
  createdAt       DateTime        @default(now()) @map("created_at")
}

model MeshServiceIdentity {
  @@map("mesh_service_identity")

  id              String    @id @default(uuid())
  serviceName     String    @unique @map("service_name")
  serviceKind     String    @map("service_kind")
  version         String
  protocol        String
  metadataJson    Json?     @map("metadata_json") @db.JsonB
  lastHeartbeatAt DateTime? @map("last_heartbeat_at") @db.Timestamptz(3)
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
}
```

---

## prisma/migrations/20260402070000_mesh_event_foundation/migration.sql
```
-- Mesh event foundation: universal content store, immutable outbox, evaluation records, service identities.
-- This keeps Postgres as the operational event vault today and a CDC/Kafka handoff point later.

-- CreateEnum
CREATE TYPE "MeshEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "mesh_content_item" (
    "id" TEXT NOT NULL,
    "source_platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "source_channel_id" TEXT,
    "canonical_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content_text" TEXT NOT NULL,
    "transcript_text" TEXT,
    "language_code" TEXT,
    "schema_version" TEXT NOT NULL DEFAULT 'universal-content.v1',
    "view_count" INTEGER,
    "like_count" INTEGER,
    "comment_count" INTEGER,
    "published_at" TIMESTAMPTZ(3),
    "discovered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_payload" JSONB NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesh_content_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesh_event_outbox" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "producer" TEXT NOT NULL,
    "status" "MeshEventStatus" NOT NULL DEFAULT 'PENDING',
    "payload_json" JSONB NOT NULL,
    "headers_json" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mesh_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesh_content_evaluation" (
    "id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "evaluator_kind" TEXT NOT NULL,
    "model_name" TEXT,
    "verdict" TEXT NOT NULL,
    "quality_score" DOUBLE PRECISION,
    "contrarian_score" DOUBLE PRECISION,
    "nuance_score" DOUBLE PRECISION,
    "notes" TEXT,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mesh_content_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesh_service_identity" (
    "id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "service_kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "metadata_json" JSONB,
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesh_service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mesh_content_item_source_platform_external_id_key" ON "mesh_content_item"("source_platform", "external_id");

-- CreateIndex
CREATE INDEX "mesh_content_item_source_platform_published_at_idx" ON "mesh_content_item"("source_platform", "published_at");

-- CreateIndex
CREATE INDEX "mesh_content_item_source_channel_id_idx" ON "mesh_content_item"("source_channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "mesh_event_outbox_event_key_key" ON "mesh_event_outbox"("event_key");

-- CreateIndex
CREATE INDEX "mesh_event_outbox_status_available_at_idx" ON "mesh_event_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX "mesh_event_outbox_aggregate_type_aggregate_id_idx" ON "mesh_event_outbox"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "mesh_event_outbox_event_type_created_at_idx" ON "mesh_event_outbox"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "mesh_content_evaluation_content_item_id_created_at_idx" ON "mesh_content_evaluation"("content_item_id", "created_at");

-- CreateIndex
CREATE INDEX "mesh_content_evaluation_verdict_idx" ON "mesh_content_evaluation"("verdict");

-- CreateIndex
CREATE UNIQUE INDEX "mesh_service_identity_service_name_key" ON "mesh_service_identity"("service_name");

-- AddForeignKey
ALTER TABLE "mesh_content_evaluation" ADD CONSTRAINT "mesh_content_evaluation_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "mesh_content_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## prisma/migrations/20260403000000_mesh_content_drafts/migration.sql
```
-- Phase 4: Distribution Grid — content draft table for the Waterfall Factory.
-- Every AI-generated piece of content lives here before human approval.

-- CreateEnum
CREATE TYPE "MeshDraftStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "mesh_content_draft" (
    "id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "workflow_id" TEXT,
    "platform" TEXT NOT NULL,
    "draft_text" TEXT NOT NULL,
    "dna_confidence" DOUBLE PRECISION,
    "status" "MeshDraftStatus" NOT NULL DEFAULT 'PENDING',
    "audit_notes" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesh_content_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mesh_content_draft_content_item_id_created_at_idx" ON "mesh_content_draft"("content_item_id", "created_at");

-- CreateIndex
CREATE INDEX "mesh_content_draft_platform_status_idx" ON "mesh_content_draft"("platform", "status");

-- AddForeignKey
ALTER TABLE "mesh_content_draft" ADD CONSTRAINT "mesh_content_draft_content_item_id_fkey"
    FOREIGN KEY ("content_item_id") REFERENCES "mesh_content_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## docker-compose.yml
```
services:
  # ── Postgres 17 + pgvector ────────────────────────────────────────────────
  mesh_db:
    image: pgvector/pgvector:pg17
    container_name: mesh_db
    restart: always
    environment:
      - POSTGRES_DB=lead_engine
      - POSTGRES_USER=${DATABASE_USER:-postgres}
      - POSTGRES_PASSWORD=${DATABASE_PASSWORD:-changeme}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - mesh_db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - mesh_grid

  # ── Apache Kafka 3.7 — KRaft mode (no Zookeeper) ─────────────────────────
  # Scaling path: point KAFKA_BROKERS at the H100 cluster brokers — zero code changes.
  mesh_kafka:
    profiles: ["mesh"]
    image: bitnami/kafka:3.7
    container_name: mesh_kafka
    restart: unless-stopped
    environment:
      - KAFKA_CFG_NODE_ID=1
      - KAFKA_CFG_PROCESS_ROLES=broker,controller
      - KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=1@mesh_kafka:9093
      - KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093
      - KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://mesh_kafka:9092
      - KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
      - KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER
      - KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE=true
      - KAFKA_CFG_LOG_RETENTION_HOURS=168
    ports:
      - "127.0.0.1:19092:9092"
    volumes:
      - mesh_kafka_data:/bitnami/kafka
    mem_limit: 512m
    networks:
      - mesh_grid
    healthcheck:
      test: ["CMD-SHELL", "kafka-topics.sh --bootstrap-server localhost:9092 --list >/dev/null 2>&1 || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 8
      start_period: 30s

  # ── Temporal Server (durable workflow orchestration) ──────────────────────
  # Coinbase / Snap use Temporal for mission-critical reliability.
  # If Mac restarts mid-workflow, Temporal resumes at the exact line it left off.
  mesh_temporal:
    profiles: ["mesh"]
    image: temporalio/auto-setup:1.24
    container_name: mesh_temporal
    restart: unless-stopped
    environment:
      - DB=postgresql
      - DB_PORT=5432
      - POSTGRES_USER=${DATABASE_USER:-postgres}
      - POSTGRES_PWD=${DATABASE_PASSWORD:-changeme}
      - POSTGRES_SEEDS=mesh_db
      - TEMPORAL_ADDRESS=mesh_temporal:7233
      - DYNAMIC_CONFIG_FILE_PATH=/etc/temporal/dynamicconfig/development.yaml
    ports:
      - "127.0.0.1:7233:7233"
    volumes:
      - ./infra/temporal-dynamicconfig:/etc/temporal/dynamicconfig
    networks:
      - mesh_grid
    depends_on:
      mesh_db:
        condition: service_healthy
    mem_limit: 512m

  mesh_temporal_ui:
    profiles: ["mesh"]
    image: temporalio/ui:2.31
    container_name: mesh_temporal_ui
    restart: unless-stopped
    environment:
      - TEMPORAL_ADDRESS=mesh_temporal:7233
      - TEMPORAL_CORS_ORIGINS=http://localhost:8080
    ports:
      - "127.0.0.1:8088:8080"
    networks:
      - mesh_grid
    depends_on:
      - mesh_temporal
    mem_limit: 128m

networks:
  mesh_grid:
    driver: bridge

volumes:
  mesh_db_data:
  mesh_kafka_data:
```

---

## package.json
```
{
  "name": "sovereign-sun-platform",
  "version": "1.3.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "node scripts/guard-persistence-adapter.mjs && node scripts/guard-consent-gate.mjs && prisma generate && next build",
    "start": "next start -H 0.0.0.0 -p 3000",
    "prepare": "husky",
    "verify:smoke": "./scripts/verify.sh",
    "verify:commit": "npm run build",
    "verify:sovereign": "npm run build && cd siu && node hydration_audit.js",
    "verify:system": "bash siu/systemic_guard.sh",
    "verify:full": "npm run verify:system && node siu/accessibility_audit.js && node siu/pen_test_audit.js",
    "audit:sovereign": "bash siu/grand_audit.sh",
    "test": "vitest run",
    "test:watch": "vitest",
    "squeeze:fire": "node scripts/fire-squeeze-trial.mjs",
    "docker:smoke": "sh scripts/docker-smoke-check.sh",
    "compose": "./scripts/compose.sh",
    "siu:ghost": "sh intelligence-unit/ghost-killer.sh",
    "siu:watchdog": "sh siu/network_watchdog.sh",
    "siu:probe": "python3 siu/health_probe.py",
    "siu:ports": "python3 siu/watchdog.py",
    "siu:state:once": "python3 siu/sovereign_watchdog.py --once",
    "siu:state:daemon": "python3 siu/sovereign_watchdog.py --daemon",
    "siu:ui": "cd siu && npm install && npx playwright install chromium --force && node ui_fitness_test.js",
    "siu:fitness": "cd siu && npm install && npx playwright install chromium --force && node fitness_check.js",
    "siu:sovereignty": "python3 siu/sovereignty_guard.py",
    "siu:hydration": "cd siu && npm install && npx playwright install chromium --force && node hydration_audit.js",
    "siu:handshake": "bash siu/handshake_prober.sh",
    "siu:reboot": "./scripts/sovereign_reboot.sh",
    "sovereign:sync": "./scripts/sovereign_sync.sh",
    "siu:loop": "node intelligence-unit/loop-manager.mjs",
    "setup:git-workflow": "./scripts/setup-git-workflow.sh",
    "sync-audit": "tsx scripts/sync-audit.ts",
    "sync:check": "tsx scripts/agentic-sync.ts",
    "mesh:youtube:ingest": "tsx scripts/mesh-youtube-ingest.ts",
    "mesh:relay": "tsx scripts/mesh-outbox-relay.ts",
    "mesh:embed": "tsx scripts/mesh-embedding-worker.ts",
    "mesh:discover": "tsx scripts/mesh-discovery-mine.ts",
    "mesh:worker": "tsx scripts/mesh-temporal-worker.ts",
    "mesh:trigger": "tsx scripts/mesh-trigger-workflow.ts",
    "mesh:waterfall": "tsx scripts/mesh-waterfall-worker.ts",
    "mesh:up": "docker compose -f docker-compose.monster.yml --profile mesh up -d",
    "mesh:down": "docker compose -f docker-compose.monster.yml --profile mesh down",
    "cf:edge": "node scripts/cloudflare-edge-sync.mjs",
    "cf:edge:dns": "node scripts/cloudflare-edge-sync.mjs --dns-only",
    "cf:edge:tunnel": "node scripts/cloudflare-edge-sync.mjs --tunnel-only",
    "cf:edge:dry": "node scripts/cloudflare-edge-sync.mjs --dry-run",
    "cf:edge:openclaw": "bash scripts/openclaw-edge-sync.sh",
    "compose:cf-sync": "docker compose -f docker-compose.monster.yml --profile cf-sync run --rm monster_cf_edge_sync",
    "operator:check": "bash scripts/operator-check.sh",
    "secrets:hygiene": "bash scripts/secrets-hygiene-check.sh",
    "fitness:prod": "bash scripts/production-fitness-check.sh",
    "siu:dashboard": "bash siu/dashboard.sh",
    "test:architecture": "vitest run core/architecture/**/*.test.ts"
  },
  "dependencies": {
    "@prisma/client": "6.1.0",
    "@sentry/node": "^10.46.0",
    "@temporalio/activity": "^1.16.0",
    "@temporalio/client": "^1.16.0",
    "@temporalio/worker": "^1.16.0",
    "@temporalio/workflow": "^1.16.0",
    "@types/pg": "^8.20.0",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "framer-motion": "11.11.17",
    "ioredis": "^5.7.0",
    "kafkajs": "^2.2.4",
    "lucide-react": "0.468.0",
    "next": "16.2.0",
    "next-themes": "0.4.4",
    "pg": "^8.20.0",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "resend": "^6.10.0",
    "server-only": "^0.0.1",
    "sonner": "1.7.1",
    "svix": "^1.90.0",
    "tailwind-merge": "2.5.5",
    "tailwindcss": "3.4.16",
    "tailwindcss-animate": "1.0.7",
    "winston": "^3.19.0",
    "zod": "3.24.2"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "10.4.20",
    "husky": "^9.1.7",
    "postcss": "8.4.49",
    "prisma": "6.1.0",
    "tsx": "4.19.2",
    "typescript": "5.7.2",
    "vitest": "3.0.5"
  }
}
```

---

## .env.example
```
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/lead_engine?schema=public
DATABASE_USER=postgres
DATABASE_PASSWORD=yourpassword

# ── Kafka ─────────────────────────────────────────────────────────────────────
KAFKA_BROKERS=mesh_kafka:9092
KAFKA_CLIENT_ID=sovereign-mesh
KAFKA_TOPIC_CONTENT_EVENTS=mesh.content.events

# ── Temporal ──────────────────────────────────────────────────────────────────
TEMPORAL_ADDRESS=mesh_temporal:7233
TEMPORAL_NAMESPACE=default

# ── Ollama (local LLM — Metal-accelerated on M3 Max) ──────────────────────────
OLLAMA_HOST=http://localhost:11434
OLLAMA_EMBED_MODEL=all-minilm
# For DNA extraction: gemma3:27b or gemma3:4b for faster local runs

# ── YouTube Data API v3 ───────────────────────────────────────────────────────
YOUTUBE_API_KEY=
MESH_YOUTUBE_CHANNEL_ID=UCipXVNRvJIBoZt7O_aPIgzg
MESH_YOUTUBE_MIN_VIEWS=500

# ── Application ───────────────────────────────────────────────────────────────
NODE_ENV=development
```
