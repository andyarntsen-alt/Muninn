// ═══════════════════════════════════════════════════════════
// MUNINN — Conversation Search Tool
// "What did we talk about last week?"
// ═══════════════════════════════════════════════════════════

import type { Tool } from '../core/types.js';
import type { MemoryEngine } from '../memory/memory-engine.js';

/**
 * Conversation Search — search through past conversations.
 * Allows the user (through the LLM) to find specific past discussions.
 */
export function createConversationSearchTool(memory: MemoryEngine): Tool {
  return {
    name: 'search_conversations',
    description: 'Search through past conversations for specific topics or time periods. Use when the user asks "what did we discuss about X" or "remember when we talked about Y".',
    parameters: {
      query: { type: 'string', description: 'What to search for' },
      limit: { type: 'number', description: 'Max results (default 5)' },
    },
    execute: async (args) => {
      const query = (args.query as string || '').toLowerCase();
      const limit = (args.limit as number) || 5;

      if (!query) return 'What should I search for?';

      const conversations = await memory.getConversations(50);
      const results: Array<{ date: string; snippet: string; summary?: string }> = [];

      for (const convo of conversations) {
        // Search in messages
        const matchingMessages = convo.messages.filter(m =>
          m.content.toLowerCase().includes(query)
        );

        // Search in summary
        const summaryMatch = convo.summary?.toLowerCase().includes(query);

        if (matchingMessages.length > 0 || summaryMatch) {
          const snippet = matchingMessages.length > 0
            ? matchingMessages[0].content.slice(0, 200)
            : convo.summary?.slice(0, 200) || '';

          results.push({
            date: convo.startedAt,
            snippet: snippet + (snippet.length >= 200 ? '...' : ''),
            summary: convo.summary,
          });
        }

        if (results.length >= limit) break;
      }

      if (results.length === 0) {
        return `No past conversations found about "${query}".`;
      }

      return results.map((r, i) => {
        const date = new Date(r.date).toLocaleDateString();
        return `**${date}:** ${r.summary || r.snippet}`;
      }).join('\n\n');
    },
  };
}
