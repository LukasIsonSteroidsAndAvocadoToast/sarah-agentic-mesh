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
