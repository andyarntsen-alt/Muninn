// ═══════════════════════════════════════════════════════════
// MUNINN — URL Summarizer Tool
// Read and summarize web pages for the user
// ═══════════════════════════════════════════════════════════

import type { Tool, MuninnConfig } from '../core/types.js';
import { generateCheapResponse } from '../core/llm.js';

/**
 * URL Summarizer — fetches a web page and summarizes its content.
 * Uses a lightweight approach: fetch HTML, strip tags, summarize.
 */
export function createUrlSummarizerTool(config: MuninnConfig): Tool {
  return {
    name: 'summarize_url',
    description: 'Fetch and summarize a web page. Use when the user shares a URL and wants to know what it says.',
    parameters: {
      url: { type: 'string', description: 'The URL to summarize' },
    },
    execute: async (args) => {
      const url = args.url as string;
      if (!url) return 'No URL provided.';

      try {
        // Validate URL
        new URL(url);

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Muninn/1.0 (personal AI assistant)',
            'Accept': 'text/html,text/plain',
          },
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!response.ok) {
          return `Failed to fetch URL: ${response.status} ${response.statusText}`;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          return `URL returns ${contentType} — I can only summarize HTML and text pages.`;
        }

        const html = await response.text();

        // Strip HTML to get text content
        const text = stripHtml(html);

        // Truncate to ~4000 chars for the LLM
        const truncated = text.slice(0, 4000);

        if (truncated.length < 50) {
          return 'The page appears to have very little text content.';
        }

        // Use the LLM to summarize
        const summary = await generateCheapResponse({
          prompt: `Summarize this web page content in 2-4 sentences:\n\n${truncated}`,
        });

        return `📄 **${extractTitle(html) || url}**\n\n${summary}`;
      } catch (error) {
        if (error instanceof TypeError && error.message.includes('Invalid URL')) {
          return 'That doesn\'t look like a valid URL.';
        }
        return `Failed to fetch URL: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  };
}

/** Strip HTML tags and get text content */
function stripHtml(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract page title from HTML */
function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}
