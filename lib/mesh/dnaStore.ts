/**
 * DNA Store — persist and retrieve the Creative DNA baseline.
 *
 * Uses the existing MeshServiceIdentity table with a sentinel record
 * (serviceName = 'sarah.creative.dna') so no new migration is needed.
 * The dnaPrompt, analyzedCount, and run metadata live in metadataJson.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const DNA_SERVICE_NAME = "sarah.creative.dna";

export interface CreativeDnaRecord {
  dnaPrompt: string;
  analyzedCount: number;
  channelId: string;
  ollamaModel: string;
  extractedAt: string;
}

export async function saveDna(record: CreativeDnaRecord): Promise<void> {
  await prisma.meshServiceIdentity.upsert({
    where: { serviceName: DNA_SERVICE_NAME },
    create: {
      id: randomUUID(),
      serviceName: DNA_SERVICE_NAME,
      serviceKind: "intelligence.dna",
      version: "1",
      protocol: "ollama",
      lastHeartbeatAt: new Date(),
      metadataJson: toJson(record),
    },
    update: {
      version: String(Date.now()),
      lastHeartbeatAt: new Date(),
      metadataJson: toJson(record),
    },
  });
}

export async function getDna(): Promise<CreativeDnaRecord | null> {
  const record = await prisma.meshServiceIdentity.findUnique({
    where: { serviceName: DNA_SERVICE_NAME },
  });
  if (!record?.metadataJson) return null;
  return record.metadataJson as unknown as CreativeDnaRecord;
}
