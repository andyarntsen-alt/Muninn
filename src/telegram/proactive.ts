// ═══════════════════════════════════════════════════════════
// MUNINN — Proactive Messaging System
// A raven that speaks first — because true partners don't
// just wait to be asked
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MuninnConfig, RelationshipPhase } from '../core/types.js';
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
  | 'task_nudge';

interface ProactiveState {
  lastGreeting: string | null;
  lastCheckIn: string | null;
  lastFollowUp: string | null;
  suppressUntil: string | null;
}

/**
 * Proactive Messaging — Muninn reaches out first.
 *
 * Only available in UNDERSTANDING and PROACTIVE phases.
 * In earlier phases, Muninn only responds when spoken to.
 *
 * Types of proactive messages:
 * 1. Morning greetings (with relevant context)
 * 2. Reminder notifications
 * 3. Follow-ups on things discussed
 * 4. Check-ins during quiet periods
 * 5. Insights from reflection
 * 6. Task nudges
 */
export class ProactiveEngine {
  private config: MuninnConfig;
  private memory: MemoryEngine;
  private soul: SoulManager;
  private reminderStore: ReminderStore;
  private taskStore: TaskStore;
  private state: ProactiveState;
  private statePath: string;

  constructor(
    config: MuninnConfig,
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
    const soul = await this.soul.getSoul();
    const phase = soul.relationshipPhase;
    // Only proactive in later phases
    return phase === 'understanding' || phase === 'proactive';
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

    // 1. Morning greeting (once per day, between 7-10 AM)
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

    // 2. Task nudge (if there are high-priority tasks)
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
          text: `🔴 Reminder: you have ${highPriority.length} high-priority task${highPriority.length > 1 ? 's' : ''}: ${taskNames}`,
          trigger: 'task_nudge',
          priority: 'medium',
        });
        this.state.lastFollowUp = now.toISOString();
      }
    }

    // 3. Check-in after silence (if no conversation for 48+ hours)
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

        if (hoursSinceLastMsg > 48 && hoursSinceCheckIn > 48) {
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

    // Save state
    await this.saveState();

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

      const text = await generateCheapResponse({
        prompt: `You are ${soul.name}. Generate a brief, warm morning greeting for your human.
${context.length > 0 ? `\nContext:\n${context.join('\n')}` : ''}

Keep it to 1-2 sentences. Be natural, not performative. Reference something relevant if you can.
Don't be generic — make it feel personal based on what you know.
If there's nothing specific to reference, keep it very short.`,
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

      const text = await generateCheapResponse({
        prompt: `You are ${soul.name}. It's been a couple of days since you last talked to your human.
${summaries.length > 0 ? `\nRecent conversation topics: ${summaries.join('; ')}` : ''}

Generate a brief, natural check-in. Don't be clingy. Just a quick touch-base.
Keep it to 1 sentence. Be warm but not needy.`,
      });

      return text || null;
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
