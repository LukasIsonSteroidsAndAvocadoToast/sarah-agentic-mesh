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
