import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  contentEvaluationSchema,
  meshEventEnvelopeSchema,
  universalContentSchema,
  type ContentEvaluation,
  type MeshEventEnvelope,
  type UniversalContent,
} from "@/lib/mesh/universalContentSchema";

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function buildContentCreatedEvent(content: UniversalContent): MeshEventEnvelope {
  return meshEventEnvelopeSchema.parse({
    schemaVersion: "mesh-event.v1",
    eventType: "mesh.content.ingested",
    aggregateType: "mesh_content_item",
    aggregateId: `${content.sourcePlatform}:${content.externalId}`,
    eventKey: `mesh.content.ingested:${content.sourcePlatform}:${content.externalId}`,
    producer: "mesh.ingestor.youtube",
    occurredAt: content.discoveredAt,
    payload: {
      sourcePlatform: content.sourcePlatform,
      externalId: content.externalId,
      sourceChannelId: content.sourceChannelId,
      canonicalUrl: content.canonicalUrl,
      title: content.title,
      viewCount: content.viewCount,
      publishedAt: content.publishedAt,
      schemaVersion: content.schemaVersion,
    },
    headers: {
      content_schema_version: content.schemaVersion,
    },
  });
}

export async function saveUniversalContentWithOutbox(input: UniversalContent) {
  const content = universalContentSchema.parse(input);
  const event = buildContentCreatedEvent(content);

  return prisma.$transaction(async (tx) => {
    const saved = await tx.meshContentItem.upsert({
      where: {
        sourcePlatform_externalId: {
          sourcePlatform: content.sourcePlatform,
          externalId: content.externalId,
        },
      },
      create: {
        id: randomUUID(),
        sourcePlatform: content.sourcePlatform,
        externalId: content.externalId,
        sourceChannelId: content.sourceChannelId,
        canonicalUrl: content.canonicalUrl,
        title: content.title,
        description: content.description,
        contentText: content.contentText,
        transcriptText: content.transcriptText,
        languageCode: content.languageCode,
        schemaVersion: content.schemaVersion,
        viewCount: content.viewCount,
        likeCount: content.likeCount,
        commentCount: content.commentCount,
        publishedAt: content.publishedAt ? new Date(content.publishedAt) : undefined,
        discoveredAt: new Date(content.discoveredAt),
        rawPayload: toPrismaJson(content.rawPayload),
      },
      update: {
        sourceChannelId: content.sourceChannelId,
        canonicalUrl: content.canonicalUrl,
        title: content.title,
        description: content.description,
        contentText: content.contentText,
        transcriptText: content.transcriptText,
        languageCode: content.languageCode,
        schemaVersion: content.schemaVersion,
        viewCount: content.viewCount,
        likeCount: content.likeCount,
        commentCount: content.commentCount,
        publishedAt: content.publishedAt ? new Date(content.publishedAt) : undefined,
        rawPayload: toPrismaJson(content.rawPayload),
      },
    });

    await tx.meshEventOutbox.upsert({
      where: { eventKey: event.eventKey },
      create: {
        id: randomUUID(),
        aggregateType: event.aggregateType,
        aggregateId: saved.id,
        eventType: event.eventType,
        eventKey: event.eventKey,
        eventVersion: 1,
        producer: event.producer,
        payloadJson: toPrismaJson(event.payload),
        headersJson: toPrismaJson(event.headers),
        availableAt: new Date(event.occurredAt),
      },
      update: {
        aggregateId: saved.id,
        payloadJson: toPrismaJson(event.payload),
        headersJson: toPrismaJson(event.headers),
      },
    });

    return saved;
  });
}

export async function recordContentEvaluation(contentItemId: string, input: ContentEvaluation) {
  const evaluation = contentEvaluationSchema.parse(input);
  return prisma.meshContentEvaluation.create({
    data: {
      id: randomUUID(),
      contentItemId,
      evaluatorKind: evaluation.evaluatorKind,
      modelName: evaluation.modelName,
      verdict: evaluation.verdict,
      qualityScore: evaluation.qualityScore,
      contrarianScore: evaluation.contrarianScore,
      nuanceScore: evaluation.nuanceScore,
      notes: evaluation.notes,
      payloadJson: evaluation.payload ? toPrismaJson(evaluation.payload) : undefined,
    },
  });
}

export async function heartbeatMeshService(serviceName: string, serviceKind: string, protocol: string, version: string) {
  return prisma.meshServiceIdentity.upsert({
    where: { serviceName },
    create: {
      id: randomUUID(),
      serviceName,
      serviceKind,
      protocol,
      version,
      lastHeartbeatAt: new Date(),
      metadataJson: {},
    },
    update: {
      protocol,
      version,
      lastHeartbeatAt: new Date(),
    },
  });
}
