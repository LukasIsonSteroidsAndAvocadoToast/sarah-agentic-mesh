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
