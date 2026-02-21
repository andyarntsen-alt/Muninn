// ═══════════════════════════════════════════════════════════
// MUNINN — Clipboard Tool
// Read and write the macOS clipboard (pbpaste / pbcopy)
// ═══════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import type { Tool } from '../core/types.js';
import type { PolicyEngine } from '../core/policy-engine.js';
import type { ApprovalManager } from '../telegram/approval.js';

/**
 * Create clipboard tools for macOS.
 * Reading clipboard is low risk.
 * Writing to clipboard requires approval (medium risk).
 */
export function createClipboardTools(
  policy: PolicyEngine,
  approval: ApprovalManager,
): Tool[] {
  return [
    // ─── read_clipboard ──────────────────────────────────
    {
      name: 'read_clipboard',
      description: 'Read the current contents of the macOS clipboard (utklippstavlen). Requires approval.',
      parameters: {},
      execute: async () => {
        const approved = await approval.requestApproval(
          'read_clipboard', {},
          'medium', 'Lese innholdet i utklippstavlen',
        );
        if (!approved) return 'Fikk ikke lov til å lese utklippstavlen.';

        try {
          const content = execSync('pbpaste', {
            timeout: 5_000,
            maxBuffer: 512 * 1024,
            encoding: 'utf-8',
          });

          if (!content.trim()) return '(Utklippstavlen er tom)';

          // Truncate long content
          if (content.length > 10_000) {
            return content.slice(0, 10_000) + `\n\n... (trunkert, ${content.length} tegn totalt)`;
          }
          return content;
        } catch (err) {
          return `Feil ved lesing av utklippstavle: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── write_clipboard ─────────────────────────────────
    {
      name: 'write_clipboard',
      description: 'Write text to the macOS clipboard (utklippstavlen).',
      parameters: {
        content: { type: 'string', description: 'Text to copy to clipboard' },
      },
      execute: async (args) => {
        const content = String(args.content);
        if (!content) return 'Feil: Innhold er påkrevd.';

        const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
        const approved = await approval.requestApproval(
          'write_clipboard', { contentLength: content.length },
          'medium', `Kopiere til utklippstavle (${content.length} tegn):\n${preview}`,
        );

        if (!approved) return 'Fikk ikke lov til å skrive til utklippstavlen.';

        try {
          execSync('pbcopy', {
            input: content,
            timeout: 5_000,
            encoding: 'utf-8',
          });
          return `Kopiert ${content.length} tegn til utklippstavlen.`;
        } catch (err) {
          return `Feil ved skriving til utklippstavle: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
