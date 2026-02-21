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
  lastDiscovery: string | null;
  suppressUntil: string | null;
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
      lastDiscovery: null,
      suppressUntil: null,
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

  /** Check if proactive messaging is available for current phase */
  private async isAvailable(): Promise<boolean> {
    // Always available — Mimir reaches out from day one
    return true;
  }

  /** Check if messages are suppressed */
  private isSuppressed(): boolean {
    if (!this.state.suppressUntil) return false;
    return new Date(this.state.suppressUntil) > new Date();
  }

  /** Generate pending proactive messages */
  async checkForMessages(): Promise<ProactiveMessage[]> {
    if (!(await this.isAvailable())) return [];
    if (this.isSuppressed()) return [];

    const messages: ProactiveMessage[] = [];
    const now = new Date();

    // 1. Morning greeting (once per day, 7-10 AM)
    const hour = now.getHours();
    if (hour >= 7 && hour <= 10) {
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
      const lastNudge = this.state.lastFollowUp
        ? new Date(this.state.lastFollowUp)
        : new Date(0);
      const hoursSinceNudge = (now.getTime() - lastNudge.getTime()) / (1000 * 60 * 60);

      if (hoursSinceNudge > 8) {
        const taskNames = highPriority.map(t => t.description).join(', ');
        messages.push({
          text: `Påminnelse: du har ${highPriority.length} viktig${highPriority.length > 1 ? 'e' : ''} oppgave${highPriority.length > 1 ? 'r' : ''}: ${taskNames}`,
          trigger: 'task_nudge',
          priority: 'medium',
        });
        this.state.lastFollowUp = now.toISOString();
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

        if (hoursSinceLastMsg > silenceThreshold && hoursSinceCheckIn > silenceThreshold) {
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

    return messages;
  }

  /** Get SOUL.md content — personality drives all behavior */
  private async getSoulContext(): Promise<string> {
    return this.soul.getRawSoul();
  }

  /** Generate a morning greeting with context */
  private async generateMorningGreeting(): Promise<string | null> {
    try {
      const soulContext = await this.getSoulContext();
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

      const text = await generateCheapResponse({
        prompt: `Here is who you are:\n\n${soulContext}\n\nGenerate a morning greeting for your human.
${context.length > 0 ? `\nContext:\n${context.join('\n')}` : ''}

Keep it to 1-2 sentences. Reference something relevant if you can.`,
      });

      return text || null;
    } catch {
      return null;
    }
  }

  /** Generate a check-in message after silence */
  private async generateCheckIn(): Promise<string | null> {
    try {
      const soulContext = await this.getSoulContext();
      const summaries = await this.memory.getConversationSummaries(3);

      const text = await generateCheapResponse({
        prompt: `Here is who you are:\n\n${soulContext}\n\nIt's been a couple of days since you last talked to your human.
${summaries.length > 0 ? `\nRecent conversation topics: ${summaries.join('; ')}` : ''}

Generate a brief, natural check-in. Keep it to 1 sentence.`,
      });

      return text || null;
    } catch {
      return null;
    }
  }

  /** Generate an insight message by connecting facts */
  private async generateInsight(): Promise<string | null> {
    try {
      const soulContext = await this.getSoulContext();
      const facts = await this.memory.getRecentFacts(30);
      if (facts.length < 10) return null;

      // Only send insights occasionally (max once per 3 days)
      const lastInsight = this.state.lastFollowUp
        ? new Date(this.state.lastFollowUp)
        : new Date(0);
      const daysSinceInsight = (Date.now() - lastInsight.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceInsight < 3) return null;

      const text = await generateCheapResponse({
        prompt: `Here is who you are:\n\n${soulContext}\n\nLook at these facts about your human and find an interesting connection or pattern they might not have noticed.

Facts:
${facts.map(f => `- ${f.subject} ${f.predicate} ${f.object}`).join('\n')}

Keep it to 1-2 sentences. If nothing interesting connects, respond with just "NONE".`,
      });

      if (!text || text.trim().toUpperCase() === 'NONE') return null;
      return text;
    } catch {
      return null;
    }
  }

  /** Search for interesting things related to user's interests */
  private async generateDiscovery(): Promise<string | null> {
    try {
      // Only search occasionally (max once per 2 days)
      const lastDiscovery = this.state.lastDiscovery
        ? new Date(this.state.lastDiscovery)
        : new Date(0);
      const daysSince = (Date.now() - lastDiscovery.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 2) return null;

      const facts = await this.memory.getRecentFacts(30);
      if (facts.length < 5) return null;

      const topicResponse = await generateCheapResponse({
        prompt: `Based on these facts about your human, pick ONE specific topic to search for that they would genuinely find interesting.

Facts:
${facts.map(f => `- ${f.subject} ${f.predicate} ${f.object}`).join('\n')}

Respond with JUST the search query (3-6 words), nothing else. If no good topic exists, respond "NONE".`,
      });

      if (!topicResponse || topicResponse.trim().toUpperCase() === 'NONE') return null;
      const searchTopic = topicResponse.trim();

      const soulContext = await this.getSoulContext();
      const text = await generateCheapResponse({
        prompt: `Here is who you are:\n\n${soulContext}\n\nYou found something interesting about "${searchTopic}" because you know your human cares about this.

Write a short message (1-3 sentences) sharing it naturally, like a friend who found something cool.`,
      });

      if (!text) return null;
      this.state.lastDiscovery = new Date().toISOString();
      return text;
    } catch {
      return null;
    }
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
