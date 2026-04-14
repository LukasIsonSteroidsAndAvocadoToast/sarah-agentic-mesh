#!/usr/bin/env tsx
/**
 * Temporal Worker — polls the 'sarah-mesh' task queue and executes
 * DiscoveryIngestionWorkflow activities.
 *
 * Run: npm run mesh:worker
 * Requires: Temporal server running (npm run mesh:up first)
 *
 * The worker registers:
 *   - Workflow:   discoveryIngestionWorkflow (IngestionWorkflow.ts)
 *   - Activities: fetchYouTubeMetadata, generateEmbeddings, extractCreativeDna
 */
import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "@/core/services/mesh/IngestionActivities";
import { getMeshEnv } from "@/lib/mesh/env";
import path from "node:path";

const TASK_QUEUE = "sarah-mesh";

async function main() {
  const env = getMeshEnv();

  console.log(`[temporal-worker] Connecting to ${env.TEMPORAL_ADDRESS}`);

  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.resolve(__dirname, "../core/services/mesh/IngestionWorkflow"),
    activities,
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 2,
  });

  console.log(`[temporal-worker] Ready. Task queue: ${TASK_QUEUE}`);

  process.on("SIGTERM", () => {
    console.log("[temporal-worker] SIGTERM — draining");
    worker.shutdown();
  });
  process.on("SIGINT", () => {
    console.log("[temporal-worker] SIGINT — draining");
    worker.shutdown();
  });

  await worker.run();
}

main().catch((err) => {
  console.error("[temporal-worker] Fatal:", err);
  process.exit(1);
});
