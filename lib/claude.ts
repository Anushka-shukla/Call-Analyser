import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;
function anthropic() {
  // Reads ANTHROPIC_API_KEY. Timeout keeps each call inside the 60-second function limit.
  if (!client) client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

export const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

// Forces Claude to answer through one tool, so the result always matches the schema.
export async function callTool<T>(opts: {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens?: number;
}): Promise<T> {
  const msg = await anthropic().messages.create({
    model: MODEL(),
    max_tokens: opts.maxTokens ?? 4000,
    system: opts.system,
    tools: [opts.tool],
    tool_choice: { type: 'tool', name: opts.tool.name },
    messages: [{ role: 'user', content: opts.user }],
  });
  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('Claude returned no tool result');
  return block.input as T;
}