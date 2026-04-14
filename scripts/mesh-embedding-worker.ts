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
