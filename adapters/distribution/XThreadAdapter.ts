/**
 * XThreadAdapter — high-tension, hook-first, 5-10 tweet thread format.
 * Calls local Gemma 4 via Ollama with the Sarah Filter injected as system prompt.
 */
import type { DistributionAdapterPort, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { getMeshEnv } from "@/lib/mesh/env";

const persona = new PersonaEngineService();

export class XThreadAdapter implements DistributionAdapterPort {
  readonly platform = "X_THREAD" as const;

  async generate(content: UniversalContent, sarahFilter: string): Promise<DistributionDraft> {
    const env = getMeshEnv();
    const sourceText = content.transcriptText ?? content.contentText;
    const { system, prompt } = await persona.buildGenerationPrompt(
      content.title,
      sourceText,
      "X_THREAD",
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
          options: { temperature: 0.78, top_p: 0.93, top_k: 55 },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const json = (await res.json()) as { response: string };
      draftText = json.response.trim();
    } catch (err) {
      draftText = `[DRAFT GENERATION FAILED — X Thread]\nSource: ${content.title}\nError: ${(err as Error).message}`;
    }

    const dnaConfidence = scoreDnaAlignment(draftText, sarahFilter);
    return { platform: "X_THREAD", draftText, dnaConfidence };
  }
}

function scoreDnaAlignment(draft: string, filter: string): number {
  const signals = filter.split("\n").filter((l) => l.trim().length > 10).slice(0, 8);
  const matches = signals.filter((s) =>
    draft.toLowerCase().includes(s.split(" ")[0]?.toLowerCase() ?? ""),
  ).length;
  return Math.min(matches / Math.max(signals.length, 1), 1);
}
