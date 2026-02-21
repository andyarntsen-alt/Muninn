// ═══════════════════════════════════════════════════════════
// MUNINN — Reminders Tool
// A raven that remembers and nudges at the right time
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Tool } from '../core/types.js';

export interface Reminder {
  id: string;
  text: string;
  triggerAt: string; // ISO datetime
  createdAt: string;
  completed: boolean;
  notified: boolean;
}

/**
 * Reminder system — file-based, persistent.
 * Stores reminders in a JSON file and checks them periodically.
 */
export class ReminderStore {
  private filePath: string;
  private reminders: Reminder[] = [];

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'reminders.json');
  }

  async initialize(): Promise<void> {
    const dir = join(this.filePath, '..');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await this.load();
  }

  private async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.reminders = [];
      return;
    }
    try {
      const content = await readFile(this.filePath, 'utf-8');
      this.reminders = JSON.parse(content);
    } catch {
      this.reminders = [];
    }
  }

  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.reminders, null, 2), 'utf-8');
  }

  async add(text: string, triggerAt: Date): Promise<Reminder> {
    const reminder: Reminder = {
      id: nanoid(),
      text,
      triggerAt: triggerAt.toISOString(),
      createdAt: new Date().toISOString(),
      completed: false,
      notified: false,
    };
    this.reminders.push(reminder);
    await this.save();
    return reminder;
  }

  async getActive(): Promise<Reminder[]> {
    return this.reminders.filter(r => !r.completed);
  }

  async getDue(): Promise<Reminder[]> {
    const now = new Date();
    return this.reminders.filter(
      r => !r.completed && !r.notified && new Date(r.triggerAt) <= now
    );
  }

  async markNotified(id: string): Promise<void> {
    const reminder = this.reminders.find(r => r.id === id);
    if (reminder) {
      reminder.notified = true;
      await this.save();
    }
  }

  async complete(id: string): Promise<void> {
    const reminder = this.reminders.find(r => r.id === id);
    if (reminder) {
      reminder.completed = true;
      await this.save();
    }
  }
}

/** Create the reminder tools */
export function createReminderTools(store: ReminderStore): Tool[] {
  return [
    {
      name: 'set_reminder',
      description: 'Set a reminder for the user. Parse natural language dates like "tomorrow at 3pm", "in 2 hours", "next Monday".',
      parameters: {
        text: { type: 'string', description: 'What to remind about' },
        when: { type: 'string', description: 'When to remind (ISO datetime string)' },
      },
      execute: async (args) => {
        const text = args.text as string;
        const when = args.when as string;
        if (!text || !when) return 'Need both text and time for a reminder.';

        try {
          const triggerAt = new Date(when);
          if (isNaN(triggerAt.getTime())) {
            return 'Could not parse that date. Try a specific format like "2025-03-15T14:00:00".';
          }

          const reminder = await store.add(text, triggerAt);
          return `✅ Reminder set: "${text}" at ${triggerAt.toLocaleString()}`;
        } catch (error) {
          return `Failed to set reminder: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      },
    },
    {
      name: 'list_reminders',
      description: 'Show all active reminders.',
      parameters: {},
      execute: async () => {
        const reminders = await store.getActive();
        if (reminders.length === 0) return 'No active reminders.';

        return reminders.map(r =>
          `• ${r.text} — ${new Date(r.triggerAt).toLocaleString()}${r.notified ? ' (notified)' : ''}`
        ).join('\n');
      },
    },
  ];
}
