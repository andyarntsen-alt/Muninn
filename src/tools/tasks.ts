// ═══════════════════════════════════════════════════════════
// MUNINN — Tasks Tool
// A raven that tracks what needs doing
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Tool, Goal } from '../core/types.js';

/**
 * Task/Goal store — file-based, persistent.
 * Uses the Goal interface from core types.
 */
export class TaskStore {
  private filePath: string;
  private tasks: Goal[] = [];

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'tasks.json');
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
      this.tasks = [];
      return;
    }
    try {
      const content = await readFile(this.filePath, 'utf-8');
      this.tasks = JSON.parse(content);
    } catch {
      this.tasks = [];
    }
  }

  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.tasks, null, 2), 'utf-8');
  }

  async add(description: string, priority: Goal['priority'] = 'medium'): Promise<Goal> {
    const task: Goal = {
      id: nanoid(),
      description,
      priority,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    await this.save();
    return task;
  }

  async complete(idOrDescription: string): Promise<Goal | null> {
    const task = this.tasks.find(t =>
      t.id === idOrDescription ||
      t.description.toLowerCase().includes(idOrDescription.toLowerCase())
    );
    if (!task) return null;

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    await this.save();
    return task;
  }

  async getActive(): Promise<Goal[]> {
    return this.tasks
      .filter(t => t.status === 'active')
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

  async getAll(): Promise<Goal[]> {
    return [...this.tasks];
  }
}

/** Create task management tools */
export function createTaskTools(store: TaskStore): Tool[] {
  return [
    {
      name: 'add_task',
      description: 'Add a task or goal to the user\'s list.',
      parameters: {
        description: { type: 'string', description: 'What needs to be done' },
        priority: { type: 'string', description: 'Priority: high, medium, or low' },
      },
      execute: async (args) => {
        const description = args.description as string;
        const priority = (args.priority as Goal['priority']) || 'medium';
        if (!description) return 'Need a task description.';

        const task = await store.add(description, priority);
        return `✅ Added: "${task.description}" (${task.priority} priority)`;
      },
    },
    {
      name: 'complete_task',
      description: 'Mark a task as completed.',
      parameters: {
        task: { type: 'string', description: 'Task ID or description to match' },
      },
      execute: async (args) => {
        const task = args.task as string;
        if (!task) return 'Which task should I mark as done?';

        const completed = await store.complete(task);
        if (!completed) return `Couldn't find a task matching "${task}".`;
        return `✅ Completed: "${completed.description}"`;
      },
    },
    {
      name: 'list_tasks',
      description: 'Show all active tasks, sorted by priority.',
      parameters: {},
      execute: async () => {
        const tasks = await store.getActive();
        if (tasks.length === 0) return 'No active tasks. Nice!';

        const priorityIcons = { high: '🔴', medium: '🟡', low: '🟢' };
        return tasks.map(t =>
          `${priorityIcons[t.priority]} ${t.description}`
        ).join('\n');
      },
    },
  ];
}
