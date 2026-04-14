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
