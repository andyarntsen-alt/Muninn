// ═══════════════════════════════════════════════════════════
// MUNINN — Open Tool
// Open apps, files, and URLs on macOS using the `open` command
// ═══════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import type { Tool } from '../core/types.js';
import type { PolicyEngine } from '../core/policy-engine.js';
import type { ApprovalManager } from '../telegram/approval.js';

/**
 * Create the open tool for macOS.
 * Opens files, folders, URLs, and apps using the native `open` command.
 * Requires approval since it interacts with the desktop environment.
 */
export function createOpenTool(
  policy: PolicyEngine,
  approval: ApprovalManager,
): Tool {
  return {
    name: 'open',
    description: 'Open a file, folder, URL, or application on macOS. Examples: open a PDF, launch Safari, open a URL in the browser.',
    parameters: {
      target: { type: 'string', description: 'File path, URL, or app name to open' },
      app: { type: 'string', description: 'Optional: specific app to open the target with (e.g., "Safari", "Visual Studio Code")' },
    },
    execute: async (args) => {
      const target = String(args.target);
      if (!target) return 'Feil: Må spesifisere hva som skal åpnes.';
      const app = args.app ? String(args.app) : '';

      // Check if it's a URL
      const isUrl = /^https?:\/\//.test(target);

      // Check if it's an app name (no path separators, no extension)
      const isApp = !target.includes('/') && !target.includes('.') && !isUrl;

      // For file paths, check policy
      if (!isUrl && !isApp) {
        const decision = policy.evaluate('read_file', { path: target });
        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }
      }

      // Build description for approval
      let desc: string;
      if (isUrl) {
        desc = `Åpne URL i nettleser: ${target}`;
      } else if (isApp) {
        desc = `Starte app: ${target}`;
      } else {
        desc = `Åpne fil: ${target}`;
        if (app) desc += ` med ${app}`;
      }

      // Files in allowed directories that passed policy check are safe to open
      // Only URLs and apps need explicit approval (they have wider impact)
      const needsApproval = isUrl || isApp;

      if (needsApproval) {
        const approved = await approval.requestApproval(
          'open', { target, app },
          'medium', desc,
        );

        if (!approved) return 'Fikk ikke lov til å åpne det.';
      }

      try {
        let cmd = 'open';

        if (isApp) {
          cmd += ` -a "${target}"`;
        } else if (app) {
          const resolved = target.replace(/^~/, process.env.HOME || '');
          cmd += ` -a "${app}" "${resolved}"`;
        } else if (isUrl) {
          cmd += ` "${target}"`;
        } else {
          const resolved = target.replace(/^~/, process.env.HOME || '');
          cmd += ` "${resolved}"`;
        }

        execSync(cmd, { timeout: 10_000 });
        return `Åpnet: ${target}${app ? ` med ${app}` : ''}`;
      } catch (err) {
        return `Feil ved åpning: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
