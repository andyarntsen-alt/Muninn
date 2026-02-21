// ═══════════════════════════════════════════════════════════
// MUNINN — Telegram Approval System
// Human-in-the-loop for risky operations.
// Supports: inline keyboard buttons OR text replies (ja/nei)
// ═══════════════════════════════════════════════════════════

import type { Bot, Context } from 'grammy';
import type { ApprovalRequest, RiskLevel } from '../core/types.js';
import { nanoid } from 'nanoid';

/** Timeout for approval requests (5 minutes — gives you time to read and respond) */
const APPROVAL_TIMEOUT_MS = 5 * 60_000;

/** Words that count as "yes" */
const YES_WORDS = ['ja', 'yes', 'ok', 'okei', 'greit', 'kjør', 'godkjenn', 'go', 'sure', 'yep', 'jep', 'j', 'y'];

/** Words that count as "no" */
const NO_WORDS = ['nei', 'no', 'nope', 'stopp', 'avvis', 'ikke', 'nei takk', 'n'];

/**
 * The Approval Manager — handles Telegram approval flows.
 *
 * When Muninn wants to do something risky (write a file, run a shell command),
 * this asks the user for confirmation. Two ways to respond:
 * 1. Tap the inline keyboard buttons (✅ / ❌)
 * 2. Just type "ja" or "nei" as a regular message
 */
export class ApprovalManager {
  private pending: Map<string, ApprovalRequest> = new Map();
  private bot: Bot<Context> | null = null;
  private allowedUsers: number[];

  constructor(allowedUsers: number[]) {
    this.allowedUsers = allowedUsers;
  }

  /** Connect to the bot instance (called during init) */
  setBot(bot: Bot<Context>): void {
    this.bot = bot;
    this.setupCallbackHandler();
  }

  /**
   * Check if a text message is a yes/no response to a pending approval.
   * Called from the bot's message handler BEFORE normal message processing.
   * Returns true if the message was handled (consumed), false otherwise.
   */
  handleTextResponse(userId: number, text: string): boolean {
    // Only handle if there are pending approvals
    if (this.pending.size === 0) return false;

    // Only handle from allowed users
    if (!this.allowedUsers.includes(userId)) return false;

    const normalized = text.trim().toLowerCase();

    // Check if it's a yes
    const isYes = YES_WORDS.includes(normalized);
    const isNo = NO_WORDS.includes(normalized);

    if (!isYes && !isNo) return false;

    // Find the most recent pending approval (the one the user is most likely responding to)
    let latestRequest: ApprovalRequest | null = null;
    let latestId: string | null = null;
    let latestTime = 0;

    for (const [id, request] of this.pending) {
      if (request.createdAt > latestTime) {
        latestTime = request.createdAt;
        latestRequest = request;
        latestId = id;
      }
    }

    if (!latestRequest || !latestId) return false;

    // Resolve the approval
    this.pending.delete(latestId);
    latestRequest.resolve(isYes);

    // Send confirmation
    const statusEmoji = isYes ? '✅' : '❌';
    const statusText = isYes ? 'GODKJENT' : 'AVVIST';

    for (const uid of this.allowedUsers) {
      this.bot?.api.sendMessage(uid,
        `${statusEmoji} *${statusText}*: \`${latestRequest.description}\``,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    console.log(`[Approval] ${latestId}: ${statusText} via text reply`);
    return true;
  }

  /** Request approval from the user via Telegram inline keyboard */
  async requestApproval(
    tool: string,
    args: Record<string, unknown>,
    risk: RiskLevel,
    description: string,
  ): Promise<boolean> {
    if (!this.bot || this.allowedUsers.length === 0) {
      console.warn('[Approval] No bot or users configured, auto-denying');
      return false;
    }

    const id = nanoid(12);

    return new Promise<boolean>((resolve) => {
      const request: ApprovalRequest = {
        id,
        tool,
        args,
        risk,
        description,
        resolve,
        createdAt: Date.now(),
      };

      this.pending.set(id, request);

      // Send approval message to all allowed users
      const riskEmoji = risk === 'high' ? '🔴' : '🟡';
      const riskLabel = risk === 'high' ? 'HØY RISIKO' : 'MEDIUM RISIKO';

      const message =
        `${riskEmoji} *${riskLabel}*\n\n` +
        `Muninn vil gjøre:\n` +
        `\`${description}\`\n\n` +
        `Verktøy: \`${tool}\`\n\n` +
        `Svar *ja* / *nei* eller bruk knappene:`;

      for (const userId of this.allowedUsers) {
        this.bot!.api.sendMessage(userId, message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Ja', callback_data: `approve:${id}` },
              { text: '❌ Nei', callback_data: `reject:${id}` },
            ]],
          },
        }).catch(err => {
          console.error(`[Approval] Failed to send approval to ${userId}:`, err);
        });
      }

      // Auto-reject after timeout
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve(false);
          console.log(`[Approval] Request ${id} timed out`);

          // Notify user of timeout
          for (const userId of this.allowedUsers) {
            this.bot!.api.sendMessage(userId,
              `⏰ Timed out: \`${description}\`\nHandlingen ble avvist automatisk.`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }
        }
      }, APPROVAL_TIMEOUT_MS);
    });
  }

  /** Set up the callback query handler for inline keyboard responses */
  private setupCallbackHandler(): void {
    if (!this.bot) return;

    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (!data) return;

      const [action, id] = data.split(':');
      if (!id || !['approve', 'reject'].includes(action)) return;

      const request = this.pending.get(id);
      if (!request) {
        await ctx.answerCallbackQuery({ text: 'Allerede håndtert.' });
        return;
      }

      // Verify it's an allowed user
      const userId = ctx.from?.id;
      if (!userId || !this.allowedUsers.includes(userId)) {
        await ctx.answerCallbackQuery({ text: 'Du har ikke tilgang.' });
        return;
      }

      const approved = action === 'approve';
      this.pending.delete(id);
      request.resolve(approved);

      // Update the message
      const statusEmoji = approved ? '✅' : '❌';
      const statusText = approved ? 'GODKJENT' : 'AVVIST';

      try {
        await ctx.editMessageText(
          `${statusEmoji} *${statusText}*\n\n` +
          `\`${request.description}\`\n\n` +
          `Av: ${ctx.from.first_name}`,
          { parse_mode: 'Markdown' }
        );
      } catch {
        // Message might be too old to edit
      }

      await ctx.answerCallbackQuery({
        text: approved ? 'Godkjent!' : 'Avvist.',
      });

      console.log(`[Approval] ${id}: ${statusText} by ${ctx.from.first_name}`);
    });
  }

  /** Check if there are pending approvals */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** Get count of pending approvals */
  getPendingCount(): number {
    return this.pending.size;
  }

  /** Clean up expired requests */
  cleanup(): void {
    const now = Date.now();
    for (const [id, request] of this.pending) {
      if (now - request.createdAt > APPROVAL_TIMEOUT_MS) {
        this.pending.delete(id);
        request.resolve(false);
      }
    }
  }
}
