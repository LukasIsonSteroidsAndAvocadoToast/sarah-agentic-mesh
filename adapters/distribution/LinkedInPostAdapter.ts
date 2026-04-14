/**
 * LinkedInPostAdapter — authority-driven, cliffhanger structure, high readability.
 * Calls local Gemma 4 via Ollama with the Sarah Filter injected as system prompt.
 */
import type { DistributionAdapterPort, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { getMeshEnv } from "@/lib/mesh/env";

const persona = new PersonaEngineService();

export class LinkedInPostAdapter implements DistributionAdapterPort {
  readonly platform = "LINKEDIN" as const;

  async generate(content: UniversalContent, sarahFilter: string): Promise<DistributionDraft> {
    const env = getMeshEnv();
    const sourceText = content.transcriptText ?? content.contentText;
    const { system, prompt } = await persona.buildGenerationPrompt(
      content.title,
      sourceText,
      "LINKEDIN",
      sarahFilter,
    );

    let draftText: string;
    try {
      const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemma3:27b",
          system,
          prompt,
          stream: false,
          options: { temperature: 0.72, top_p: 0.92, top_k: 50 },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const json = (await res.json()) as { response: string };
      draftText = json.response.trim();
    } catch (err) {
      draftText = `[DRAFT GENERATION FAILED — LinkedIn]\nSource: ${content.title}\nError: ${(err as Error).message}`;
    }

    const dnaConfidence = scoreDnaAlignment(draftText, sarahFilter);
    return { platform: "LINKEDIN", draftText, dnaConfidence };
  }
}

function scoreDnaAlignment(draft: string, filter: string): number {
  const dnaKeywords = extractKeySignals(filter);
  const matches = dnaKeywords.filter((kw) =>
    draft.toLowerCase().includes(kw.toLowerCase()),
  ).length;
  return Math.min(matches / Math.max(dnaKeywords.length, 1), 1);
}

function extractKeySignals(filter: string): string[] {
  const lines = filter.split("\n").filter((l) => l.trim().length > 10);
  return lines.slice(0, 8).map((l) => l.split(" ").slice(0, 3).join(" "));
}
