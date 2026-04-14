/**
 * ContentWaterfallActivities — all I/O for the Distribution Grid.
 *
 * Activities are Temporal's "safe" I/O boundary. Each function is idempotent:
 * if the workflow retries an activity, re-running it produces the same result
 * (upsert semantics prevent duplicate drafts for the same workflowId + platform).
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { LinkedInPostAdapter } from "@/adapters/distribution/LinkedInPostAdapter";
import { XThreadAdapter } from "@/adapters/distribution/XThreadAdapter";
import { NewsletterArticleAdapter } from "@/adapters/distribution/NewsletterArticleAdapter";
import { EmailSequenceAdapter } from "@/adapters/distribution/EmailSequenceAdapter";
import { getMeshEnv } from "@/lib/mesh/env";
import type { DistributionPlatform, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";

export interface AnalyzeGoldInput {
  contentItemId: string;
  workflowId: string;
}

export interface AnalyzeGoldOutput {
  reasonForTraction: string;
  contentItem: UniversalContent;
}

export interface GenerateDraftInput {
  contentItemId: string;
  workflowId: string;
  platform: DistributionPlatform;
  sarahFilter: string;
  reasonForTraction: string;
}

export interface AuditDraftsInput {
  workflowId: string;
  drafts: DistributionDraft[];
  sarahFilter: string;
}

export interface AuditDraftsOutput {
  audited: Array<DistributionDraft & { auditNotes: string }>;
}

export interface ParkDraftsInput {
  contentItemId: string;
  workflowId: string;
  drafts: Array<DistributionDraft & { auditNotes?: string }>;
}

// ── Activity: Analyze Gold ────────────────────────────────────────────────────
export async function analyzeGold(input: AnalyzeGoldInput): Promise<AnalyzeGoldOutput> {
  const env = getMeshEnv();

  const item = await prisma.meshContentItem.findUniqueOrThrow({
    where: { id: input.contentItemId },
  });

  const content: UniversalContent = {
    schemaVersion: "universal-content.v1",
    sourcePlatform: item.sourcePlatform as UniversalContent["sourcePlatform"],
    externalId: item.externalId,
    sourceChannelId: item.sourceChannelId ?? undefined,
    canonicalUrl: item.canonicalUrl,
    title: item.title,
    description: item.description ?? "",
    contentText: item.contentText,
    transcriptText: item.transcriptText ?? undefined,
    languageCode: item.languageCode ?? undefined,
    viewCount: item.viewCount ?? undefined,
    likeCount: item.likeCount ?? undefined,
    commentCount: item.commentCount ?? undefined,
    publishedAt: item.publishedAt?.toISOString(),
    discoveredAt: item.discoveredAt.toISOString(),
    rawPayload: (item.rawPayload as Record<string, unknown>) ?? {},
  };

  const sourceText = item.transcriptText ?? item.contentText;

  let reasonForTraction = `High-performing content with ${item.viewCount ?? 0} views.`;

  try {
    const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemma3:27b",
        system: "You are a content performance analyst. Be concise and specific.",
        prompt: `Analyze this content in 2-3 sentences. What is the single core reason it performs well?
What psychological trigger does it activate? What makes the hook irresistible?

Title: ${item.title}
Views: ${item.viewCount ?? 0}

Content excerpt:
${sourceText.slice(0, 2_000)}`,
        stream: false,
        options: { temperature: 0.4, top_p: 0.88 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { response: string };
      reasonForTraction = json.response.trim();
    }
  } catch { /* fallback value stands */ }

  return { reasonForTraction, contentItem: content };
}

// ── Activity: Build Sarah Filter ──────────────────────────────────────────────
export async function buildSarahFilter(): Promise<string> {
  const persona = new PersonaEngineService();
  return persona.buildSarahFilter();
}

// ── Activity: Generate Single Draft ──────────────────────────────────────────
export async function generateDraft(input: GenerateDraftInput): Promise<DistributionDraft> {
  const adapters: Record<DistributionPlatform, { generate: (c: UniversalContent, f: string) => Promise<DistributionDraft> }> = {
    LINKEDIN: new LinkedInPostAdapter(),
    X_THREAD: new XThreadAdapter(),
    NEWSLETTER: new NewsletterArticleAdapter(),
    EMAIL_SEQUENCE: new EmailSequenceAdapter(),
  };

  const item = await prisma.meshContentItem.findUniqueOrThrow({
    where: { id: input.contentItemId },
  });

  const content: UniversalContent = {
    schemaVersion: "universal-content.v1",
    sourcePlatform: item.sourcePlatform as UniversalContent["sourcePlatform"],
    externalId: item.externalId,
    sourceChannelId: item.sourceChannelId ?? undefined,
    canonicalUrl: item.canonicalUrl,
    title: item.title,
    description: item.description ?? "",
    contentText: item.contentText,
    transcriptText: item.transcriptText ?? undefined,
    viewCount: item.viewCount ?? undefined,
    publishedAt: item.publishedAt?.toISOString(),
    discoveredAt: item.discoveredAt.toISOString(),
    rawPayload: (item.rawPayload as Record<string, unknown>) ?? {},
  };

  return adapters[input.platform].generate(content, input.sarahFilter);
}

// ── Activity: Audit Drafts (second Judge pass) ────────────────────────────────
export async function auditDrafts(input: AuditDraftsInput): Promise<AuditDraftsOutput> {
  const env = getMeshEnv();

  const audited = await Promise.all(
    input.drafts.map(async (draft) => {
      let auditNotes = "Audit skipped (Ollama unavailable). Confidence from DNA scorer.";
      try {
        const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gemma3:27b",
            system: `You are a brand voice auditor. The target DNA is:\n${input.sarahFilter.slice(0, 800)}`,
            prompt: `Does this ${draft.platform} draft match the DNA? Reply in 1 sentence: pass or specific concern.

Draft:
${draft.draftText.slice(0, 1_000)}`,
            stream: false,
            options: { temperature: 0.2, top_p: 0.85 },
          }),
          signal: AbortSignal.timeout(45_000),
        });
        if (res.ok) {
          const json = (await res.json()) as { response: string };
          auditNotes = json.response.trim();
        }
      } catch { /* fallback */ }

      return { ...draft, auditNotes };
    }),
  );

  return { audited };
}

// ── Activity: Park Drafts to Postgres ────────────────────────────────────────
export async function parkDrafts(input: ParkDraftsInput): Promise<{ parkedCount: number }> {
  let parkedCount = 0;

  for (const draft of input.drafts) {
    await prisma.meshContentDraft.upsert({
      where: {
        // Idempotency key: same workflow + platform = same draft
        contentItemId_platform_workflowId: {
          contentItemId: input.contentItemId,
          platform: draft.platform,
          workflowId: input.workflowId,
        },
      },
      create: {
        id: randomUUID(),
        contentItemId: input.contentItemId,
        workflowId: input.workflowId,
        platform: draft.platform,
        draftText: draft.draftText,
        dnaConfidence: draft.dnaConfidence,
        auditNotes: draft.auditNotes,
        status: "PENDING",
      },
      update: {
        draftText: draft.draftText,
        dnaConfidence: draft.dnaConfidence,
        auditNotes: draft.auditNotes,
      },
    });
    parkedCount++;
  }

  return { parkedCount };
}
