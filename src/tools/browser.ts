// ═══════════════════════════════════════════════════════════
// MUNINN — Browser Tools
// Fetch web pages, search the web, download files
// Simple and safe — no full browser control (intentionally)
// ═══════════════════════════════════════════════════════════

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '../core/types.js';
import type { PolicyEngine } from '../core/policy-engine.js';
import type { ApprovalManager } from '../telegram/approval.js';

/** Max page content to return */
const MAX_PAGE_LENGTH = 20_000;

/**
 * Create browser/web tools gated by the policy engine.
 * These are intentionally simple — no CDP, no full browser control.
 */
export function createBrowserTools(
  policy: PolicyEngine,
  approval: ApprovalManager,
): Tool[] {
  return [
    // ─── fetch_page ─────────────────────────────────────────
    {
      name: 'fetch_page',
      description: 'Fetch a web page and return its text content. Good for reading articles, documentation, etc.',
      parameters: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      execute: async (args) => {
        const url = String(args.url);
        const decision = policy.evaluate('fetch_page', { url });

        await policy.logDecision('fetch_page', { url }, decision,
          decision.allowed ? 'allowed' : 'denied');

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Muninn/1.0 (Personal AI Agent)',
              'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
            },
          });

          clearTimeout(timeout);

          if (!response.ok) {
            return `HTTP ${response.status}: ${response.statusText}`;
          }

          const contentType = response.headers.get('content-type') || '';
          const text = await response.text();

          // For HTML, do a basic strip of tags
          let content: string;
          if (contentType.includes('html')) {
            content = stripHtml(text);
          } else {
            content = text;
          }

          // Truncate if too long
          if (content.length > MAX_PAGE_LENGTH) {
            content = content.slice(0, MAX_PAGE_LENGTH) + '\n\n... (trunkert)';
          }

          return content || '(Tom side)';
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return '⏰ Forespørselen timed out etter 15 sekunder.';
          }
          return `Feil: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── search_web ─────────────────────────────────────────
    {
      name: 'search_web',
      description: 'Search the web using DuckDuckGo. Returns search results with titles and URLs.',
      parameters: {
        query: { type: 'string', description: 'Search query' },
      },
      execute: async (args) => {
        const query = String(args.query);
        const decision = policy.evaluate('search_web', { query });

        await policy.logDecision('search_web', { query }, decision,
          decision.allowed ? 'allowed' : 'denied');

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        try {
          // Use DuckDuckGo HTML (no API key needed)
          const encoded = encodeURIComponent(query);
          const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Muninn/1.0 (Personal AI Agent)',
            },
          });

          clearTimeout(timeout);
          const html = await response.text();

          // Extract results from DDG HTML
          const results = extractDDGResults(html);

          if (results.length === 0) {
            return `Ingen resultater for "${query}"`;
          }

          return results.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
          ).join('\n\n');
        } catch (err) {
          return `Søkefeil: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── download_file ──────────────────────────────────────
    {
      name: 'download_file',
      description: 'Download a file from a URL and save it locally. Always requires approval (high risk).',
      parameters: {
        url: { type: 'string', description: 'URL of the file to download' },
        savePath: { type: 'string', description: 'Local path to save the file' },
      },
      execute: async (args) => {
        const url = String(args.url);
        const savePath = String(args.savePath);
        const decision = policy.evaluate('download_file', { url, savePath });

        if (!decision.allowed) {
          await policy.logDecision('download_file', { url, savePath }, decision, 'denied');
          return `Ikke tillatt: ${decision.reason}`;
        }

        // Always requires approval
        const approved = await approval.requestApproval(
          'download_file', { url, savePath }, 'high',
          `Laste ned ${url}\nLagre til: ${savePath}`
        );

        if (!approved) {
          await policy.logDecision('download_file', { url, savePath }, decision, 'rejected');
          return 'Fikk ikke lov til å laste ned filen.';
        }

        await policy.logDecision('download_file', { url, savePath }, decision, 'approved');

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60_000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Muninn/1.0' },
          });

          clearTimeout(timeout);

          if (!response.ok) {
            return `HTTP ${response.status}: ${response.statusText}`;
          }

          const resolved = savePath.replace(/^~/, process.env.HOME || '');
          await mkdir(dirname(resolved), { recursive: true });

          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(resolved, buffer);

          const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
          return `Lastet ned ${sizeMB} MB til ${savePath}`;
        } catch (err) {
          return `Feil: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}

/** Strip HTML tags and normalize whitespace */
function stripHtml(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove nav, header, footer
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    // Convert block elements to newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Normalize whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface DDGResult {
  title: string;
  url: string;
  snippet: string;
}

/** Extract search results from DuckDuckGo HTML */
function extractDDGResults(html: string): DDGResult[] {
  const results: DDGResult[] = [];
  // Match result links
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];

  for (let i = 0; i < Math.min(links.length, 10); i++) {
    const url = links[i][1].replace(/.*uddg=/, '').split('&')[0];
    const title = links[i][2].replace(/<[^>]+>/g, '').trim();
    const snippet = snippets[i]
      ? snippets[i][1].replace(/<[^>]+>/g, '').trim()
      : '';

    try {
      const decodedUrl = decodeURIComponent(url);
      results.push({ title, url: decodedUrl, snippet });
    } catch {
      results.push({ title, url, snippet });
    }
  }

  return results;
}
