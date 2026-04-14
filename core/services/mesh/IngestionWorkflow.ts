/**
 * IngestionWorkflow — proper Temporal workflow definition.
 *
 * This file runs inside Temporal's V8 isolate — NO Node.js I/O here.
 * All I/O is delegated to activities (IngestionActivities.ts) via proxyActivities.
 *
 * Temporal guarantees: if the Mac dies mid-workflow, Temporal replays the
 * history and resumes at the exact activity it left off. No data loss.
 *
 * Wire the worker: scripts/mesh-temporal-worker.ts
 * Start a workflow: scripts/mesh-trigger-workflow.ts
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as Activities from "@/core/services/mesh/IngestionActivities";

// ── Type contracts (shared between workflow + activities) ──────────────────────

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

// ── Activity proxies (Temporal injects the real implementations) ───────────────
const { fetchYouTubeMetadata, generateEmbeddings, extractCreativeDna } =
  proxyActivities<typeof Activities>({
    startToCloseTimeout: "10 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "5s",
      backoffCoefficient: 2,
    },
  });

// ── Workflow definition ────────────────────────────────────────────────────────
export async function discoveryIngestionWorkflow(
  input: DiscoveryIngestionWorkflowInput,
): Promise<DiscoveryIngestionWorkflowOutput> {
  const { channelId, minViewCount, extractDna, ollamaModel = "gemma3:27b" } = input;

  // Step 1 — Fetch YouTube metadata + write to Postgres outbox (idempotent upserts).
  const { ingestedIds } = await fetchYouTubeMetadata({
    channelId,
    minViewCount,
    maxResults: 50,
  });

  // Step 2 — Generate semantic embeddings for newly ingested items.
  const { embeddedCount } = await generateEmbeddings({
    contentItemIds: ingestedIds,
  });

  // Step 3 (opt-in) — Extract Creative DNA from top performers via Gemma 4.
  let dnaPrompt: string | undefined;
  if (extractDna && ingestedIds.length > 0) {
    const topIds = ingestedIds.slice(0, 10);
    const result = await extractCreativeDna({ contentItemIds: topIds, ollamaModel });
    dnaPrompt = result.dnaPrompt;
  }

  return { ingestedCount: ingestedIds.length, embeddedCount, dnaPrompt };
}
