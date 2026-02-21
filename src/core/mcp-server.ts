// ═══════════════════════════════════════════════════════════
// MUNINN — MCP Server Builder
// Registers all Muninn tools as MCP tools for the Agent SDK
// ═══════════════════════════════════════════════════════════

import { tool as sdkTool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Tool } from './types.js';
import type { MemoryEngine } from '../memory/memory-engine.js';

/** Build an in-process MCP server with all Muninn tools */
export function buildMcpServer(memory: MemoryEngine, tools: Tool[]) {
  const mcpTools = [];

  // Memory tools — always available
  mcpTools.push(
    sdkTool(
      'remember_fact',
      'Remember a fact about the user or something they mentioned. Use this when you learn something new.',
      {
        subject: z.string().describe('Who or what the fact is about'),
        predicate: z.string().describe('The relationship or attribute'),
        object: z.string().describe('The value or target'),
        context: z.string().optional().describe('When or how you learned this'),
      },
      async ({ subject, predicate, object, context }) => {
        await memory.addFact({
          subject,
          predicate,
          object,
          source: 'conversation',
          context: context || undefined,
        });
        return { content: [{ type: 'text' as const, text: `Remembered: ${subject} ${predicate} ${object}` }] };
      },
    ),
  );

  mcpTools.push(
    sdkTool(
      'recall_facts',
      'Search your memory for facts about a topic or person.',
      {
        query: z.string().describe('What to search for in memory'),
      },
      async ({ query }) => {
        const facts = await memory.searchFacts(query);
        const text = facts.length === 0
          ? 'No memories found about this topic.'
          : facts.map(f => `${f.subject} ${f.predicate} ${f.object} (learned: ${f.validAt})`).join('\n');
        return { content: [{ type: 'text' as const, text }] };
      },
    ),
  );

  // Register all custom tools (filesystem, shell, browser, git, clipboard, open, etc.)
  for (const t of tools) {
    const schemaEntries = Object.entries(t.parameters).map(([key, schema]) => {
      const s = schema as { type?: string; description?: string };
      const desc = s.description || key;
      switch (s.type) {
        case 'number': return [key, z.number().describe(desc)] as const;
        case 'boolean': return [key, z.boolean().describe(desc)] as const;
        default: return [key, z.string().optional().describe(desc)] as const;
      }
    });

    const zodSchema = Object.fromEntries(schemaEntries);

    mcpTools.push(
      sdkTool(
        t.name,
        t.description,
        zodSchema,
        async (args: Record<string, unknown>) => {
          try {
            const result = await t.execute(args);
            return { content: [{ type: 'text' as const, text: String(result) }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
          }
        },
      ),
    );
  }

  console.log(`[Huginn] Registered ${mcpTools.length} MCP tools`);

  return createSdkMcpServer({
    name: 'muninn-tools',
    version: '1.0.0',
    tools: mcpTools,
  });
}

/** Build the list of allowed tool names for the Agent SDK */
export function getAllowedTools(tools: Tool[]): string[] {
  return [
    'mcp__muninn-tools__remember_fact',
    'mcp__muninn-tools__recall_facts',
    ...tools.map(t => `mcp__muninn-tools__${t.name}`),
  ];
}

/** Create a permission callback that auto-allows tools in the allowlist */
export function createToolPermissionCallback(allowedTools: string[]): CanUseTool {
  const allowedSet = new Set(allowedTools);
  return async (toolName, _input, _options) => {
    if (allowedSet.has(toolName)) {
      return { behavior: 'allow' as const };
    }
    return { behavior: 'deny' as const, message: `Tool not in allowlist: ${toolName}` };
  };
}
