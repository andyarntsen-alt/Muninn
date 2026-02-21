// ═══════════════════════════════════════════════════════════
// MUNINN — Agent Query Runner
// Consolidates the Agent SDK query + streaming logic
// ═══════════════════════════════════════════════════════════

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { createSdkMcpServer, CanUseTool } from '@anthropic-ai/claude-agent-sdk';

export interface AgentQueryOptions {
  prompt: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  mcpServer: ReturnType<typeof createSdkMcpServer> | null;
  allowedTools: string[];
  canUseTool: CanUseTool;
  cwd: string;
  continueSession?: boolean;
}

export interface AgentQueryResult {
  text: string;
  sessionId: string;
  costUsd?: number;
  numTurns?: number;
}

/** Run a single Agent SDK query and collect the streamed response */
export async function runAgentQuery(options: AgentQueryOptions): Promise<AgentQueryResult> {
  const mcpServers: Record<string, any> = {};
  if (options.mcpServer) {
    mcpServers['muninn-tools'] = options.mcpServer;
  }

  const conversation = query({
    prompt: options.prompt,
    options: {
      systemPrompt: options.systemPrompt,
      model: options.model,
      maxTurns: options.maxTurns,
      mcpServers,
      allowedTools: options.allowedTools,
      canUseTool: options.canUseTool,
      permissionMode: 'default',
      cwd: options.cwd,
      ...(options.continueSession ? { continue: true } : {}),
    },
  });

  let responseText = '';
  let sessionId = '';
  let costUsd: number | undefined;
  let numTurns: number | undefined;

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
      sessionId = (message as any).session_id || sessionId;
    } else if (message.type === 'result') {
      const result = message as any;
      sessionId = result.session_id || sessionId;
      if (result.result && !responseText) {
        responseText = result.result;
      }
      costUsd = result.total_cost_usd;
      numTurns = result.num_turns;
      console.log(`[Huginn] Query complete. Cost: $${costUsd?.toFixed(4) || '?'}, turns: ${numTurns || '?'}`);
    }
  }

  return { text: responseText, sessionId, costUsd, numTurns };
}
