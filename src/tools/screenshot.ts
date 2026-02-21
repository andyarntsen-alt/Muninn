// ═══════════════════════════════════════════════════════════
// MUNINN — Screenshot Tool
// Takes screenshots on macOS and sends them via Telegram
// Uses native `screencapture` command
// ═══════════════════════════════════════════════════════════

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { Tool } from '../core/types.js';
import type { ApprovalManager } from '../telegram/approval.js';

const execAsync = promisify(exec);

/**
 * Create the screenshot tool.
 * Uses macOS `screencapture` to capture the screen.
 * Screenshots are saved to the data directory and can be sent via Telegram.
 * Requires approval since it captures screen content.
 */
export function createScreenshotTool(dataDir: string, approval?: ApprovalManager): Tool {
  const screenshotDir = join(dataDir, 'screenshots');

  return {
    name: 'screenshot',
    description: 'Take a screenshot of the screen. The screenshot will be sent to the user via Telegram. Use this to show the user what you have done, for example after creating a website or finishing a task.',
    parameters: {
      type: {
        type: 'string',
        description: 'Type of screenshot: "full" for full screen, "window" for front window (default: "full")',
      },
    },
    execute: async (args) => {
      if (approval) {
        const approved = await approval.requestApproval(
          'screenshot', { type: String(args.type || 'full') },
          'medium', 'Ta skjermbilde',
        );
        if (!approved) return 'SCREENSHOT_FAILED: Fikk ikke godkjenning.';
      }

      try {
        // Ensure screenshot directory exists
        await mkdir(screenshotDir, { recursive: true });

        const type = String(args.type || 'full');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot-${timestamp}.png`;
        const filepath = join(screenshotDir, filename);

        // Build screencapture command
        let command: string;
        if (type === 'window') {
          // Capture the frontmost window
          command = `screencapture -l$(osascript -e 'tell app "System Events" to set frontApp to name of first application process whose frontmost is true' -e 'tell app frontApp to id of window 1') "${filepath}" 2>/dev/null || screencapture -w "${filepath}"`;
        } else {
          // Capture full screen (no interactive selection)
          command = `screencapture -x "${filepath}"`;
        }

        await execAsync(command, { timeout: 10_000 });

        if (!existsSync(filepath)) {
          return 'SCREENSHOT_FAILED: Klarte ikke ta skjermbilde.';
        }

        // Return the path — the bot will pick this up and send it as a photo
        return `SCREENSHOT:${filepath}`;
      } catch (err) {
        return `SCREENSHOT_FAILED: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
