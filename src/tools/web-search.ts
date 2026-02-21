// ═══════════════════════════════════════════════════════════
// MUNINN — Web Search Tool
// Giving the raven eyes beyond its own memory
// Uses Google search scraping + DuckDuckGo fallback
// ═══════════════════════════════════════════════════════════

import type { Tool } from '../core/types.js';

/**
 * Web search tool using Google search scraping.
 * Falls back to DuckDuckGo if Google fails.
 * No API key required.
 */
export function createWebSearchTool(): Tool {
  return {
    name: 'web_search',
    description: 'Search the web (Google) for current information. Use when the user asks about news, facts, products, or anything you don\'t know.',
    parameters: {
      query: { type: 'string', description: 'The search query' },
    },
    execute: async (args) => {
      const query = args.query as string;
      if (!query) return 'No search query provided.';

      // Try Google first, fall back to DuckDuckGo
      try {
        const googleResults = await searchGoogle(query);
        if (googleResults.length > 0) {
          return googleResults.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
          ).join('\n\n');
        }
      } catch (err) {
        console.log('[Search] Google failed, trying DuckDuckGo:', err instanceof Error ? err.message : err);
      }

      // DuckDuckGo fallback
      try {
        const ddgResults = await searchDuckDuckGo(query);
        if (ddgResults.length > 0) {
          return ddgResults.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
          ).join('\n\n');
        }
      } catch (err) {
        console.log('[Search] DuckDuckGo also failed:', err instanceof Error ? err.message : err);
      }

      return `Ingen resultater for "${query}".`;
    },
  };
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Search Google by scraping the HTML results page */
async function searchGoogle(query: string): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://www.google.com/search?q=${encoded}&hl=no&num=8`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'no,en;q=0.9',
    },
  });

  clearTimeout(timeout);
  const html = await response.text();

  const results: SearchResult[] = [];

  // Extract results from Google HTML
  // Google wraps results in <div class="g"> blocks
  const resultBlocks = html.split('<div class="g"').slice(1, 11);

  for (const block of resultBlocks) {
    // Extract URL from the first <a href>
    const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
    // Extract title from <h3>
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    // Extract snippet from various span/div patterns
    const snippetMatch = block.match(/<span[^>]*class="[^"]*"[^>]*>([\s\S]{40,300}?)<\/span>/);

    if (urlMatch && titleMatch) {
      const url = urlMatch[1];
      // Skip Google's own URLs
      if (url.includes('google.com/search') || url.includes('accounts.google')) continue;

      const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
        : '';

      if (title) {
        results.push({ title, url, snippet });
      }
    }
  }

  return results.slice(0, 8);
}

/** Search DuckDuckGo HTML as fallback */
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  clearTimeout(timeout);
  const html = await response.text();

  const results: SearchResult[] = [];

  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];

  for (let i = 0; i < Math.min(links.length, 8); i++) {
    const rawUrl = links[i][1].replace(/.*uddg=/, '').split('&')[0];
    const title = links[i][2].replace(/<[^>]+>/g, '').trim();
    const snippet = snippets[i]
      ? snippets[i][1].replace(/<[^>]+>/g, '').trim()
      : '';

    try {
      const decodedUrl = decodeURIComponent(rawUrl);
      results.push({ title, url: decodedUrl, snippet });
    } catch {
      results.push({ title, url: rawUrl, snippet });
    }
  }

  return results;
}
