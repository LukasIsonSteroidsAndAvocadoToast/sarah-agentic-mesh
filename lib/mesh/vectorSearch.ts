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
