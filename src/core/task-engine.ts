// ═══════════════════════════════════════════════════════════
// MUNINN — Task Engine
// Autonomous task execution with plan-based approval.
// User approves the plan once, Muninn works alone.
// ═══════════════════════════════════════════════════════════

import { nanoid } from 'nanoid';
import { generateResponse } from './llm.js';
import type { MuninnConfig, PolicyConfig } from './types.js';
import type { PolicyEngine } from './policy-engine.js';
import type { ApprovalManager } from '../telegram/approval.js';

// ─── Types ──────────────────────────────────────────────

export interface TaskPlan {
  id: string;
  description: string;
  steps: TaskStep[];
  workingDir: string;
  status: 'planning' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface TaskStep {
  id: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
}

export interface TaskProgress {
  taskId: string;
  currentStep: number;
  totalSteps: number;
  stepDescription: string;
  status: string;
}

type ProgressCallback = (progress: TaskProgress) => Promise<void>;
type ScreenshotCallback = (taskId: string) => Promise<string | null>;

/**
 * The Task Engine — lets Muninn work autonomously on approved plans.
 *
 * Flow:
 * 1. User says "/task lag en portfolio-side"
 * 2. Muninn generates a plan (list of steps)
 * 3. User sees the plan and approves with ✅
 * 4. Muninn executes each step automatically (no per-step approval)
 * 5. Reports progress and takes screenshots along the way
 * 6. Sends final result when done
 *
 * Security: During task execution, the policy engine runs in "task mode"
 * where operations within the plan's working directory are auto-approved.
 * Anything outside scope still requires manual approval.
 */
export class TaskEngine {
  private config: MuninnConfig;
  private policy: PolicyEngine;
  private approval: ApprovalManager;
  private currentTask: TaskPlan | null = null;
  private onProgress: ProgressCallback | null = null;
  private onScreenshot: ScreenshotCallback | null = null;

  // Available tool executors (injected from tools registry)
  private toolExecutors: Map<string, (args: Record<string, unknown>) => Promise<string>> = new Map();

  constructor(
    config: MuninnConfig,
    policy: PolicyEngine,
    approval: ApprovalManager,
  ) {
    this.config = config;
    this.policy = policy;
    this.approval = approval;
  }

  /** Register tool executors from the tools registry */
  registerTools(tools: { name: string; execute: (args: Record<string, unknown>) => Promise<string> }[]): void {
    for (const t of tools) {
      this.toolExecutors.set(t.name, t.execute);
    }
  }

  /** Set progress callback (for Telegram updates) */
  setProgressCallback(cb: ProgressCallback): void {
    this.onProgress = cb;
  }

  /** Set screenshot callback */
  setScreenshotCallback(cb: ScreenshotCallback): void {
    this.onScreenshot = cb;
  }

  /** Create a plan for a task */
  async planTask(description: string, workingDir?: string): Promise<TaskPlan> {
    const policyConfig = this.policy.getConfig();

    const allowedDirs = policyConfig.allowed_dirs.join(', ');
    const dir = workingDir || policyConfig.allowed_dirs[0] || '~/Desktop';

    const text = await generateResponse({
      model: this.config.model || 'sonnet',
      system: `Du er Muninn, en AI-agent som planlegger oppgaver. Du skal lage en konkret, steg-for-steg plan.

Tilgjengelige verktøy:
- read_file: Les en fil (args: path)
- write_file: Skriv til fil (args: path, content)
- list_directory: List filer (args: path)
- search_files: Søk etter filer (args: pattern, directory)
- move_file: Flytt fil (args: from, to)
- delete_file: Slett fil (args: path)
- run_command: Kjør terminal-kommando (args: command, cwd)
- fetch_page: Hent nettside (args: url)
- search_web: Søk på nett (args: query)
- screenshot: Ta skjermbilde (args: {})

Tillatte mapper: ${allowedDirs}
Arbeidsmappe: ${dir}
Shell: ${policyConfig.shell_enabled ? 'Tilgjengelig' : 'Ikke tilgjengelig'}

Svar i JSON-format:
{
  "steps": [
    { "description": "Hva steget gjør", "tool": "verktøynavn", "args": { ... } }
  ]
}

Regler:
- Bruk absolutte stier med ~ for hjemmemappe
- Hold deg innenfor tillatte mapper
- Bruk run_command for npm, git, etc.
- Ta screenshot på slutten så brukeren ser resultatet
- Vær konkret — skriv faktisk kode/innhold i write_file steg
- Maks 30 steg per plan`,
      prompt: `Oppgave: ${description}\nArbeidsmappe: ${dir}`,
    });

    // Parse the plan
    let steps: TaskStep[] = [];
    try {
      // Extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        steps = (parsed.steps || []).map((s: { description: string; tool: string; args: Record<string, unknown> }) => ({
          id: nanoid(8),
          description: s.description,
          tool: s.tool,
          args: s.args || {},
          status: 'pending' as const,
        }));
      }
    } catch (err) {
      console.error('[TaskEngine] Failed to parse plan:', err);
      throw new Error('Klarte ikke å lage en plan. Prøv å beskrive oppgaven tydeligere.');
    }

    if (steps.length === 0) {
      throw new Error('Planen ble tom. Prøv å beskrive oppgaven tydeligere.');
    }

    const plan: TaskPlan = {
      id: nanoid(12),
      description,
      steps,
      workingDir: dir,
      status: 'awaiting_approval',
      createdAt: new Date().toISOString(),
    };

    this.currentTask = plan;
    return plan;
  }

  /** Format a plan for display in Telegram */
  formatPlanForDisplay(plan: TaskPlan): string {
    let text = `📋 *Oppgave:* ${plan.description}\n`;
    text += `📁 *Mappe:* \`${plan.workingDir}\`\n`;
    text += `📊 *Steg:* ${plan.steps.length}\n\n`;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const icon = step.tool === 'screenshot' ? '📸' :
                   step.tool === 'run_command' ? '⚡' :
                   step.tool === 'write_file' ? '✏️' :
                   step.tool === 'read_file' ? '👁' :
                   '🔧';
      text += `${i + 1}. ${icon} ${step.description}\n`;
    }

    text += `\n_Godkjenn for å starte. Alle steg kjøres automatisk._`;
    return text;
  }

  /** Execute an approved plan */
  async executeTask(taskId: string): Promise<TaskPlan> {
    if (!this.currentTask || this.currentTask.id !== taskId) {
      throw new Error('Fant ikke oppgaven.');
    }

    const task = this.currentTask;
    task.status = 'running';

    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i];
      step.status = 'running';

      // Report progress
      if (this.onProgress) {
        await this.onProgress({
          taskId: task.id,
          currentStep: i + 1,
          totalSteps: task.steps.length,
          stepDescription: step.description,
          status: `Steg ${i + 1}/${task.steps.length}`,
        });
      }

      try {
        // Handle screenshot specially
        if (step.tool === 'screenshot') {
          if (this.onScreenshot) {
            const path = await this.onScreenshot(task.id);
            step.result = path || 'Skjermbilde tatt';
          } else {
            step.result = 'Screenshot ikke tilgjengelig';
          }
          step.status = 'completed';
          continue;
        }

        // Execute the tool
        const executor = this.toolExecutors.get(step.tool);
        if (!executor) {
          step.error = `Ukjent verktøy: ${step.tool}`;
          step.status = 'failed';
          // Non-critical — continue with next step
          continue;
        }

        // For task execution, inject the working directory as cwd for commands
        const args = { ...step.args };
        if (step.tool === 'run_command' && !args.cwd) {
          args.cwd = task.workingDir.replace(/^~/, process.env.HOME || '');
        }

        const result = await executor(args);
        step.result = result;

        // Check if the result indicates a rejection (from approval system)
        if (result.includes('Fikk ikke lov') || result.includes('Ikke tillatt') || result.includes('Blokkert')) {
          step.status = 'failed';
          step.error = result;
          // If a critical step fails, stop the task
          if (step.tool === 'write_file' || step.tool === 'run_command') {
            task.status = 'failed';
            task.error = `Steg ${i + 1} feilet: ${result}`;
            break;
          }
        } else {
          step.status = 'completed';
        }
      } catch (err) {
        step.error = err instanceof Error ? err.message : String(err);
        step.status = 'failed';

        // Stop on critical failures
        task.status = 'failed';
        task.error = `Steg ${i + 1} krasjet: ${step.error}`;
        break;
      }
    }

    if (task.status === 'running') {
      task.status = 'completed';
    }
    task.completedAt = new Date().toISOString();

    return task;
  }

  /** Get summary of completed task */
  formatTaskResult(task: TaskPlan): string {
    const completed = task.steps.filter(s => s.status === 'completed').length;
    const failed = task.steps.filter(s => s.status === 'failed').length;

    const statusEmoji = task.status === 'completed' ? '✅' : '❌';
    let text = `${statusEmoji} *Oppgave ${task.status === 'completed' ? 'fullført' : 'feilet'}*\n\n`;
    text += `📋 ${task.description}\n`;
    text += `📊 ${completed}/${task.steps.length} steg fullført`;
    if (failed > 0) text += ` (${failed} feilet)`;
    text += '\n\n';

    for (const step of task.steps) {
      const icon = step.status === 'completed' ? '✅' :
                   step.status === 'failed' ? '❌' :
                   step.status === 'skipped' ? '⏭' : '⏳';
      text += `${icon} ${step.description}\n`;
      if (step.error) {
        text += `   _${step.error.slice(0, 100)}_\n`;
      }
    }

    if (task.error) {
      text += `\n⚠️ ${task.error}`;
    }

    return text;
  }

  /** Cancel the current task */
  cancel(): void {
    if (this.currentTask) {
      this.currentTask.status = 'cancelled';
      for (const step of this.currentTask.steps) {
        if (step.status === 'pending' || step.status === 'running') {
          step.status = 'skipped';
        }
      }
    }
  }

  /** Get current task */
  getCurrentTask(): TaskPlan | null {
    return this.currentTask;
  }

  /** Check if a task is running */
  isRunning(): boolean {
    return this.currentTask?.status === 'running';
  }
}
