// ═══════════════════════════════════════════════════════════
// MIMIR — Telegram Bot Interface
// Where the raven meets the human
// The primary interface: a conversation, nothing more
// ═══════════════════════════════════════════════════════════

import { Bot, Context, session, InputFile } from 'grammy';
import { existsSync } from 'node:fs';
import type { MimirConfig } from '../core/types.js';
import type { HuginnRuntime } from '../core/runtime.js';
import type { Reflector } from '../reflection/reflector.js';
import type { SoulManager } from '../identity/soul-manager.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { GoalsManager } from '../identity/goals-manager.js';
import type { ProactiveEngine } from './proactive.js';
import type { ApprovalManager } from './approval.js';

interface SessionData {
  lastActivity: number;
}

/**
 * The Telegram Bot — Mimir's voice in the world.
 *
 * Design philosophy: the interface should disappear.
 * No menus, no buttons (except a few commands).
 * Just talk to your raven.
 */
export class MimirBot {
  private bot: Bot<Context & { session: SessionData }>;
  private runtime: HuginnRuntime;
  private reflector: Reflector;
  private soul: SoulManager;
  private memory: MemoryEngine;
  private goals: GoalsManager;
  private config: MimirConfig;
  private proactive: ProactiveEngine | null = null;
  private approval: ApprovalManager | null = null;
  private conversationTimeouts: Map<number, NodeJS.Timeout> = new Map();

  // Conversation ends after 30 minutes of inactivity
  private static CONVERSATION_TIMEOUT = 30 * 60 * 1000;

  constructor(
    config: MimirConfig,
    runtime: HuginnRuntime,
    reflector: Reflector,
    soul: SoulManager,
    memory: MemoryEngine,
    goals: GoalsManager,
  ) {
    this.config = config;
    this.runtime = runtime;
    this.reflector = reflector;
    this.soul = soul;
    this.memory = memory;
    this.goals = goals;
    this.bot = new Bot<Context & { session: SessionData }>(config.telegramToken);

    this.setupMiddleware();
    this.setupCommands();
    this.setupMessageHandler();
  }

  /** Connect the proactive engine (set after construction to avoid circular deps) */
  setProactiveEngine(engine: ProactiveEngine): void {
    this.proactive = engine;
  }

  /** Connect the approval manager to the bot's callback query system */
  setApprovalManager(manager: ApprovalManager): void {
    this.approval = manager;
    // Pass the raw bot instance so approval can register callback handlers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manager.setBot(this.bot as any);
  }

  /** Set up session middleware */
  private setupMiddleware(): void {
    // Session for tracking activity
    this.bot.use(session({
      initial: (): SessionData => ({
        lastActivity: Date.now(),
      }),
    }));

    // Access control
    this.bot.use(async (ctx, next) => {
      if (this.config.allowedUsers.length > 0) {
        const userId = ctx.from?.id;
        if (!userId || !this.config.allowedUsers.includes(userId)) {
          await ctx.reply('🐦 I only talk to my human. Sorry!');
          return;
        }
      }
      await next();
    });
  }

  /** Set up bot commands */
  private setupCommands(): void {
    // /start — First meeting
    this.bot.command('start', async (ctx) => {
      const soul = await this.soul.getSoul();
      await ctx.reply(
        `🐦 *${soul.name}*\n\n` +
        `${soul.role}\n\n` +
        `I'm in my _${soul.relationshipPhase}_ phase — ` +
        `I'll get to know you over time.\n\n` +
        `Just talk to me. No special commands needed.\n\n` +
        `_Type /help to see what I can do._`,
        { parse_mode: 'Markdown' }
      );
    });

    // /help — Available commands
    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        `🐦 *Commands:*\n\n` +
        `/status — See our relationship status\n` +
        `/soul — See my current identity\n` +
        `/goals — See my current goals\n` +
        `/remember — What I know about you\n` +
        `/reflect — Trigger a reflection cycle\n` +
        `/forget [topic] — Ask me to forget something\n` +
        `/model [name] — See or change the AI model\n` +
        `/quiet [hours] — Mute proactive messages (default: 4h)\n` +
        `/export — Export all your data\n` +
        `/help — This message\n\n` +
        `_Or just talk to me — that's what I'm here for._`,
        { parse_mode: 'Markdown' }
      );
    });

    // /status — Relationship status
    this.bot.command('status', async (ctx) => {
      const relationship = this.reflector.getRelationshipManager();
      const status = await relationship.getRelationshipStatus();
      await ctx.reply(status);
    });

    // /soul — Show current soul
    this.bot.command('soul', async (ctx) => {
      const raw = await this.soul.getRawSoul();
      // Telegram has a 4096 char limit
      const truncated = raw.length > 4000
        ? raw.substring(0, 4000) + '\n\n...(truncated)'
        : raw;
      await ctx.reply(truncated);
    });

    // /goals — Show active goals
    this.bot.command('goals', async (ctx) => {
      const activeGoals = await this.goals.getActiveGoals();
      const allGoals = await this.goals.getGoals();
      const completed = allGoals.filter(g => g.status === 'completed');

      if (activeGoals.length === 0 && completed.length === 0) {
        await ctx.reply('🎯 Ingen mål satt ennå.');
        return;
      }

      let response = '🎯 *Mine mål*\n\n';

      if (activeGoals.length > 0) {
        response += '*Aktive:*\n';
        response += activeGoals.map(g => `• ${g.description}`).join('\n');
        response += '\n';
      }

      if (completed.length > 0) {
        response += `\n*Fullført:* ${completed.length}`;
        const recent = completed.slice(-3);
        response += '\n' + recent.map(g => `• ~${g.description}~`).join('\n');
      }

      await ctx.reply(response, { parse_mode: 'Markdown' });
    });

    // /remember — Show what Mimir remembers
    this.bot.command('remember', async (ctx) => {
      const facts = await this.memory.getRecentFacts(20);
      if (facts.length === 0) {
        await ctx.reply("🐦 I don't have many memories yet. Let's talk more!");
        return;
      }

      const factsText = facts.map(f =>
        `• ${f.subject} ${f.predicate} ${f.object}`
      ).join('\n');

      await ctx.reply(
        `🧠 *What I remember:*\n\n${factsText}\n\n` +
        `_Total facts: ${this.memory.getFactCount()}_`,
        { parse_mode: 'Markdown' }
      );
    });

    // /reflect — Manual reflection trigger
    this.bot.command('reflect', async (ctx) => {
      await ctx.reply('🐦 Let me think about what I\'ve learned...');

      const result = await this.reflector.reflect();

      let response = '🪞 *Reflection complete*\n\n';

      if (result.insights.length > 0) {
        response += '*Insights:*\n';
        response += result.insights.map(i => `• ${i}`).join('\n');
        response += '\n\n';
      }

      if (result.newFacts.length > 0) {
        response += `_Discovered ${result.newFacts.length} new inferences._\n`;
      }

      if (result.updatedSoul) {
        response += `_Soul updated to new version._\n`;
      }

      if (result.phaseTransition) {
        response += `\n🌟 *Phase transition!* ${result.phaseTransition.from} → ${result.phaseTransition.to}\n`;
        response += `_${result.phaseTransition.reason}_`;
      }

      await ctx.reply(response, { parse_mode: 'Markdown' });
    });

    // /forget — Forget a specific topic (proper invalidation)
    this.bot.command('forget', async (ctx) => {
      const topic = ctx.match;
      if (!topic) {
        await ctx.reply('Usage: /forget [topic]\nExample: /forget my ex');
        return;
      }

      const facts = await this.memory.searchFacts(topic);
      if (facts.length === 0) {
        await ctx.reply(`I don't seem to have memories about "${topic}".`);
        return;
      }

      // Show what will be forgotten
      const preview = facts.slice(0, 5).map(f =>
        `• ${f.subject} ${f.predicate} ${f.object}`
      ).join('\n');

      // Invalidate (temporal tombstones — never truly deleted, but hidden)
      const count = await this.memory.invalidateFacts(topic);

      await ctx.reply(
        `🗑 Forgot ${count} memories about "${topic}":\n${preview}` +
        (facts.length > 5 ? `\n...and ${facts.length - 5} more` : '') +
        `\n\n_Your privacy matters. These memories are now inactive._`
      );
    });

    // /stats — Analytics and statistics
    this.bot.command('stats', async (ctx) => {
      const currentSoul = await this.soul.getSoul();
      const allFacts = await this.memory.getAllFacts();
      const activeFacts = allFacts.filter(f => f.invalidAt === null);
      const invalidatedFacts = allFacts.filter(f => f.invalidAt !== null);
      const entities = await this.memory.getEntities();
      const conversations = await this.memory.getConversations(1000);

      const totalMessages = conversations.reduce(
        (sum, c) => sum + c.messages.length, 0
      );

      const firstConvo = conversations.length > 0
        ? conversations.reduce((oldest, c) =>
            new Date(c.startedAt).getTime() < new Date(oldest.startedAt).getTime() ? c : oldest
          )
        : null;
      const daysSinceStart = firstConvo
        ? Math.floor((Date.now() - new Date(firstConvo.startedAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      const sources = activeFacts.reduce((acc, f) => {
        acc[f.source] = (acc[f.source] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const evolution = await this.soul.loadEvolution();

      let stats = `📊 *Mimir Statistics*\n\n`;
      stats += `*Identity:* ${currentSoul.name} v${currentSoul.version}\n`;
      stats += `*Phase:* ${currentSoul.relationshipPhase}\n`;
      stats += `*Evolutions:* ${evolution.length}\n\n`;
      stats += `*Memory:* ${activeFacts.length} facts (${invalidatedFacts.length} forgotten)\n`;
      stats += `*Entities:* ${entities.length}\n`;
      if (Object.keys(sources).length > 0) {
        stats += `*Fact sources:* ${Object.entries(sources).map(([k, v]) => `${k}(${v})`).join(', ')}\n`;
      }
      stats += `\n*Conversations:* ${conversations.length}\n`;
      stats += `*Messages:* ${totalMessages}\n`;
      stats += `*Interactions:* ${currentSoul.interactionCount}\n`;
      stats += `*Days active:* ${daysSinceStart}\n`;

      if (currentSoul.interactionCount > 0 && daysSinceStart > 0) {
        stats += `*Avg/day:* ${(currentSoul.interactionCount / daysSinceStart).toFixed(1)}`;
      }

      await ctx.reply(stats, { parse_mode: 'Markdown' });
    });

    // /model — View or change the AI model
    this.bot.command('model', async (ctx) => {
      const newModel = ctx.match?.trim();

      const availableModels = [
        { id: 'claude-opus-4-20250514', label: 'Opus 4' },
        { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
        { id: 'claude-opus-4-6-20250124', label: 'Opus 4.6' },
        { id: 'claude-sonnet-4-6-20250627', label: 'Sonnet 4.6' },
        { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
      ];

      if (!newModel) {
        const modelList = availableModels.map(m => {
          const active = this.config.model === m.id ? ' ✅' : '';
          return `\`${m.id}\`  (${m.label})${active}`;
        }).join('\n');

        await ctx.reply(
          `🧠 *Aktiv modell:* \`${this.config.model}\`\n\n` +
          `*Tilgjengelige modeller:*\n${modelList}\n\n` +
          `Bruk: /model <modellnavn>`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const oldModel = this.config.model;
      this.config.model = newModel;
      const match = availableModels.find(m => m.id === newModel);
      const label = match ? ` (${match.label})` : '';
      console.log(`[Bot] Model changed: ${oldModel} → ${newModel}`);
      await ctx.reply(`✅ Modell byttet til \`${newModel}\`${label}`, { parse_mode: 'Markdown' });
    });

    // /quiet — Suppress proactive messages
    this.bot.command('quiet', async (ctx) => {
      if (!this.proactive) {
        await ctx.reply('Proactive messaging is not configured.');
        return;
      }

      const hoursStr = ctx.match?.trim();
      const hours = hoursStr ? parseInt(hoursStr, 10) : 4; // default 4 hours

      if (isNaN(hours) || hours < 1 || hours > 168) {
        await ctx.reply('Usage: /quiet [hours]\nExample: /quiet 8\nRange: 1–168 (max 1 week). Default: 4 hours.');
        return;
      }

      await this.proactive.suppress(hours);

      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      const timeStr = until.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
      await ctx.reply(
        `🤫 Going quiet for ${hours} hour${hours > 1 ? 's' : ''} (until ${timeStr}).\n` +
        `I'll still respond if you message me — I just won't reach out first.`
      );
    });

    // /export — Export all data
    this.bot.command('export', async (ctx) => {
      await ctx.reply('📦 Preparing your data export...');
      const data = await this.memory.exportAll();
      const json = JSON.stringify(data, null, 2);

      // Send as a document using grammY InputFile
      const buffer = Buffer.from(json, 'utf-8');
      await ctx.replyWithDocument(
        new InputFile(buffer, `mimir-export-${new Date().toISOString().split('T')[0]}.json`)
      );

      await ctx.reply(
        `✅ Export complete.\n` +
        `• ${data.facts.length} facts\n` +
        `• ${data.entities.length} entities\n` +
        `• ${data.conversations.length} conversations\n\n` +
        `_This is YOUR data. Do with it what you want._`
      );
    });
  }

  /** Set up the main message handler */
  private setupMessageHandler(): void {
    this.bot.on('message:text', async (ctx) => {
      const userId = ctx.from.id;
      const text = ctx.message.text;

      // Check if this is a yes/no response to a pending approval
      // Must happen BEFORE normal message processing
      if (this.approval && this.approval.handleTextResponse(userId, text)) {
        return; // Message was consumed by the approval system
      }

      // User responded — reset proactive backoff
      if (this.proactive) {
        this.proactive.recordUserResponse().catch(() => {});
      }

      // Show typing indicator (refresh every 4s — Telegram's indicator expires after 5s)
      await ctx.replyWithChatAction('typing');
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction('typing').catch(() => {});
      }, 4000);

      // Reset conversation timeout
      this.resetConversationTimeout(userId);

      try {
        // Process through the runtime
        const response = await this.runtime.processMessage(
          text,
          userId.toString(),
          async (progressText) => {
            await ctx.reply(progressText);
          },
        );

        // Check if response contains screenshot paths — send as photos
        const screenshotRegex = /SCREENSHOT:([^\s]+)/g;
        let cleanResponse = response;
        let match;
        while ((match = screenshotRegex.exec(response)) !== null) {
          const screenshotPath = match[1];
          if (existsSync(screenshotPath)) {
            try {
              await ctx.replyWithPhoto(new InputFile(screenshotPath), {
                caption: '📸 Skjermbilde',
              });
            } catch (err) {
              console.error('[Bot] Failed to send screenshot:', err);
            }
          }
          cleanResponse = cleanResponse.replace(match[0], '').trim();
        }

        // Remove SCREENSHOT_FAILED markers
        cleanResponse = cleanResponse.replace(/SCREENSHOT_FAILED:[^\n]*/g, '').trim();

        // Send text response (handle long messages)
        if (cleanResponse.length > 0) {
          if (cleanResponse.length > 4096) {
            const chunks = this.splitMessage(cleanResponse, 4096);
            for (const chunk of chunks) {
              await ctx.reply(chunk);
            }
          } else {
            await ctx.reply(cleanResponse);
          }
        }

        // Maybe trigger reflection
        await this.runtime.maybeReflect();
      } catch (error) {
        console.error('[Bot] Error processing message:', error);
        await ctx.reply('🐦 I had trouble processing that. Let me try again in a moment.');
      } finally {
        clearInterval(typingInterval);
      }
    });

    // Handle photos — download and process with vision
    this.bot.on('message:photo', async (ctx) => {
      const userId = ctx.from.id;
      await ctx.replyWithChatAction('typing');
      this.resetConversationTimeout(userId);

      try {
        // Get the largest photo (last in array)
        const photos = ctx.message.photo;
        const largest = photos[photos.length - 1];
        const file = await ctx.api.getFile(largest.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.config.telegramToken}/${file.file_path}`;

        // Download the image
        const imageResponse = await fetch(fileUrl);
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const base64Image = imageBuffer.toString('base64');
        const mimeType = file.file_path?.endsWith('.png') ? 'image/png' : 'image/jpeg';

        // Build a message with the image for the runtime
        const caption = ctx.message.caption || 'Brukeren sendte dette bildet. Beskriv hva du ser, eller svar på det de spør om.';
        const imageMessage = `[BILDE VEDLAGT: data:${mimeType};base64,${base64Image}]\n\n${caption}`;

        const response = await this.runtime.processMessage(imageMessage, userId.toString());

        if (response.length > 4096) {
          const chunks = this.splitMessage(response, 4096);
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        } else {
          await ctx.reply(response);
        }
      } catch (error) {
        console.error('[Bot] Error processing photo:', error);
        await ctx.reply('🐦 Beklager, jeg klarte ikke å se på bildet. Kan du prøve igjen?');
      }
    });

    // Handle voice messages — transcribe with Whisper
    this.bot.on('message:voice', async (ctx) => {
      const userId = ctx.from.id;
      await ctx.replyWithChatAction('typing');
      this.resetConversationTimeout(userId);

      try {
        const file = await ctx.api.getFile(ctx.message.voice.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.config.telegramToken}/${file.file_path}`;

        // Download voice file
        const voiceResponse = await fetch(fileUrl);
        const voiceBuffer = Buffer.from(await voiceResponse.arrayBuffer());

        // Save temporarily and transcribe with whisper
        const { writeFile, unlink } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);

        const tmpPath = join(this.config.dataDir, 'voice-tmp.ogg');
        await writeFile(tmpPath, voiceBuffer);

        // Try whisper (must be installed: brew install whisper-cpp or pip install openai-whisper)
        let transcription = '';
        try {
          // Try openai whisper CLI first
          const { stdout } = await execAsync(
            `whisper "${tmpPath}" --model tiny --language Norwegian --output_format txt --output_dir "${this.config.dataDir}" 2>/dev/null`,
            { timeout: 30_000 }
          );
          const txtPath = tmpPath.replace('.ogg', '.txt');
          const { readFile } = await import('node:fs/promises');
          try {
            transcription = await readFile(txtPath, 'utf-8');
            await unlink(txtPath).catch(() => {});
          } catch {
            transcription = stdout.trim();
          }
        } catch {
          // Fallback: try macOS say/dictation or just inform user
          try {
            // Try with whisper.cpp if installed
            const { stdout } = await execAsync(
              `which whisper-cpp >/dev/null 2>&1 && whisper-cpp -m /usr/local/share/whisper-cpp/models/ggml-tiny.bin -l no -f "${tmpPath}" 2>/dev/null || echo "WHISPER_NOT_FOUND"`,
              { timeout: 30_000 }
            );
            if (!stdout.includes('WHISPER_NOT_FOUND')) {
              transcription = stdout.trim();
            }
          } catch {
            // Whisper not available
          }
        }

        await unlink(tmpPath).catch(() => {});

        if (transcription) {
          // Process the transcribed text through the runtime
          const response = await this.runtime.processMessage(
            `[Talemelding transkribert]: ${transcription}`,
            userId.toString()
          );

          await ctx.reply(response);
        } else {
          await ctx.reply(
            '🐦 Jeg hørte talemeldingen din, men har ikke Whisper installert for å transkribere den ennå.\n\n' +
            'For å aktivere: `brew install openai-whisper` eller `pip install openai-whisper`\n\n' +
            'Kan du skrive det du sa i stedet?'
          );
        }
      } catch (error) {
        console.error('[Bot] Error processing voice:', error);
        await ctx.reply('🐦 Beklager, jeg klarte ikke å lytte til det. Kan du skrive det i stedet?');
      }
    });
  }

  /** Split a message into chunks */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good split point (paragraph or sentence boundary)
      let splitAt = remaining.lastIndexOf('\n\n', maxLength);
      if (splitAt === -1) splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1) splitAt = remaining.lastIndexOf('. ', maxLength);
      if (splitAt === -1) splitAt = maxLength;

      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
  }

  /** Reset the conversation timeout for a user */
  private resetConversationTimeout(userId: number): void {
    const existing = this.conversationTimeouts.get(userId);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(async () => {
      await this.runtime.endConversation();
      this.conversationTimeouts.delete(userId);
    }, MimirBot.CONVERSATION_TIMEOUT);

    this.conversationTimeouts.set(userId, timeout);
  }

  /** Start the bot */
  async start(): Promise<void> {
    const soul = await this.soul.getSoul();
    console.log(`[Bot] ${soul.name} is taking flight...`);
    console.log(`[Bot] Relationship phase: ${soul.relationshipPhase}`);
    console.log(`[Bot] Interactions: ${soul.interactionCount}`);
    console.log(`[Bot] Facts remembered: ${this.memory.getFactCount()}`);

    // Validate bot token by calling getMe first
    try {
      const me = await this.bot.api.getMe();
      console.log(`[Bot] Connected as @${me.username} (${me.first_name})`);
    } catch (error: any) {
      const code = error?.error_code || error?.statusCode || '';
      if (code === 404 || code === 401) {
        console.error('\n❌ Telegram bot-tokenet er ugyldig eller utløpt.');
        console.error('   Slik fikser du det:');
        console.error('   1. Åpne Telegram og send melding til @BotFather');
        console.error('   2. Send /mybots og velg boten din');
        console.error('   3. Velg "API Token" for å se eller generere nytt token');
        console.error('   4. Oppdater tokenet i ~/.mimir/config.yaml');
        console.error('   5. Kjør mimir start på nytt\n');
      } else {
        console.error(`\n❌ Kunne ikke koble til Telegram: ${error?.message || error}`);
        console.error('   Sjekk internettforbindelsen og prøv igjen.\n');
      }
      process.exit(1);
    }

    // Set bot commands for Telegram UI
    try {
      await this.bot.api.setMyCommands([
        { command: 'start', description: 'Start talking to Mimir' },
        { command: 'status', description: 'See our relationship status' },
        { command: 'stats', description: 'Analytics and statistics' },
        { command: 'soul', description: 'See my identity' },
        { command: 'goals', description: 'See my current goals' },
        { command: 'remember', description: 'What I remember about you' },
        { command: 'reflect', description: 'Trigger a reflection' },
        { command: 'forget', description: 'Ask me to forget something' },
        { command: 'model', description: 'See or change the AI model' },
        { command: 'quiet', description: 'Mute proactive messages for N hours' },
        { command: 'export', description: 'Export all your data' },
        { command: 'help', description: 'Show available commands' },
      ]);
    } catch (error) {
      console.warn('[Bot] Could not set bot commands (non-fatal):', (error as Error).message);
    }

    this.bot.start({
      onStart: () => {
        console.log('[Bot] 🐦 Mimir is online and listening.');
      },
    });
  }

  /** Send a message to a specific user (for reminders, proactive messaging) */
  async sendMessage(userId: number, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(userId, text, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`[Bot] Failed to send message to ${userId}:`, error);
    }
  }

  /** Stop the bot gracefully */
  async stop(): Promise<void> {
    // End any active conversations
    await this.runtime.endConversation();

    // Clear timeouts
    for (const timeout of this.conversationTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.conversationTimeouts.clear();

    this.bot.stop();
    console.log('[Bot] 🐦 Mimir has landed.');
  }
}
