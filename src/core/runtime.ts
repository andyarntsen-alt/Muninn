// ═══════════════════════════════════════════════════════════
// MUNINN — Core Runtime Engine (Huginn)
// The reasoning mind that orchestrates memory, identity, and action
// Now powered by the Claude Agent SDK for native tool support
// ═══════════════════════════════════════════════════════════

import type { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { MuninnConfig, Soul, Message, Conversation, Tool } from './types.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { SoulManager } from '../identity/soul-manager.js';
import type { Reflector } from '../reflection/reflector.js';
import type { GoalsManager } from '../identity/goals-manager.js';
import { RateLimiter } from './errors.js';
import { FactExtractor } from '../memory/fact-extractor.js';
import { detectMood, getMoodGuidance } from './mood.js';
import { buildSystemPrompt } from './system-prompt.js';
import { buildMcpServer, getAllowedTools, createToolPermissionCallback } from './mcp-server.js';
import { runAgentQuery } from './agent-query.js';

export interface RuntimeOptions {
  config: MuninnConfig;
  memoryEngine: MemoryEngine;
  soulManager: SoulManager;
  goalsManager: GoalsManager;
  reflector: Reflector;
  tools?: Tool[];
}

/**
 * The Huginn Runtime — the reasoning core of Muninn.
 *
 * Named after Odin's raven of thought, Huginn processes
 * conversations, decides actions, and coordinates between
 * memory (Muninn) and identity (Soul).
 *
 * Uses the Claude Agent SDK to spawn Claude Code CLI directly.
 * This means: native tool support, no proxy needed, uses your
 * Claude Max/Pro subscription for free.
 */
export class HuginnRuntime {
  private config: MuninnConfig;
  private memory: MemoryEngine;
  private rateLimiter: RateLimiter;
  private factExtractor: FactExtractor;
  private soul: SoulManager;
  private goals: GoalsManager;
  private reflector: Reflector;
  private tools: Tool[];
  private currentConversation: Conversation | null = null;
  private mcpServer: ReturnType<typeof createSdkMcpServer> | null = null;
  private lastSessionId: string | null = null;

  constructor(options: RuntimeOptions) {
    this.config = options.config;
    this.memory = options.memoryEngine;
    this.soul = options.soulManager;
    this.goals = options.goalsManager;
    this.reflector = options.reflector;
    this.tools = options.tools || [];
    this.rateLimiter = new RateLimiter({
      maxRequestsPerMinute: 20,
      maxDailyCostUSD: 5.0,
    });
    this.factExtractor = new FactExtractor(options.config, options.memoryEngine);

    // Build MCP server with all Muninn tools
    this.mcpServer = buildMcpServer(this.memory, this.tools);
  }

  // ═══════════════════════════════════════════════════════════
  // MESSAGE PROCESSING — via Claude Agent SDK
  // ═══════════════════════════════════════════════════════════

  /** Process a user message and generate a response */
  async processMessage(
    userMessage: string,
    userId?: string,
    onProgress?: (text: string) => void,
  ): Promise<string> {
    // Load or create conversation — try to resume the last active one
    if (!this.currentConversation) {
      const recent = await this.memory.getConversations(1);
      const last = recent[0];
      // Resume if last conversation was less than 30 min ago and has no endedAt
      if (last && !last.endedAt) {
        const lastMsg = last.messages[last.messages.length - 1];
        const timeSince = lastMsg
          ? Date.now() - new Date(lastMsg.timestamp).getTime()
          : Infinity;
        if (timeSince < 30 * 60 * 1000) {
          this.currentConversation = last;
          console.log(`[Huginn] Resumed conversation ${last.id}`);
        }
      }
      if (!this.currentConversation) {
        this.currentConversation = await this.memory.startConversation();
      }
    }

    // Add user message to conversation
    const userMsg: Message = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
      metadata: userId ? { userId } : undefined,
    };
    this.currentConversation.messages.push(userMsg);

    // Detect mood for adaptive responses
    const mood = detectMood(userMessage);
    const moodGuidance = getMoodGuidance(mood, this.config.language);

    // Check rate limit
    const rateCheck = this.rateLimiter.canRequest();
    if (!rateCheck.allowed) {
      return `🐦 I need to slow down a bit. ${rateCheck.reason}`;
    }

    // Build context
    const soul = await this.soul.getSoul();
    const systemPrompt = buildSystemPrompt({
      soul,
      recentFacts: await this.memory.getRecentFacts(20),
      allFacts: await this.memory.getAllFacts(),
      entities: await this.memory.getEntities(),
      activeGoals: await this.goals.getActiveGoals(),
      config: this.config,
    }) + moodGuidance;

    // Include recent conversation history in the prompt
    const recentMessages = this.currentConversation.messages
      .slice(-this.config.maxContextMessages)
      .slice(0, -1); // Exclude the current message (it's sent as the prompt)

    const historyContext = recentMessages.length > 0
      ? recentMessages.map(m => `${m.role === 'user' ? 'Bruker' : 'Du'}: ${m.content}`).join('\n\n') + '\n\n'
      : '';

    const fullPrompt = historyContext + `Bruker: ${userMessage}`;
    const allowedTools = getAllowedTools(this.tools);
    console.log(`[Huginn] Sending to Agent SDK with ${allowedTools.length} allowed tools`);

    try {
      const result = await runAgentQuery({
        prompt: fullPrompt,
        systemPrompt,
        model: this.config.model || 'sonnet',
        maxTurns: 25,
        mcpServer: this.mcpServer,
        allowedTools,
        canUseTool: createToolPermissionCallback(allowedTools),
        cwd: process.env.HOME || '/tmp',
        continueSession: !!this.lastSessionId,
      });

      if (result.sessionId) {
        this.lastSessionId = result.sessionId;
      }

      return await this.finalizeResponse(result.text, userMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Huginn] Error generating response:', errorMessage);

      // One retry
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('[Huginn] Retrying...');

        const result = await runAgentQuery({
          prompt: fullPrompt,
          systemPrompt,
          model: this.config.model || 'sonnet',
          maxTurns: 10,
          mcpServer: this.mcpServer,
          allowedTools,
          canUseTool: createToolPermissionCallback(allowedTools),
          cwd: process.env.HOME || '/tmp',
        });

        return await this.finalizeResponse(
          result.text || 'Beklager, noe gikk galt. Prøv igjen.',
          userMessage,
        );
      } catch (retryError) {
        const retryMsg = retryError instanceof Error ? retryError.message : 'Unknown error';
        console.error('[Huginn] Retry also failed:', retryMsg);
        return 'Beklager, jeg mistet tråden et øyeblikk. Kan du prøve igjen?';
      }
    }
  }

  /** Finalize a response: save to conversation, extract facts, increment counter */
  private async finalizeResponse(responseText: string, userMessage: string): Promise<string> {
    this.rateLimiter.recordRequest();

    const text = responseText.trim()
      ? responseText
      : 'Beklager, jeg fikk ikke formulert et svar. Kan du prøve igjen?';

    const assistantMsg: Message = {
      role: 'assistant',
      content: text,
      timestamp: new Date().toISOString(),
    };
    this.currentConversation!.messages.push(assistantMsg);

    await this.memory.saveConversation(this.currentConversation!);

    // Auto-extract facts (runs in background, non-blocking)
    this.factExtractor.extractFromMessage(userMessage, text)
      .then(facts => this.factExtractor.storeExtractedFacts(facts))
      .catch(err => console.error('[Huginn] Fact extraction error:', err));

    await this.soul.incrementInteraction();

    return text;
  }

  // ═══════════════════════════════════════════════════════════
  // CONVERSATION LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  /** End the current conversation and trigger summarization */
  async endConversation(): Promise<void> {
    if (!this.currentConversation) return;

    this.currentConversation.endedAt = new Date().toISOString();

    // Generate conversation summary via Agent SDK
    try {
      const messages = this.currentConversation.messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      const result = await runAgentQuery({
        prompt: `Summarize this conversation in 2-3 sentences, focusing on key facts learned and topics discussed:\n\n${messages}`,
        systemPrompt: '',
        model: 'haiku',
        maxTurns: 1,
        mcpServer: null,
        allowedTools: [],
        canUseTool: createToolPermissionCallback([]),
        cwd: process.env.HOME || '/tmp',
      });

      this.currentConversation.summary = result.text;
    } catch {
      // Summarization is nice-to-have, don't fail on it
    }

    await this.memory.saveConversation(this.currentConversation);
    this.currentConversation = null;
    this.lastSessionId = null;
  }

  /** Check if it's time for reflection */
  async maybeReflect(): Promise<void> {
    const soul = await this.soul.getSoul();
    const lastReflection = soul.lastReflection
      ? new Date(soul.lastReflection)
      : new Date(0);

    const hoursSinceReflection =
      (Date.now() - lastReflection.getTime()) / (1000 * 60 * 60);

    if (hoursSinceReflection >= this.config.reflectionInterval) {
      console.log('[Huginn] Time for reflection...');
      await this.reflector.reflect();
    }
  }

  /** Get current soul state */
  async getSoul(): Promise<Soul> {
    return this.soul.getSoul();
  }

  /** Get conversation history */
  async getConversationHistory(limit: number = 10): Promise<Conversation[]> {
    return this.memory.getConversations(limit);
  }
}
