/**
 * OPTIONAL LLM summarisation for the support agent — OFF by default.
 * Enabled only when ALL of these are set:
 *   AGENTS_LLM_SUMMARY=1, ANTHROPIC_API_KEY, AGENTS_LLM_MODEL (model id chosen by the operator).
 * Only ticket subjects/categories and a short, PII-masked excerpt are sent. The result is
 * advisory text stored in the proposal; it never triggers any action.
 */
export function llmSummaryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTS_LLM_SUMMARY === '1' && !!env.ANTHROPIC_API_KEY && !!env.AGENTS_LLM_MODEL;
}

/** Mask e-mails, long digit runs (phones, card/ID numbers) before text leaves the platform. */
export function maskPii(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(?:\+?\d[\s-]?){7,}/g, '[number]')
    .slice(0, 400);
}

export async function summariseTickets(lines: readonly string[]): Promise<string | null> {
  if (!llmSummaryEnabled() || lines.length === 0) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  try {
    const response = await client.messages.create({
      model: process.env.AGENTS_LLM_MODEL!,
      max_tokens: 1024,
      system:
        'You help the support team of an electronics shop in Oman. Summarise the open tickets below in at most 6 short bullet points: main themes, urgent issues, and suggested next steps. Do not invent facts.',
      messages: [{ role: 'user', content: lines.map((l) => `- ${maskPii(l)}`).join('\n') }],
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content
      .filter((b): b is Extract<(typeof response.content)[number], { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text ? text.slice(0, 4000) : null;
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[agents] LLM summary unavailable (${err.status ?? 'network'})`);
      return null;
    }
    throw err;
  }
}
