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
