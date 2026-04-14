/**
 * ContentWaterfallWorkflow — durable Temporal workflow for the Distribution Grid.
 *
 * V8 isolate: NO Node.js I/O here. All I/O is in ContentWaterfallActivities.ts.
 *
 * Sequence (Temporal guarantees crash-safety at each step):
 *   1. analyzeGold      — why did this content perform? (Gemma 4 analysis)
 *   2. buildSarahFilter — retrieve Creative DNA from Postgres
 *   3. generateDrafts   — run all 4 platform adapters IN PARALLEL
 *   4. auditDrafts      — second Gemma pass: does each draft match the DNA?
 *   5. parkDrafts       — upsert all drafts to mesh_content_draft table
 *
 * Durability: if the Mac dies after LinkedIn is generated but before Newsletter,
 * Temporal replays history and resumes at Newsletter. LinkedIn is NOT regenerated.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as Activities from "@/core/services/mesh/ContentWaterfallActivities";
import type { DistributionPlatform } from "@/core/ports/DistributionAdapterPort";

export interface ContentWaterfallInput {
  contentItemId: string;
  workflowId?: string;
}

export interface ContentWaterfallOutput {
  contentItemId: string;
  draftsParked: number;
  reasonForTraction: string;
  platforms: DistributionPlatform[];
}

const {
  analyzeGold,
  buildSarahFilter,
  generateDraft,
  auditDrafts,
  parkDrafts,
} = proxyActivities<typeof Activities>({
  startToCloseTimeout: "15 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10s",
    backoffCoefficient: 2,
    nonRetryableErrorTypes: [],
  },
});

const PLATFORMS: DistributionPlatform[] = [
  "LINKEDIN",
  "X_THREAD",
  "NEWSLETTER",
  "EMAIL_SEQUENCE",
];

export async function contentWaterfallWorkflow(
  input: ContentWaterfallInput,
): Promise<ContentWaterfallOutput> {
  const workflowId = input.workflowId ?? `waterfall-${input.contentItemId}`;

  // Step 1 + 2 in parallel — independent reads
  const [{ reasonForTraction }, sarahFilter] = await Promise.all([
    analyzeGold({ contentItemId: input.contentItemId, workflowId }),
    buildSarahFilter(),
  ]);

  // Step 3 — generate all 4 platform drafts IN PARALLEL
  // Temporal tracks each as a separate activity — crash-safe per platform
  const rawDrafts = await Promise.all(
    PLATFORMS.map((platform) =>
      generateDraft({
        contentItemId: input.contentItemId,
        workflowId,
        platform,
        sarahFilter,
        reasonForTraction,
      }),
    ),
  );

  // Step 4 — audit all drafts (second Gemma pass for DNA alignment)
  const { audited } = await auditDrafts({
    workflowId,
    drafts: rawDrafts,
    sarahFilter,
  });

  // Step 5 — park everything to Postgres as PENDING
  const { parkedCount } = await parkDrafts({
    contentItemId: input.contentItemId,
    workflowId,
    drafts: audited,
  });

  return {
    contentItemId: input.contentItemId,
    draftsParked: parkedCount,
    reasonForTraction,
    platforms: PLATFORMS,
  };
}
