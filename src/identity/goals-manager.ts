// ═══════════════════════════════════════════════════════════
// MUNINN — Goals Manager
// The agent's aspirations: what it wants to achieve
// Goals evolve through reflection, just like the soul
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal } from '../core/types.js';

const DEFAULT_GOALS_TEMPLATE = `# GOALS.md — Hva jeg vil oppnå

## Active
- [goal-1] Bli kjent med Andreas sine interesser og verdier
- [goal-2] Forstå hva som motiverer Andreas

## Completed
(ingen ennå)

## Notes
Mål oppdateres under refleksjon.
`;

/**
 * The Goals Manager — tracks what Muninn wants to achieve.
 *
 * Goals are the agent's own aspirations, developed through
 * reflection. They drive the relationship forward in phases,
 * like a real friendship evolving over time.
 */
export class GoalsManager {
  private dataDir: string;
  private goalsPath: string;
  private cachedGoals: Goal[] | null = null;
  private nextId: number = 1;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.goalsPath = join(dataDir, 'GOALS.md');
  }

  /** Initialize — create default GOALS.md if needed */
  async initialize(): Promise<void> {
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }

    if (!existsSync(this.goalsPath)) {
      await writeFile(this.goalsPath, DEFAULT_GOALS_TEMPLATE, 'utf-8');
      console.log('[Goals] Created default GOALS.md');
    }

    this.cachedGoals = await this.parseGoals();
    this.nextId = this.cachedGoals.reduce((max, g) => {
      const num = parseInt(g.id.replace('goal-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num + 1);
    }, 1);

    const active = this.cachedGoals.filter(g => g.status === 'active');
    console.log(`[Goals] Loaded ${active.length} active goals`);
  }

  /** Get all goals */
  async getGoals(): Promise<Goal[]> {
    if (!this.cachedGoals) {
      this.cachedGoals = await this.parseGoals();
    }
    return this.cachedGoals;
  }

  /** Get only active goals */
  async getActiveGoals(): Promise<Goal[]> {
    const goals = await this.getGoals();
    return goals.filter(g => g.status === 'active');
  }

  /** Add a new goal */
  async addGoal(description: string, priority: Goal['priority'] = 'medium'): Promise<Goal> {
    const goal: Goal = {
      id: `goal-${this.nextId++}`,
      description,
      priority,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    const goals = await this.getGoals();
    goals.push(goal);
    this.cachedGoals = goals;
    await this.saveGoals();

    console.log(`[Goals] Added: ${goal.id} — ${description}`);
    return goal;
  }

  /** Complete a goal by ID */
  async completeGoal(goalId: string): Promise<boolean> {
    const goals = await this.getGoals();
    const goal = goals.find(g => g.id === goalId);
    if (!goal || goal.status === 'completed') return false;

    goal.status = 'completed';
    goal.completedAt = new Date().toISOString();
    this.cachedGoals = goals;
    await this.saveGoals();

    console.log(`[Goals] Completed: ${goalId}`);
    return true;
  }

  /** Apply goal updates from reflection (complete some, add new ones) */
  async updateGoals(updates: {
    completed?: string[];
    new?: string[];
  }): Promise<void> {
    if (updates.completed) {
      for (const id of updates.completed) {
        await this.completeGoal(id);
      }
    }

    if (updates.new) {
      for (const desc of updates.new) {
        await this.addGoal(desc);
      }
    }
  }

  /** Get the raw GOALS.md content */
  async getRawGoals(): Promise<string> {
    return readFile(this.goalsPath, 'utf-8');
  }

  /** Parse GOALS.md into Goal objects */
  private async parseGoals(): Promise<Goal[]> {
    const content = await readFile(this.goalsPath, 'utf-8');
    const goals: Goal[] = [];

    const activeSection = this.extractSection(content, 'Active');
    if (activeSection) {
      for (const goal of this.parseGoalLines(activeSection, 'active')) {
        goals.push(goal);
      }
    }

    const completedSection = this.extractSection(content, 'Completed');
    if (completedSection) {
      for (const goal of this.parseGoalLines(completedSection, 'completed')) {
        goals.push(goal);
      }
    }

    return goals;
  }

  /** Parse bullet lines into Goal objects */
  private parseGoalLines(section: string, status: Goal['status']): Goal[] {
    const goals: Goal[] = [];
    const lines = section.split('\n').filter(l => l.trim().startsWith('-'));

    for (const line of lines) {
      const match = line.match(/^-\s*\[([^\]]+)\]\s*(.+)/);
      if (match) {
        goals.push({
          id: match[1].trim(),
          description: match[2].trim(),
          priority: 'medium',
          status,
          createdAt: new Date().toISOString(),
          completedAt: status === 'completed' ? new Date().toISOString() : undefined,
        });
      }
    }

    return goals;
  }

  /** Extract a section under a ## heading */
  private extractSection(content: string, heading: string): string | null {
    const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : null;
  }

  /** Save goals back to GOALS.md */
  private async saveGoals(): Promise<void> {
    const goals = this.cachedGoals || [];
    const active = goals.filter(g => g.status === 'active');
    const completed = goals.filter(g => g.status === 'completed');

    const activeLines = active.length > 0
      ? active.map(g => `- [${g.id}] ${g.description}`).join('\n')
      : '(ingen ennå)';

    const completedLines = completed.length > 0
      ? completed.map(g => `- [${g.id}] ${g.description} (${g.completedAt?.split('T')[0] || ''})`).join('\n')
      : '(ingen ennå)';

    const content = `# GOALS.md — Hva jeg vil oppnå

## Active
${activeLines}

## Completed
${completedLines}

## Notes
Mål oppdateres under refleksjon.
`;

    await writeFile(this.goalsPath, content, 'utf-8');
  }
}
