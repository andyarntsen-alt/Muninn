// ═══════════════════════════════════════════════════════════
// MIMIR — Proactive Messaging System
// A raven that speaks first — because true partners don't
// just wait to be asked
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MimirConfig, RelationshipPhase } from '../core/types.js';
import { generateCheapResponse } from '../core/llm.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { SoulManager } from '../identity/soul-manager.js';
import type { ReminderStore } from '../tools/reminders.js';
import type { TaskStore } from '../tools/tasks.js';

export interface ProactiveMessage {
  text: string;
  trigger: ProactiveTrigger;
  priority: 'low' | 'medium' | 'high';
}

export type ProactiveTrigger =
  | 'morning_greeting'
  | 'reminder_due'
  | 'follow_up'
  | 'check_in'
  | 'insight'
  | 'task_nudge'
  | 'discovery';

interface ProactiveState {
  lastGreeting: string | null;
  lastCheckIn: string | null;
  lastFollowUp: string | null;
  lastTaskNudge: string | null;
  lastInsight: string | null;
  lastDiscovery: string | null;
  suppressUntil: string | null;
  proactivesSent: number;
  consecutiveIgnored: number;
}

/**
 * Proactive Messaging — Mimir reaches out first.
 *
 * Active from day one:
 *   Morning greetings, check-ins after 48h silence,
 *   task nudges, and insight messages connecting facts.
 *
 * Use /quiet to suppress when you need space.
 */
export class ProactiveEngine {
  private config: MimirConfig;
  private memory: MemoryEngine;
  private soul: SoulManager;
  private reminderStore: ReminderStore;
  private taskStore: TaskStore;
  private state: ProactiveState;
  private statePath: string;

  constructor(
    config: MimirConfig,
    memory: MemoryEngine,
    soul: SoulManager,
    reminderStore: ReminderStore,
    taskStore: TaskStore,
  ) {
    this.config = config;
    this.memory = memory;
    this.soul = soul;
    this.reminderStore = reminderStore;
    this.taskStore = taskStore;
    this.statePath = join(config.dataDir, 'proactive-state.json');
    this.state = {
      lastGreeting: null,
      lastCheckIn: null,
      lastFollowUp: null,
      lastTaskNudge: null,
      lastInsight: null,
      lastDiscovery: null,
      suppressUntil: null,
      proactivesSent: 0,
      consecutiveIgnored: 0,
    };
  }

  async initialize(): Promise<void> {
    if (existsSync(this.statePath)) {
      try {
        const content = await readFile(this.statePath, 'utf-8');
        this.state = JSON.parse(content);
      } catch {
        // Use defaults
      }
    }
  }

  /** Check if proactive messaging is available — needs minimum engagement */
  private async isAvailable(): Promise<boolean> {
    const soul = await this.soul.getSoul();
    // Require at least 5 interactions before any proactive messaging
    return soul.interactionCount >= 5;
  }

  /** Check if messages are suppressed */
  private isSuppressed(): boolean {
    if (!this.state.suppressUntil) return false;
    return new Date(this.state.suppressUntil) > new Date();
  }

  /** Check if it's quiet hours (22:00-08:00) — don't message at night */
  private isQuietHours(): boolean {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 8;
  }

  /** Generate pending proactive messages */
  async checkForMessages(): Promise<ProactiveMessage[]> {
    if (!(await this.isAvailable())) return [];
    if (this.isSuppressed()) return [];
    if (this.isQuietHours()) return [];

    const backoff = this.getBackoffMultiplier();
    if (backoff === 0) return []; // Too many ignored — stop until user initiates

    const messages: ProactiveMessage[] = [];
    const now = new Date();

    // 1. Morning greeting (once per day, 7-10 AM, after 3+ days of use)
    const hour = now.getHours();
    const soul = await this.soul.getSoul();
    const daysActive = (now.getTime() - new Date(soul.phaseStartedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (hour >= 7 && hour <= 10 && daysActive >= 3) {
      const today = now.toISOString().split('T')[0];
      if (this.state.lastGreeting !== today) {
        const greeting = await this.generateMorningGreeting();
        if (greeting) {
          messages.push({
            text: greeting,
            trigger: 'morning_greeting',
            priority: 'low',
          });
          this.state.lastGreeting = today;
        }
      }
    }

    // 2. Task nudge (if high-priority tasks exist)
    const tasks = await this.taskStore.getActive();
    const highPriority = tasks.filter(t => t.priority === 'high');
    if (highPriority.length > 0) {
      const lastNudge = this.state.lastTaskNudge
        ? new Date(this.state.lastTaskNudge)
        : new Date(0);
      const hoursSinceNudge = (now.getTime() - lastNudge.getTime()) / (1000 * 60 * 60);

      if (hoursSinceNudge > 8 * backoff) {
        const taskNames = highPriority.map(t => t.description).join(', ');
        messages.push({
          text: `Påminnelse: du har ${highPriority.length} viktig${highPriority.length > 1 ? 'e' : ''} oppgave${highPriority.length > 1 ? 'r' : ''}: ${taskNames}`,
          trigger: 'task_nudge',
          priority: 'medium',
        });
        this.state.lastTaskNudge = now.toISOString();
      }
    }

    // 3. Check-in after silence (48h)
    const silenceThreshold = 48;
    const recentConvos = await this.memory.getConversations(1);
    if (recentConvos.length > 0) {
      const lastConvo = recentConvos[0];
      const lastMsg = lastConvo.messages[lastConvo.messages.length - 1];
      if (lastMsg) {
        const hoursSinceLastMsg = (now.getTime() - new Date(lastMsg.timestamp).getTime()) / (1000 * 60 * 60);
        const lastCheckIn = this.state.lastCheckIn
          ? new Date(this.state.lastCheckIn)
          : new Date(0);
        const hoursSinceCheckIn = (now.getTime() - lastCheckIn.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg > silenceThreshold * backoff && hoursSinceCheckIn > silenceThreshold * backoff) {
          const checkIn = await this.generateCheckIn();
          if (checkIn) {
            messages.push({
              text: checkIn,
              trigger: 'check_in',
              priority: 'low',
            });
            this.state.lastCheckIn = now.toISOString();
          }
        }
      }
    }

    // 4. Insight message (share connections between facts)
    const insight = await this.generateInsight();
    if (insight) {
      messages.push({
        text: insight,
        trigger: 'insight',
        priority: 'low',
      });
    }

    // 5. Discovery (search web for things related to user's interests)
    const discovery = await this.generateDiscovery();
    if (discovery) {
      messages.push({
        text: discovery,
        trigger: 'discovery',
        priority: 'low',
      });
    }

    // Save state
    await this.saveState();

    // Only send ONE message per check — pick the highest priority
    if (messages.length > 1) {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      messages.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
      this.recordProactiveSent();
      return [messages[0]];
    }

    if (messages.length === 1) {
      this.recordProactiveSent();
    }

    return messages;
  }

  /** Generate a morning greeting with context */
  private async generateMorningGreeting(): Promise<string | null> {
    try {
      const soul = await this.soul.getSoul();
      const facts = await this.memory.getRecentFacts(10);
      const tasks = await this.taskStore.getActive();
      const reminders = await this.reminderStore.getActive();

      const context = [];
      if (facts.length > 0) {
        context.push(`Known facts: ${facts.slice(0, 5).map(f => `${f.subject} ${f.predicate} ${f.object}`).join('; ')}`);
      }
      if (tasks.length > 0) {
        context.push(`Active tasks: ${tasks.slice(0, 3).map(t => t.description).join(', ')}`);
      }
      if (reminders.length > 0) {
        const todayReminders = reminders.filter(r => {
          const trigger = new Date(r.triggerAt);
          const today = new Date();
          return trigger.toDateString() === today.toDateString();
        });
        if (todayReminders.length > 0) {
          context.push(`Today's reminders: ${todayReminders.map(r => r.text).join(', ')}`);
        }
      }

      const lang = this.config.language === 'no' ? 'Write in Norwegian.' : 'Write in English.';
      const text = await generateCheapResponse({
        prompt: `You are ${soul.name}. Generate a brief, warm morning greeting for your human.
${context.length > 0 ? `\nContext:\n${context.join('\n')}` : ''}

Keep it to 1-2 sentences. Be natural, not performative. Reference something relevant if you can.
Don't be generic — make it feel personal based on what you know.
If there's nothing specific to reference, keep it very short.
${lang}`,
      });

      return text || null;
    } catch {
      return null;
    }
  }

  /** Generate a check-in message after silence */
  private async generateCheckIn(): Promise<string | null> {
    try {
      const soul = await this.soul.getSoul();
      const summaries = await this.memory.getConversationSummaries(3);

      const lang = this.config.language === 'no' ? 'Write in Norwegian.' : 'Write in English.';
      const text = await generateCheapResponse({
        prompt: `You are ${soul.name}. It's been a couple of days since you last talked to your human.
${summaries.length > 0 ? `\nRecent conversation topics: ${summaries.join('; ')}` : ''}

Generate a brief, natural check-in. Don't be clingy. Just a quick touch-base.
Keep it to 1 sentence. Be warm but not needy.
${lang}`,
      });

      return text || null;
    } catch {
      return null;
    }
  }

  /** Generate an insight message by connecting facts */
  private async generateInsight(): Promise<string | null> {
    try {
      const soul = await this.soul.getSoul();
      const facts = await this.memory.getRecentFacts(30);
      if (facts.length < 10) return null; // Need enough facts to find connections

      // Only send insights occasionally (max once per 3 days)
      const lastInsightTime = this.state.lastInsight
        ? new Date(this.state.lastInsight)
        : new Date(0);
      const daysSinceInsight = (Date.now() - lastInsightTime.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceInsight < 3 * this.getBackoffMultiplier()) return null;

      const lang = this.config.language === 'no' ? 'Write in Norwegian.' : 'Write in English.';
      const text = await generateCheapResponse({
        prompt: `You are ${soul.name}. Look at these facts about your human and find an interesting connection, pattern, or observation that they might not have noticed themselves.

Facts:
${facts.map(f => `- ${f.subject} ${f.predicate} ${f.object}`).join('\n')}

Rules:
- Only share if you find a genuinely interesting connection
- Keep it to 1-2 sentences
- Be natural, not analytical
- Frame it as a thought, not a report
- If nothing interesting connects, respond with just "NONE"
- ${lang}

Example: "Jeg la merke til at du nevnte stress rundt deadlines forrige uke, og nå jobber du sent igjen. Alt bra?"
Example: "Du snakker mye om prosjektet ditt i det siste. Virker som det betyr mye for deg."`,
      });

      if (!text || text.trim().toUpperCase() === 'NONE') return null;
      this.state.lastInsight = new Date().toISOString();
      return text;
    } catch {
      return null;
    }
  }

  /** Search for interesting things related to user's interests */
  private async generateDiscovery(): Promise<string | null> {
    // TODO: Wire up to actual web_search tool — disabled because it was
    // generating hallucinated "discoveries" without doing real searches
    return null;
  }

  /** Get backoff multiplier based on ignored messages */
  private getBackoffMultiplier(): number {
    const ignored = this.state.consecutiveIgnored;
    if (ignored >= 10) return 0; // Stop entirely
    if (ignored >= 6) return 4;
    if (ignored >= 3) return 2;
    return 1;
  }

  /** Record that the user responded — resets backoff */
  async recordUserResponse(): Promise<void> {
    if (this.state.consecutiveIgnored > 0) {
      this.state.consecutiveIgnored = 0;
      await this.saveState();
    }
  }

  /** Record that a proactive message was sent */
  private recordProactiveSent(): void {
    this.state.proactivesSent++;
    this.state.consecutiveIgnored++;
  }

  /** Suppress proactive messages for a duration */
  async suppress(hours: number): Promise<void> {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000);
    this.state.suppressUntil = until.toISOString();
    await this.saveState();
  }

  private async saveState(): Promise<void> {
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }
}
