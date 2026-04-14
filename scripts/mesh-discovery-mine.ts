#!/usr/bin/env tsx
/**
 * Discovery Mine — triggers the DiscoveryIngestionWorkflow directly
 * (without Temporal, for local use until the Temporal SDK is wired in).
 *
 * Run: npm run mesh:discover
 * Env required: YOUTUBE_API_KEY, DATABASE_URL, OLLAMA_HOST (optional)
 */
import { discoveryIngestionWorkflow } from "@/core/services/mesh/IngestionWorkflow";
import { getMeshEnv } from "@/lib/mesh/env";

async function main() {
  const env = getMeshEnv();
  console.log("[discovery-mine] Initializing sovereign discovery run…");

  const result = await discoveryIngestionWorkflow({
    channelId: "UCipXVNRvJIBoZt7O_aPIgzg",
    minViewCount: 500,
    extractDna: true,
    ollamaModel: env.OLLAMA_EMBED_MODEL ?? "gemma3:27b",
  });

  console.log(`[discovery-mine] Done.`);
  console.log(`  Ingested: ${result.ingestedCount} items`);
  console.log(`  Embedded: ${result.embeddedCount} items`);
  if (result.dnaPrompt) {
    console.log(`\n─── Creative DNA Baseline ───────────────────────────────\n`);
    console.log(result.dnaPrompt);
    console.log(`\n────────────────────────────────────────────────────────\n`);
  }
}

main().catch((err) => {
  console.error("[discovery-mine] Fatal:", err);
  process.exit(1);
});
