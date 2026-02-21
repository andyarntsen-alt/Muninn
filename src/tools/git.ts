// ═══════════════════════════════════════════════════════════
// MUNINN — Git Integration Tools
// Version control at the raven's command
// ═══════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import type { Tool } from '../core/types.js';
import type { PolicyEngine } from '../core/policy-engine.js';
import type { ApprovalManager } from '../telegram/approval.js';

/**
 * Create Git tools gated by the policy engine.
 * Read operations (log, status, diff) are low risk.
 * Write operations (commit, push, checkout) require approval.
 */
export function createGitTools(
  policy: PolicyEngine,
  approval: ApprovalManager,
): Tool[] {
  // Helper to run git commands safely — uses execFileSync (no shell) to prevent injection
  function runGit(args: string[], cwd: string): string {
    const resolved = cwd.replace(/^~/, process.env.HOME || '');
    try {
      const result = execFileSync('git', args, {
        cwd: resolved,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
      });
      return result.trim() || '(ingen output)';
    } catch (err: any) {
      if (err.stderr) return `Git feil: ${err.stderr.toString().trim()}`;
      return `Git feil: ${err.message}`;
    }
  }

  return [
    // ─── git_status ────────────────────────────────────────
    {
      name: 'git_status',
      description: 'Show the working tree status of a git repository. Low risk, read-only.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const decision = policy.evaluate('list_directory', { path: dir });

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        return runGit(['status', '--short', '--branch'], dir);
      },
    },

    // ─── git_log ───────────────────────────────────────────
    {
      name: 'git_log',
      description: 'Show recent commit history. Defaults to last 10 commits.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
        count: { type: 'number', description: 'Number of commits to show (default: 10)' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const count = Math.min(Number(args.count) || 10, 50);
        const decision = policy.evaluate('list_directory', { path: dir });

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        return runGit(['log', '--oneline', '--decorate', '-n', String(count)], dir);
      },
    },

    // ─── git_diff ──────────────────────────────────────────
    {
      name: 'git_diff',
      description: 'Show changes in the working directory or between commits.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
        target: { type: 'string', description: 'Optional: file path, commit hash, or "staged" for staged changes' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const target = String(args.target || '');
        const decision = policy.evaluate('list_directory', { path: dir });

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        if (target === 'staged') {
          return runGit(['diff', '--cached'], dir);
        } else if (target) {
          return runGit(['diff', target], dir);
        }
        return runGit(['diff'], dir);
      },
    },

    // ─── git_branch ────────────────────────────────────────
    {
      name: 'git_branch',
      description: 'List branches or create a new branch.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
        name: { type: 'string', description: 'Optional: name of new branch to create' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const branchName = args.name ? String(args.name) : '';
        const decision = policy.evaluate('list_directory', { path: dir });

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        if (branchName) {
          // Creating a branch — medium risk, request approval
          const approved = await approval.requestApproval(
            'git_branch', { directory: dir, name: branchName },
            'medium', `Opprette ny git-branch: ${branchName}`,
          );
          if (!approved) return 'Fikk ikke lov til å gjøre det.';
          return runGit(['checkout', '-b', branchName], dir);
        }

        return runGit(['branch', '-a'], dir);
      },
    },

    // ─── git_add ───────────────────────────────────────────
    {
      name: 'git_add',
      description: 'Stage files for commit. Use "." to stage all changes.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
        files: { type: 'string', description: 'Files to stage (space-separated, or "." for all)' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const files = String(args.files || '.');
        const decision = policy.evaluate('write_file', { path: dir });

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        return runGit(['add', ...files.split(/\s+/)], dir);
      },
    },

    // ─── git_commit ────────────────────────────────────────
    {
      name: 'git_commit',
      description: 'Create a git commit with a message.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
        message: { type: 'string', description: 'Commit message' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const message = String(args.message);
        if (!message) return 'Feil: Commit-melding er påkrevd.';

        const decision = policy.evaluate('write_file', { path: dir });
        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        const approved = await approval.requestApproval(
          'git_commit', { directory: dir, message },
          'medium', `Git commit: "${message}"`,
        );
        if (!approved) return 'Fikk ikke lov til å gjøre det.';

        return runGit(['commit', '-m', message], dir);
      },
    },

    // ─── git_checkout ──────────────────────────────────────
    {
      name: 'git_checkout',
      description: 'Switch to a branch or restore files.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
        target: { type: 'string', description: 'Branch name or file path to checkout' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const target = String(args.target);
        if (!target) return 'Feil: Må spesifisere branch eller fil.';

        const decision = policy.evaluate('write_file', { path: dir });
        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        const approved = await approval.requestApproval(
          'git_checkout', { directory: dir, target },
          'medium', `Git checkout: ${target}`,
        );
        if (!approved) return 'Fikk ikke lov til å gjøre det.';

        return runGit(['checkout', target], dir);
      },
    },

    // ─── git_push ──────────────────────────────────────────
    {
      name: 'git_push',
      description: 'Push commits to remote.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
        remote: { type: 'string', description: 'Remote name (default: origin)' },
        branch: { type: 'string', description: 'Branch to push (default: current)' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const remote = String(args.remote || 'origin');
        const branch = args.branch ? String(args.branch) : '';

        const decision = policy.evaluate('write_file', { path: dir });
        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        const pushTarget = branch ? `${remote} ${branch}` : remote;
        const approved = await approval.requestApproval(
          'git_push', { directory: dir, remote, branch },
          'high', `Git push til ${pushTarget}`,
        );
        if (!approved) return 'Fikk ikke lov til å gjøre det.';

        const pushArgs = branch ? ['push', remote, branch] : ['push', remote];
        return runGit(pushArgs, dir);
      },
    },

    // ─── git_pull ──────────────────────────────────────────
    {
      name: 'git_pull',
      description: 'Pull changes from remote.',
      parameters: {
        directory: { type: 'string', description: 'Path to the git repository' },
      },
      execute: async (args) => {
        const dir = String(args.directory || '.');
        const decision = policy.evaluate('write_file', { path: dir });

        if (!decision.allowed) {
          return `Ikke tillatt: ${decision.reason}`;
        }

        const approved = await approval.requestApproval(
          'git_pull', { directory: dir },
          'medium', `Git pull i ${dir}`,
        );
        if (!approved) return 'Fikk ikke lov til å gjøre det.';

        return runGit(['pull'], dir);
      },
    },
  ];
}
