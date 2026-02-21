// ═══════════════════════════════════════════════════════════
// MUNINN — Model Factory
// Single source of truth for creating LLM model instances
// Supports: direct API, Claude Max Proxy, custom base URLs
// ═══════════════════════════════════════════════════════════

import type { MuninnConfig } from './types.js';

/**
 * Create an AI SDK model instance from config.
 *
 * Supports three modes:
 * 1. Direct API — provider=anthropic/openai, apiKey set
 * 2. Claude Max Proxy — provider=openai, baseUrl=http://localhost:3456/v1
 *    (Proxy translates OpenAI-format to Claude Code CLI calls,
 *     authenticated via your Claude Max/Pro subscription)
 * 3. Custom endpoint — any OpenAI-compatible API with baseUrl
 *
 * @param config   MuninnConfig with provider, model, apiKey, baseUrl
 * @param modelOverride  Optional model name override (e.g., for cheap models)
 */
export async function createModelInstance(
  config: MuninnConfig,
  modelOverride?: string,
) {
  const modelName = modelOverride || config.model;

  if (config.provider === 'anthropic' && !config.baseUrl) {
    // Direct Anthropic API
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const anthropic = createAnthropic({ apiKey: config.apiKey });
    return anthropic(modelName || 'claude-sonnet-4-20250514');
  }

  // OpenAI provider (or any OpenAI-compatible endpoint, including Claude Max Proxy)
  const { createOpenAI } = await import('@ai-sdk/openai');
  const openai = createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });
  return openai(modelName || 'gpt-4o');
}

/**
 * Create a cheap/fast model instance for background tasks
 * (fact extraction, proactive messages, morning greetings).
 *
 * When using a proxy, we use the same endpoint but try a lighter model.
 */
export async function createCheapModelInstance(config: MuninnConfig) {
  if (config.baseUrl) {
    // Through proxy — use a lighter Claude model if available, otherwise same model
    return createModelInstance(config, 'claude-3-5-haiku-20241022');
  }

  if (config.provider === 'anthropic') {
    return createModelInstance(config, 'claude-3-5-haiku-20241022');
  }

  return createModelInstance(config, 'gpt-4o-mini');
}
