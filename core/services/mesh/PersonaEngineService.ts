/**
 * PersonaEngineService — the "Sarah Filter."
 *
 * Retrieves the latest Creative DNA from dnaStore and constructs a
 * structured system prompt that forces Gemma to write with the exact
 * hooks, contrarian logic, and "human-not-jargon" style extracted in Phase 1.
 *
 * The DNA is discovered, not invented. This service never fabricates a persona;
 * it only amplifies patterns that the audience has already validated.
 */
import { getDna } from "@/lib/mesh/dnaStore";
import type { DistributionPlatform } from "@/core/ports/DistributionAdapterPort";

const PLATFORM_CONSTRAINTS: Record<DistributionPlatform, string> = {
  LINKEDIN: `Platform: LinkedIn.
Format rules:
- Hook in the first line (no fluff, no "I'm excited to share").
- Short paragraphs (1-3 lines max). White space is readability.
- Build a "cliffhanger" around line 3 that forces the reader to expand the post.
- End with ONE specific question or a bold contrarian statement, not a generic CTA.
- Max 1,300 characters. No bullet points in the first 3 lines.`,

  X_THREAD: `Platform: X (Twitter) Thread.
Format rules:
- Tweet 1 must be the highest-tension hook. Reader must feel they'll miss something critical if they stop.
- Tweets 2-9: each tweet = one complete insight. No "continued in next tweet" cop-outs.
- Tweet 10 (final): callback to tweet 1 + single CTA ("Follow for more" or "Retweet if this hit").
- Max 280 characters per tweet. Number them: "1/" "2/" etc.
- Zero filler words. Every word must earn its place.`,

  NEWSLETTER: `Platform: Email Newsletter (long-form).
Format rules:
- Subject line: treat it as a tweet — curiosity gap or bold claim.
- Open with a story or scene, NOT a summary.
- Build the "idea stack": concept → real-world example → counterintuitive insight → takeaway.
- Use section headers sparingly — only when content genuinely pivots.
- Close with a personal confession or vulnerability that makes the reader feel "me too."
- Target: 600-1,200 words. Must feel like a letter, not an article.`,

  EMAIL_SEQUENCE: `Platform: Personal Email List (inner-circle communication).
Format rules:
- Write as if emailing ONE specific person you respect.
- No corporate language. No "As per my last email." No "I hope this finds you well."
- Get to the point in sentence 1.
- One idea per email. Relentlessly single-focused.
- End with a question that makes them reply, or a micro-action they can take in 2 minutes.
- Target: 150-300 words. Punchy. Direct. Human.`,
};

const FALLBACK_DNA = `You think in systems, not tactics. You challenge conventional wisdom with data and lived experience.
Your language is direct — you say "this is wrong" not "this might be worth considering."
You use short sentences when making bold claims. You use longer sentences when building an argument.
You never use buzzwords like "leverage," "synergy," or "game-changer."
You make the reader feel smarter after reading you, not more confused.`;

export class PersonaEngineService {
  async buildSarahFilter(): Promise<string> {
    const dna = await getDna();
    const coreDna = dna?.dnaPrompt ?? FALLBACK_DNA;

    return `CREATIVE DNA BASELINE (extracted from proven high-performance content):
${coreDna}

ABSOLUTE RULES — never violate these:
1. Never use jargon. If a 14-year-old wouldn't understand a word, replace it.
2. Never start a sentence with "I" in the first line.
3. Never use "game-changer," "paradigm shift," "unlock," "leverage," or "holistic."
4. Every piece of content must contain at least ONE contrarian insight — something that challenges what the reader already believes.
5. The voice is authoritative but never arrogant. Confident, not cocky.
6. The human behind this content has real experience. Show the scars, not just the trophies.`;
  }

  async buildGenerationPrompt(
    title: string,
    sourceText: string,
    platform: DistributionPlatform,
    sarahFilter: string,
  ): Promise<{ system: string; prompt: string }> {
    const platformConstraints = PLATFORM_CONSTRAINTS[platform];

    const system = `${sarahFilter}

${platformConstraints}

Your output must be ONLY the finished content. No preamble like "Here's your post:" or "Sure, here is...".
No meta-commentary. Start directly with the content itself.`;

    const prompt = `Source material (proven content with validated audience traction):
Title: ${title}

Content:
${sourceText.slice(0, 4_000)}

Task: Re-engineer this proven content into a ${platform.replace("_", " ")} post using the DNA and platform rules above.
The output must feel like the original author wrote it for this specific platform — not like it was AI-generated.`;

    return { system, prompt };
  }
}
