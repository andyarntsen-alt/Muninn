// ═══════════════════════════════════════════════════════════
// MUNINN — Filesystem Tools
// Read, write, list, search, move, delete — all gated by Policy Engine
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile, readdir, rename, unlink, stat, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Tool } from '../core/types.js';
import type { PolicyEngine } from '../core/policy-engine.js';
import type { ApprovalManager } from '../telegram/approval.js';

/**
 * Create filesystem tools gated by the policy engine.
 * Every operation goes through: PolicyEngine.evaluate() → (maybe) ApprovalManager → execute
 */
export function createFilesystemTools(
  policy: PolicyEngine,
  approval: ApprovalManager,
): Tool[] {
  return [
    // ─── read_file ──────────────────────────────────────────
    {
      name: 'read_file',
      description: 'Read the contents of a file. Use this to look at files on the computer.',
      parameters: {
        path: { type: 'string', description: 'Absolute or ~-relative path to the file' },
      },
      execute: async (args) => {
        const path = String(args.path);
        const decision = policy.evaluate('read_file', { path });

        await policy.logDecision('read_file', { path }, decision,
          decision.allowed ? 'allowed' : 'denied');

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        try {
          const resolved = path.replace(/^~/, process.env.HOME || '');
          const content = await readFile(resolved, 'utf-8');
          // Truncate very long files
          if (content.length > 50_000) {
            return content.slice(0, 50_000) + '\n\n... (trunkert, filen er ' + content.length + ' tegn)';
          }
          return content;
        } catch (err) {
          return `Feil ved lesing: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── write_file ─────────────────────────────────────────
    {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist.',
      parameters: {
        path: { type: 'string', description: 'Absolute or ~-relative path' },
        content: { type: 'string', description: 'Content to write' },
      },
      execute: async (args) => {
        const path = String(args.path);
        const content = String(args.content);
        const decision = policy.evaluate('write_file', { path });

        if (!decision.allowed) {
          await policy.logDecision('write_file', { path }, decision, 'denied');
          return `Ikke tillatt: ${decision.reason}`;
        }

        // Request approval if needed
        if (decision.requiresApproval) {
          const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
          const desc = `Skrive til ${path} (${content.length} tegn)\nInnhold: ${preview}`;
          const approved = await approval.requestApproval('write_file', { path }, decision.risk, desc);

          if (!approved) {
            await policy.logDecision('write_file', { path }, decision, 'rejected');
            return 'Fikk ikke lov til å skrive filen. Prøv en annen plassering eller spør brukeren hva de foretrekker.';
          }
          await policy.logDecision('write_file', { path }, decision, 'approved');
        } else {
          await policy.logDecision('write_file', { path }, decision, 'allowed');
        }

        try {
          const resolved = path.replace(/^~/, process.env.HOME || '');
          await mkdir(dirname(resolved), { recursive: true });
          await writeFile(resolved, content, 'utf-8');
          return `Skrevet ${content.length} tegn til ${path}`;
        } catch (err) {
          return `Feil ved skriving: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── list_directory ─────────────────────────────────────
    {
      name: 'list_directory',
      description: 'List files and folders in a directory.',
      parameters: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      execute: async (args) => {
        const path = String(args.path);
        const decision = policy.evaluate('list_directory', { path });

        await policy.logDecision('list_directory', { path }, decision,
          decision.allowed ? 'allowed' : 'denied');

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        try {
          const resolved = path.replace(/^~/, process.env.HOME || '');
          const entries = await readdir(resolved, { withFileTypes: true });
          const lines = entries.map(e => {
            const type = e.isDirectory() ? '📁' : '📄';
            return `${type} ${e.name}`;
          });
          return lines.join('\n') || '(Tom mappe)';
        } catch (err) {
          return `Feil: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── search_files ───────────────────────────────────────
    {
      name: 'search_files',
      description: 'Search for files matching a pattern (glob). Example: "*.ts" or "**/*.json".',
      parameters: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts")' },
        directory: { type: 'string', description: 'Directory to search in' },
      },
      execute: async (args) => {
        const pattern = String(args.pattern);
        const directory = String(args.directory || '.');
        const decision = policy.evaluate('search_files', { directory, pattern });

        await policy.logDecision('search_files', { directory, pattern }, decision,
          decision.allowed ? 'allowed' : 'denied');

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        try {
          const resolved = directory.replace(/^~/, process.env.HOME || '');
          // Use readdir recursively as a simpler alternative
          const results: string[] = [];
          await findFiles(resolved, pattern, results, 0);
          if (results.length === 0) return 'Ingen filer funnet.';
          if (results.length > 100) {
            return results.slice(0, 100).join('\n') + `\n\n... og ${results.length - 100} flere`;
          }
          return results.join('\n');
        } catch (err) {
          return `Feil: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── move_file ──────────────────────────────────────────
    {
      name: 'move_file',
      description: 'Move or rename a file.',
      parameters: {
        from: { type: 'string', description: 'Source path' },
        to: { type: 'string', description: 'Destination path' },
      },
      execute: async (args) => {
        const from = String(args.from);
        const to = String(args.to);
        const decision = policy.evaluate('move_file', { from, to });

        if (!decision.allowed) {
          await policy.logDecision('move_file', { from, to }, decision, 'denied');
          return `Ikke tillatt: ${decision.reason}`;
        }

        if (decision.requiresApproval) {
          const approved = await approval.requestApproval(
            'move_file', { from, to }, decision.risk, `Flytte ${from} → ${to}`
          );
          if (!approved) {
            await policy.logDecision('move_file', { from, to }, decision, 'rejected');
            return 'Fikk ikke lov til å flytte filen.';
          }
          await policy.logDecision('move_file', { from, to }, decision, 'approved');
        }

        try {
          const resolvedFrom = from.replace(/^~/, process.env.HOME || '');
          const resolvedTo = to.replace(/^~/, process.env.HOME || '');
          await mkdir(dirname(resolvedTo), { recursive: true });
          await rename(resolvedFrom, resolvedTo);
          return `Flyttet ${from} → ${to}`;
        } catch (err) {
          return `Feil: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── delete_file ────────────────────────────────────────
    {
      name: 'delete_file',
      description: 'Delete a file.',
      parameters: {
        path: { type: 'string', description: 'Path to the file to delete' },
      },
      execute: async (args) => {
        const path = String(args.path);
        const decision = policy.evaluate('delete_file', { path });

        if (!decision.allowed) {
          await policy.logDecision('delete_file', { path }, decision, 'denied');
          return `Ikke tillatt: ${decision.reason}`;
        }

        // Always require approval for deletion
        const approved = await approval.requestApproval(
          'delete_file', { path }, 'high', `Slette fil: ${path}`
        );

        if (!approved) {
          await policy.logDecision('delete_file', { path }, decision, 'rejected');
          return 'Fikk ikke lov til å slette filen.';
        }

        await policy.logDecision('delete_file', { path }, decision, 'approved');

        try {
          const resolved = path.replace(/^~/, process.env.HOME || '');
          await unlink(resolved);
          return `Slettet: ${path}`;
        } catch (err) {
          return `Feil: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}

/** Simple recursive file finder with pattern matching */
async function findFiles(dir: string, pattern: string, results: string[], depth: number): Promise<void> {
  if (depth > 5 || results.length > 200) return;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // Skip hidden files
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (pattern.includes('**')) {
          await findFiles(fullPath, pattern, results, depth + 1);
        }
      } else {
        // Simple glob matching
        const simplePattern = pattern.replace('**/', '').replace('*', '.*');
        if (new RegExp(simplePattern).test(entry.name)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }
}
