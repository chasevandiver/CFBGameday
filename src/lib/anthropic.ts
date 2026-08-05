import Anthropic from "@anthropic-ai/sdk";

/**
 * Model for the editorial layer (team verdicts, game swing questions).
 * Generation is a batch script run a handful of times per season, so cost
 * lives here, not in the request path.
 */
export const LLM_MODEL = "claude-sonnet-5";

export function createAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set");
  return new Anthropic({ apiKey });
}
