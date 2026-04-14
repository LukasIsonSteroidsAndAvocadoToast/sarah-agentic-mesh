/**
 * NewsletterArticleAdapter — deep-dive narrative, converts short-form gold
 * into long-form value (600-1,200 words). Story-first, not summary-first.
 * Calls local Gemma 4 via Ollama with the Sarah Filter injected as system prompt.
 */
import type { DistributionAdapterPort, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { getMeshEnv } from "@/lib/mesh/env";

const persona = new PersonaEngineService();

export class NewsletterArticleAdapter implements DistributionAdapterPort {
  readonly platform = "NEWSLETTER" as const;

  async generate(content: UniversalContent, sarahFilter: string): Promise<DistributionDraft> {
    const env = getMeshEnv();
    const sourceText = content.transcriptText ?? content.contentText;
    const { system, prompt } = await persona.buildGenerationPrompt(
      content.title,
      sourceText,
      "NEWSLETTER",
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
          // Lower temp for newsletters — structure over chaos
          options: { temperature: 0.65, top_p: 0.90, top_k: 45 },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const json = (await res.json()) as { response: string };
      draftText = json.response.trim();
    } catch (err) {
      draftText = `[DRAFT GENERATION FAILED — Newsletter]\nSource: ${content.title}\nError: ${(err as Error).message}`;
    }

    const dnaConfidence = scoreDnaAlignment(draftText, sarahFilter);
    return { platform: "NEWSLETTER", draftText, dnaConfidence };
  }
}

function scoreDnaAlignment(draft: string, filter: string): number {
  const wordCount = draft.split(/\s+/).length;
  const lengthScore = wordCount >= 600 && wordCount <= 1_200 ? 0.3 : 0.1;
  const signals = filter.split("\n").filter((l) => l.trim().length > 10).slice(0, 6);
  const keywordScore =
    signals.filter((s) => draft.toLowerCase().includes(s.split(" ")[0]?.toLowerCase() ?? ""))
      .length /
    Math.max(signals.length, 1);
  return Math.min(lengthScore + keywordScore * 0.7, 1);
}
