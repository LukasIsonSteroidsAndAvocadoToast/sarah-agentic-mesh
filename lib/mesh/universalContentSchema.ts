import { z } from "zod";

export const universalPlatformSchema = z.enum([
  "YOUTUBE",
  "X",
  "FACEBOOK",
  "INSTAGRAM",
  "REDDIT",
  "GOOGLE",
  "PERPLEXITY",
  "TIKTOK",
  "OTHER",
]);

export const universalContentSchema = z.object({
  schemaVersion: z.literal("universal-content.v1"),
  sourcePlatform: universalPlatformSchema,
  externalId: z.string().min(1),
  sourceChannelId: z.string().min(1).optional(),
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional().default(""),
  contentText: z.string().min(1),
  transcriptText: z.string().optional(),
  languageCode: z.string().min(2).max(16).optional(),
  viewCount: z.number().int().nonnegative().optional(),
  likeCount: z.number().int().nonnegative().optional(),
  commentCount: z.number().int().nonnegative().optional(),
  publishedAt: z.string().datetime().optional(),
  discoveredAt: z.string().datetime(),
  rawPayload: z.record(z.string(), z.unknown()),
});

export const meshEventEnvelopeSchema = z.object({
  schemaVersion: z.literal("mesh-event.v1"),
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  eventKey: z.string().min(1),
  producer: z.string().min(1),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()).default({}),
});

export const contentEvaluationSchema = z.object({
  evaluatorKind: z.enum(["AI_JUDGE", "RULE_ENGINE", "HUMAN"]),
  modelName: z.string().optional(),
  verdict: z.enum(["ACCEPT", "REVIEW", "REJECT"]),
  qualityScore: z.number().min(0).max(1).optional(),
  contrarianScore: z.number().min(0).max(1).optional(),
  nuanceScore: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type UniversalContent = z.infer<typeof universalContentSchema>;
export type MeshEventEnvelope = z.infer<typeof meshEventEnvelopeSchema>;
export type ContentEvaluation = z.infer<typeof contentEvaluationSchema>;
