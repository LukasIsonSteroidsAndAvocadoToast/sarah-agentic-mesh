import type { UniversalContent } from "@/lib/mesh/universalContentSchema";

export interface UniversalContentIngestPort {
  ingest(content: UniversalContent): Promise<{ id: string }>;
}
