import type { UniversalContentIngestPort } from "@/core/ports/UniversalContentIngestPort";
import { saveUniversalContentWithOutbox } from "@/lib/mesh/eventStore";
import { universalContentSchema, type UniversalContent } from "@/lib/mesh/universalContentSchema";

export class UniversalContentIngestService implements UniversalContentIngestPort {
  async ingest(content: UniversalContent): Promise<{ id: string }> {
    const parsed = universalContentSchema.parse(content);
    const saved = await saveUniversalContentWithOutbox(parsed);
    return { id: saved.id };
  }
}
