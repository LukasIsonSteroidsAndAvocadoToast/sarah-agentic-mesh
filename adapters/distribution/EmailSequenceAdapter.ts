/**
 * EmailSequenceAdapter — direct, punchy, inner-circle personal emails.
 * 150-300 words. One idea per email. Calls local Gemma 4 via Ollama.
 */
import type { DistributionAdapterPort, DistributionDraft } from "@/core/ports/DistributionAdapterPort";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";
import { PersonaEngineService } from "@/core/services/mesh/PersonaEngineService";
import { getMeshEnv } from "@/lib/mesh/env";

const persona = new PersonaEngineService();

export class EmailSequenceAdapter implements DistributionAdapterPort {
  readonly platform = "EMAIL_SEQUENCE" as const;

  async generate(content: UniversalContent, sarahFilter: string): Promise<DistributionDraft> {
    const env = getMeshEnv();
    const sourceText = content.transcriptText ?? content.contentText;
    const { system, prompt } = await persona.buildGenerationPrompt(
      content.title,
      sourceText,
      "EMAIL_SEQUENCE",
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
          // Highest temperature for email — most personal, most raw
          options: { temperature: 0.82, top_p: 0.94, top_k: 58 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const json = (await res.json()) as { response: string };
      draftText = json.response.trim();
    } catch (err) {
      draftText = `[DRAFT GENERATION FAILED — Email]\nSource: ${content.title}\nError: ${(err as Error).message}`;
    }

    const dnaConfidence = scoreDnaAlignment(draftText, sarahFilter);
    return { platform: "EMAIL_SEQUENCE", draftText, dnaConfidence };
  }
}

function scoreDnaAlignment(draft: string, filter: string): number {
  const wordCount = draft.split(/\s+/).length;
  const lengthScore = wordCount >= 150 && wordCount <= 300 ? 0.35 : 0.1;
  const hasBuzz = /leverage|synergy|game.changer|paradigm/i.test(draft) ? -0.3 : 0;
  const signals = filter.split("\n").filter((l) => l.trim().length > 10).slice(0, 5);
  const kw =
    signals.filter((s) => draft.toLowerCase().includes(s.split(" ")[0]?.toLowerCase() ?? ""))
      .length /
    Math.max(signals.length, 1);
  return Math.max(0, Math.min(lengthScore + kw * 0.65 + hasBuzz, 1));
}
