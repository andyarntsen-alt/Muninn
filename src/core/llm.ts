// ═══════════════════════════════════════════════════════════
// MUNINN — LLM Helper
// Simple text generation via Claude Agent SDK
// Replaces the old Vercel AI SDK generateText() + model-factory
// ═══════════════════════════════════════════════════════════

import { query } from '@anthropic-ai/claude-agent-sdk';

export interface GenerateOptions {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Generate a text response using the Claude Agent SDK.
 * This is the simple replacement for the old `generateText()` from Vercel AI SDK.
 *
 * Uses Claude Code CLI under the hood — no proxy, no API key needed.
 * Authenticated via your Claude Max/Pro subscription.
 */
export async function generateResponse(options: GenerateOptions): Promise<string> {
  const { prompt, system, model = 'haiku', maxTokens } = options;

  try {
    const conversation = query({
      prompt,
      options: {
        ...(system ? { systemPrompt: system } : {}),
        model,
        maxTurns: 1,
      },
    });

    let responseText = '';

    for await (const message of conversation) {
      if (message.type === 'assistant') {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              responseText += block.text;
            }
          }
        }
      } else if (message.type === 'result') {
        const result = message as any;
        if (result.result && !responseText) {
          responseText = result.result;
        }
      }
    }

    return responseText.trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[LLM] Generation failed:', msg);
    throw error;
  }
}

/**
 * Generate with the cheapest/fastest model available.
 * Used for background tasks like fact extraction, greetings, check-ins.
 */
export async function generateCheapResponse(options: Omit<GenerateOptions, 'model'>): Promise<string> {
  return generateResponse({ ...options, model: 'haiku' });
}
