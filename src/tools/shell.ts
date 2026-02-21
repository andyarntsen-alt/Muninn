// ═══════════════════════════════════════════════════════════
// MUNINN — Shell Tools
// Run commands on the computer — heavily gated by Policy Engine
// Every command requires at minimum logging, most require approval
// ═══════════════════════════════════════════════════════════

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../core/types.js';
import type { PolicyEngine } from '../core/policy-engine.js';
import type { ApprovalManager } from '../telegram/approval.js';

const execAsync = promisify(exec);

/** Shell execution timeout (30 seconds) */
const SHELL_TIMEOUT_MS = 30_000;

/** Max output length */
const MAX_OUTPUT_LENGTH = 10_000;

/**
 * Create shell tools gated by the policy engine.
 * All commands go through policy evaluation and most require Telegram approval.
 */
export function createShellTools(
  policy: PolicyEngine,
  approval: ApprovalManager,
): Tool[] {
  return [
    {
      name: 'run_command',
      description: 'Run a shell command on the computer. Most commands require user approval via Telegram. Dangerous commands are blocked.',
      parameters: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
      },
      execute: async (args) => {
        const command = String(args.command).trim();
        const cwd = args.cwd ? String(args.cwd).replace(/^~/, process.env.HOME || '') : undefined;

        const decision = policy.evaluate('run_command', { command });

        if (!decision.allowed) {
          await policy.logDecision('run_command', { command }, decision, 'denied');
          return `⛔ Blokkert: ${decision.reason}`;
        }

        // Request approval if needed
        if (decision.requiresApproval) {
          const desc = cwd
            ? `Kjøre kommando i ${cwd}:\n$ ${command}`
            : `Kjøre kommando:\n$ ${command}`;

          const approved = await approval.requestApproval(
            'run_command', { command, cwd }, decision.risk, desc
          );

          if (!approved) {
            await policy.logDecision('run_command', { command }, decision, 'rejected');
            return 'Fikk ikke lov til å kjøre kommandoen.';
          }
          await policy.logDecision('run_command', { command }, decision, 'approved');
        } else {
          await policy.logDecision('run_command', { command }, decision, 'allowed');
        }

        // Execute the command
        const startTime = Date.now();
        try {
          const { stdout, stderr } = await execAsync(command, {
            timeout: SHELL_TIMEOUT_MS,
            cwd,
            maxBuffer: 1024 * 1024, // 1MB
            env: { ...process.env, TERM: 'dumb' },
          });

          const elapsed = Date.now() - startTime;
          let output = '';

          if (stdout) {
            output += stdout.length > MAX_OUTPUT_LENGTH
              ? stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n... (trunkert)'
              : stdout;
          }

          if (stderr) {
            const stderrTrimmed = stderr.length > 2000
              ? stderr.slice(0, 2000) + '...'
              : stderr;
            output += output ? '\n\nstderr:\n' + stderrTrimmed : 'stderr:\n' + stderrTrimmed;
          }

          if (!output.trim()) {
            output = '(Ingen output)';
          }

          // Log execution result
          await policy.audit({
            timestamp: new Date().toISOString(),
            tool: 'run_command',
            args: { command, cwd },
            risk: decision.risk,
            decision: 'allowed',
            executionTimeMs: elapsed,
            result: output.slice(0, 500),
          });

          return output;
        } catch (err) {
          const elapsed = Date.now() - startTime;
          const errorMsg = err instanceof Error ? err.message : String(err);

          // Log error
          await policy.audit({
            timestamp: new Date().toISOString(),
            tool: 'run_command',
            args: { command, cwd },
            risk: decision.risk,
            decision: 'allowed',
            executionTimeMs: elapsed,
            error: errorMsg.slice(0, 500),
          });

          if (errorMsg.includes('TIMEOUT') || elapsed >= SHELL_TIMEOUT_MS) {
            return `⏰ Kommandoen timed out etter ${SHELL_TIMEOUT_MS / 1000} sekunder.`;
          }

          return `Feil: ${errorMsg}`;
        }
      },
    },
  ];
}
