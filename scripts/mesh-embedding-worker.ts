#!/usr/bin/env tsx
/**
 * CLI entry point for the Embedding Worker daemon.
 * Run: tsx scripts/mesh-embedding-worker.ts
 * Or:  npm run mesh:embed
 *
 * Requires Ollama running locally (http://localhost:11434) with
 * the configured OLLAMA_EMBED_MODEL pulled (default: all-minilm).
 *
 * Pull model: ollama pull all-minilm
 */
import { runEmbeddingWorker } from "@/lib/mesh/embeddingWorker";

const controller = new AbortController();

process.on("SIGTERM", () => {
  console.log("[embed] SIGTERM — graceful shutdown");
  controller.abort();
});
process.on("SIGINT", () => {
  console.log("[embed] SIGINT — graceful shutdown");
  controller.abort();
});

runEmbeddingWorker(controller.signal)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[embed] Fatal:", err);
    process.exit(1);
  });
