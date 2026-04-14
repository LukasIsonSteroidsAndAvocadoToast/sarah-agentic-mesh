/**
 * IngestionWorkflow — Temporal-ready workflow definition.
 *
 * Temporal SDK note: The @temporalio/* packages require native Rust compilation
 * via @temporalio/core-bridge.  They are declared as OPTIONAL peer dependencies
 * here to keep CI green without the native build toolchain.
 *
 * To activate:
 *   npm install @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity
 *   Then replace the stub implementations below with real Temporal decorators.
 *
 * The interfaces and activity signatures defined here are the stable contract —
 * zero business logic needs to change when the real SDK is wired in.
 */

// ── Activity inputs / outputs (stable interface contract) ─────────────────────

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

// ── Workflow definition (stub — replace with @temporalio/workflow decorators) ──

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

/**
 * Stub workflow that can be swapped for a real Temporal workflow.
 * When using the Temporal SDK, annotate with @workflow.defn and replace
 * executeActivity calls with the proper Temporal activity proxies.
 */
export async function discoveryIngestionWorkflow(
  input: DiscoveryIngestionWorkflowInput,
): Promise<DiscoveryIngestionWorkflowOutput> {
  const { channelId, minViewCount, extractDna, ollamaModel = "gemma3:27b" } = input;

  // Step 1 — ingest YouTube metadata into the outbox
  const { ingestedIds } = await activityFetchYouTubeMetadata({
    channelId,
    minViewCount,
    maxResults: 50,
  });

  // Step 2 — generate semantic embeddings for newly ingested items
  const { embeddedCount } = await activityGenerateEmbeddings({
    contentItemIds: ingestedIds,
  });

  // Step 3 (optional) — extract creative DNA from top performers
  let dnaPrompt: string | undefined;
  if (extractDna && ingestedIds.length > 0) {
    const topIds = ingestedIds.slice(0, 10);
    const result = await activityExtractCreativeDna({
      contentItemIds: topIds,
      ollamaModel,
    });
    dnaPrompt = result.dnaPrompt;
  }

  return { ingestedCount: ingestedIds.length, embeddedCount, dnaPrompt };
}

// ── Activity stubs (real implementations live in adapters/) ──────────────────

async function activityFetchYouTubeMetadata(
  input: FetchYouTubeMetadataInput,
): Promise<FetchYouTubeMetadataOutput> {
  // Dynamically imported so the worker can be tree-shaken from the Next.js bundle.
  const { UniversalContentIngestService } = await import(
    "@/core/services/UniversalContentIngestService"
  );
  const { youtubeApiListSchema } = await import("@/lib/mesh/youtubeSchema");
  const { getMeshEnv } = await import("@/lib/mesh/env");

  const env = getMeshEnv();
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not set");

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("channelId", input.channelId);
  url.searchParams.set("maxResults", String(input.maxResults ?? 50));
  url.searchParams.set("order", "viewCount");
  url.searchParams.set("type", "video");
  url.searchParams.set("key", env.YOUTUBE_API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`YouTube API ${res.status}`);
  const raw = await res.json();
  const list = youtubeApiListSchema.parse(raw);

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
      contentText: "",
      viewCount,
      publishedAt: item.snippet.publishedAt,
      discoveredAt: new Date().toISOString(),
      rawPayload: item,
    });
    ingestedIds.push(item.id);
  }

  return { itemCount: list.items.length, ingestedIds };
}

async function activityGenerateEmbeddings(
  input: GenerateEmbeddingsInput,
): Promise<GenerateEmbeddingsOutput> {
  // Delegate to the embedding worker's single-batch function.
  // Full workers run as separate processes (scripts/mesh-embedding-worker.ts).
  const { Pool } = await import("pg");
  const { getMeshEnv } = await import("@/lib/mesh/env");

  const env = getMeshEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  let embeddedCount = 0;

  for (const id of input.contentItemIds) {
    try {
      const { rows } = await pool.query(
        `SELECT title, description, transcript_text, content_text FROM "MeshContentItem" WHERE id = $1`,
        [id],
      );
      if (!rows[0]) continue;

      const text = [rows[0].title, rows[0].description, rows[0].transcript_text ?? rows[0].content_text]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8_192);

      if (!text.trim()) continue;

      const res = await fetch(`${env.OLLAMA_HOST}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: env.OLLAMA_EMBED_MODEL, prompt: text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const { embedding } = (await res.json()) as { embedding: number[] };
      const vecLit = `[${embedding.join(",")}]`;
      await pool.query(`UPDATE "MeshContentItem" SET embedding = $1::vector WHERE id = $2`, [vecLit, id]);
      embeddedCount++;
    } catch {
      // Best-effort per item; will be retried by the embedding worker on next cycle.
    }
  }

  await pool.end();
  return { embeddedCount };
}

async function activityExtractCreativeDna(
  input: ExtractCreativeDnaInput,
): Promise<ExtractCreativeDnaOutput> {
  const { Pool } = await import("pg");
  const { getMeshEnv } = await import("@/lib/mesh/env");

  const env = getMeshEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });

  const { rows } = await pool.query(
    `SELECT title, description, transcript_text
     FROM "MeshContentItem"
     WHERE id = ANY($1::uuid[])
     ORDER BY view_count DESC`,
    [input.contentItemIds],
  );
  await pool.end();

  const transcriptBundle = rows
    .map((r, i) => `### Video ${i + 1}: ${r.title}\n${r.transcript_text ?? r.description ?? ""}`)
    .join("\n\n---\n\n")
    .slice(0, 32_000);

  const systemPrompt = `You are a creative DNA analyst. Do not apply external personas.`;
  const userPrompt = `Analyze these transcripts. Extract the native creative patterns.
How does this human think outside the box? What makes the language feel human?
Define the 'Sarah DNA' from this proven data. Return a concise system-prompt
baseline (≤400 words) that captures the authentic voice.

${transcriptBundle}`;

  const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.ollamaModel,
      system: systemPrompt,
      prompt: userPrompt,
      stream: false,
      options: { temperature: 0.85, top_p: 0.95, top_k: 60 },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) throw new Error(`Ollama generate error ${res.status}`);
  const { response } = (await res.json()) as { response: string };

  return { dnaPrompt: response.trim(), analyzedCount: rows.length };
}
