// ═══════════════════════════════════════════════════════════
// MUNINN — Policy Engine
// Deterministic security layer. No LLM can talk its way past this.
// Deny-by-default. Append-only audit. Telegram approval for risky ops.
// ═══════════════════════════════════════════════════════════

import { appendFile, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve, normalize } from 'node:path';
import { homedir } from 'node:os';
import type { PolicyConfig, PolicyDecision, RiskLevel, AuditEntry } from './types.js';

/**
 * The Policy Engine — Muninn's security boundary.
 *
 * This is 100% deterministic. No LLM calls, no prompt injection surface.
 * It sits between the LLM brain (Huginn) and the tools (filesystem, shell, browser).
 *
 * Design principles:
 * 1. Deny-by-default — everything is blocked unless explicitly allowed
 * 2. Deterministic — rules are code, not prompts
 * 3. Append-only audit — every decision is logged, nothing can be deleted
 * 4. Telegram approval — medium/high risk ops require human confirmation
 */
export class PolicyEngine {
  private config: PolicyConfig;
  private dataDir: string;
  private auditPath: string;
  private resolvedAllowedDirs: string[];

  // Task mode: when active, auto-approves medium risk ops within task scope
  private taskMode: { active: boolean; workingDir: string; taskId: string } | null = null;

  // ─── Hardcoded deny patterns (cannot be overridden) ──────
  private static readonly BLOCKED_PATH_PATTERNS = [
    /^\/etc/,
    /^\/System/,
    /^\/usr\/bin/,
    /^\/usr\/sbin/,
    /^\/sbin/,
    /^\/boot/,
    /^\/proc/,
    /^\/sys/,
    /^\/dev/,
    /\.ssh/,
    /\.gnupg/,
    /\.aws\/credentials/,
    /\.env$/,
    /\.env\./,
    /node_modules/,
    /\.git\//,
  ];

  private static readonly BLOCKED_COMMANDS = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf *',
    'sudo',
    'su ',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'mkfs',
    'dd if=',
    'format',
    ':(){:|:&};:',      // fork bomb
    'chmod -R 777',
    'chown -R',
    'passwd',
    'useradd',
    'userdel',
    'visudo',
    '> /dev/sda',
    'curl | sh',
    'curl | bash',
    'wget | sh',
    'wget | bash',
    'eval(',
    'nc -l',           // netcat listener
    'ncat -l',
    'python -m http.server',
    'npm publish',
    'git push --force',
  ];

  private static readonly SAFE_READ_EXTENSIONS = [
    '.txt', '.md', '.json', '.yaml', '.yml', '.toml',
    '.ts', '.js', '.py', '.rs', '.go', '.java', '.c', '.h',
    '.css', '.html', '.svg', '.xml',
    '.csv', '.tsv', '.log',
    '.sh', '.bash', '.zsh',
    '.conf', '.cfg', '.ini',
  ];

  private static readonly SAFE_COMMANDS = [
    'ls', 'pwd', 'whoami', 'date', 'cal',
    'cat', 'head', 'tail', 'wc', 'sort', 'uniq',
    'find', 'grep', 'rg', 'fd',
    'echo', 'printf',
    'node --version', 'npm --version', 'git --version',
    'git status', 'git log', 'git diff', 'git branch',
    'tree',
    'df -h', 'du -sh',
    'uname',
  ];

  constructor(config: PolicyConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
    this.auditPath = join(dataDir, 'audit.jsonl');

    // Pre-resolve all allowed directories to absolute paths
    this.resolvedAllowedDirs = config.allowed_dirs.map(dir =>
      resolve(normalize(dir.replace('~', homedir())))
    );
  }

  /** Initialize — create audit log directory */
  async initialize(): Promise<void> {
    await mkdir(join(this.dataDir), { recursive: true });
  }

  // ═══════════════════════════════════════════════════════════
  // RISK CLASSIFICATION
  // ═══════════════════════════════════════════════════════════

  /** Evaluate a tool call and return a policy decision */
  evaluate(toolName: string, args: Record<string, unknown>): PolicyDecision {
    // Check for config-level risk overrides first
    const overrideKey = `${toolName}:${JSON.stringify(args)}`;
    if (this.config.risk_overrides?.[toolName]) {
      const overrideRisk = this.config.risk_overrides[toolName];
      return this.decisionForRisk(overrideRisk, toolName, args);
    }

    switch (toolName) {
      case 'read_file':
        return this.evaluateReadFile(args);
      case 'write_file':
        return this.evaluateWriteFile(args);
      case 'list_directory':
        return this.evaluateListDirectory(args);
      case 'search_files':
        return this.evaluateSearchFiles(args);
      case 'move_file':
        return this.evaluateMoveFile(args);
      case 'delete_file':
        return this.evaluateDeleteFile(args);
      case 'run_command':
        return this.evaluateRunCommand(args);
      case 'fetch_page':
        return this.evaluateFetchPage(args);
      case 'search_web':
        return this.evaluateSearchWeb(args);
      case 'download_file':
        return this.evaluateDownloadFile(args);
      default:
        // Unknown tools are blocked
        return {
          allowed: false,
          risk: 'blocked',
          reason: `Unknown tool: ${toolName}`,
          requiresApproval: false,
        };
    }
  }

  // ─── Filesystem evaluations ──────────────────────────────

  private evaluateReadFile(args: Record<string, unknown>): PolicyDecision {
    const path = String(args.path || '');
    const resolved = this.resolvePath(path);

    if (this.isBlockedPath(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Blocked path: ${path}`, requiresApproval: false };
    }

    if (!this.isInAllowedDir(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Path outside allowed directories: ${path}`, requiresApproval: false };
    }

    // Reading is generally safe
    const ext = path.substring(path.lastIndexOf('.'));
    if (PolicyEngine.SAFE_READ_EXTENSIONS.includes(ext)) {
      return { allowed: true, risk: 'safe', reason: 'Safe file read', requiresApproval: false };
    }

    // Non-standard file types — low risk
    return { allowed: true, risk: 'low', reason: `Reading non-standard file type: ${ext}`, requiresApproval: false };
  }

  private evaluateWriteFile(args: Record<string, unknown>): PolicyDecision {
    const path = String(args.path || '');
    const resolved = this.resolvePath(path);

    if (this.isBlockedPath(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Blocked path: ${path}`, requiresApproval: false };
    }

    if (!this.isInAllowedDir(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Path outside allowed directories: ${path}`, requiresApproval: false };
    }

    if (this.config.require_approval_for_writes) {
      return { allowed: true, risk: 'medium', reason: `Writing file: ${path}`, requiresApproval: true };
    }

    return { allowed: true, risk: 'low', reason: `Writing to allowed directory`, requiresApproval: false };
  }

  private evaluateListDirectory(args: Record<string, unknown>): PolicyDecision {
    const path = String(args.path || '');
    const resolved = this.resolvePath(path);

    if (this.isBlockedPath(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Blocked path: ${path}`, requiresApproval: false };
    }

    if (!this.isInAllowedDir(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Path outside allowed directories: ${path}`, requiresApproval: false };
    }

    return { allowed: true, risk: 'safe', reason: 'Directory listing', requiresApproval: false };
  }

  private evaluateSearchFiles(args: Record<string, unknown>): PolicyDecision {
    const dir = String(args.directory || args.path || '');
    const resolved = this.resolvePath(dir);

    if (!this.isInAllowedDir(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Search outside allowed directories`, requiresApproval: false };
    }

    return { allowed: true, risk: 'safe', reason: 'File search', requiresApproval: false };
  }

  private evaluateMoveFile(args: Record<string, unknown>): PolicyDecision {
    const from = this.resolvePath(String(args.from || ''));
    const to = this.resolvePath(String(args.to || ''));

    if (this.isBlockedPath(from) || this.isBlockedPath(to)) {
      return { allowed: false, risk: 'blocked', reason: 'Blocked path in move operation', requiresApproval: false };
    }

    if (!this.isInAllowedDir(from) || !this.isInAllowedDir(to)) {
      return { allowed: false, risk: 'blocked', reason: 'Move involves paths outside allowed directories', requiresApproval: false };
    }

    return { allowed: true, risk: 'medium', reason: `Moving ${args.from} → ${args.to}`, requiresApproval: true };
  }

  private evaluateDeleteFile(args: Record<string, unknown>): PolicyDecision {
    const path = String(args.path || '');
    const resolved = this.resolvePath(path);

    if (this.isBlockedPath(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Blocked path: ${path}`, requiresApproval: false };
    }

    if (!this.isInAllowedDir(resolved)) {
      return { allowed: false, risk: 'blocked', reason: `Path outside allowed directories`, requiresApproval: false };
    }

    // Deletion is always high risk
    return { allowed: true, risk: 'high', reason: `Deleting: ${path}`, requiresApproval: true };
  }

  // ─── Shell evaluations ───────────────────────────────────

  private evaluateRunCommand(args: Record<string, unknown>): PolicyDecision {
    if (!this.config.shell_enabled) {
      return { allowed: false, risk: 'blocked', reason: 'Shell access is disabled', requiresApproval: false };
    }

    const command = String(args.command || '').trim();

    // Check hardcoded deny list
    for (const blocked of PolicyEngine.BLOCKED_COMMANDS) {
      if (command.includes(blocked)) {
        return { allowed: false, risk: 'blocked', reason: `Blocked command pattern: ${blocked}`, requiresApproval: false };
      }
    }

    // Check config deny list
    for (const blocked of this.config.blocked_commands) {
      if (command.includes(blocked)) {
        return { allowed: false, risk: 'blocked', reason: `Blocked by config: ${blocked}`, requiresApproval: false };
      }
    }

    // Check for shell injection patterns:
    // - pipe to shell: |sh, | bash, |zsh, | eval (with or without whitespace)
    // - backtick command substitution: `cmd`
    // - dollar command substitution: $(cmd), ${var}
    if (/\|\s*(sh|bash|zsh|eval)\b|`[^`]+`|\$\(|\$\{/.test(command)) {
      return { allowed: false, risk: 'blocked', reason: 'Shell injection pattern detected', requiresApproval: false };
    }

    // Check for safe commands (read-only, informational)
    const baseCommand = command.split(' ')[0].split('/').pop() || '';
    const isSafe = PolicyEngine.SAFE_COMMANDS.some(safe => {
      const safeBase = safe.split(' ')[0];
      return baseCommand === safeBase && (
        safe === baseCommand || command.startsWith(safe)
      );
    });

    if (isSafe) {
      return { allowed: true, risk: 'low', reason: `Safe command: ${baseCommand}`, requiresApproval: false };
    }

    // Everything else requires approval
    return { allowed: true, risk: 'medium', reason: `Shell command: ${command}`, requiresApproval: true };
  }

  // ─── Browser evaluations ─────────────────────────────────

  private evaluateFetchPage(args: Record<string, unknown>): PolicyDecision {
    if (!this.config.browser_enabled) {
      return { allowed: false, risk: 'blocked', reason: 'Browser access is disabled', requiresApproval: false };
    }

    const url = String(args.url || '');

    // Block suspicious URLs
    if (this.isSuspiciousUrl(url)) {
      return { allowed: false, risk: 'blocked', reason: `Suspicious URL: ${url}`, requiresApproval: false };
    }

    return { allowed: true, risk: 'safe', reason: `Fetching: ${url}`, requiresApproval: false };
  }

  private evaluateSearchWeb(args: Record<string, unknown>): PolicyDecision {
    if (!this.config.browser_enabled) {
      return { allowed: false, risk: 'blocked', reason: 'Browser access is disabled', requiresApproval: false };
    }

    return { allowed: true, risk: 'safe', reason: 'Web search', requiresApproval: false };
  }

  private evaluateDownloadFile(args: Record<string, unknown>): PolicyDecision {
    if (!this.config.browser_enabled) {
      return { allowed: false, risk: 'blocked', reason: 'Browser access is disabled', requiresApproval: false };
    }

    const url = String(args.url || '');
    const savePath = String(args.savePath || '');
    const resolvedSave = this.resolvePath(savePath);

    if (!this.isInAllowedDir(resolvedSave)) {
      return { allowed: false, risk: 'blocked', reason: 'Download path outside allowed directories', requiresApproval: false };
    }

    if (this.isSuspiciousUrl(url)) {
      return { allowed: false, risk: 'blocked', reason: `Suspicious URL: ${url}`, requiresApproval: false };
    }

    return { allowed: true, risk: 'high', reason: `Downloading: ${url} → ${savePath}`, requiresApproval: true };
  }

  // ═══════════════════════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════════════════════

  /** Log a policy decision (append-only) */
  async audit(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    try {
      await appendFile(this.auditPath, line, 'utf-8');
    } catch (err) {
      console.error('[Policy] Failed to write audit log:', err);
    }
  }

  /** Create an audit entry for a decision */
  async logDecision(
    tool: string,
    args: Record<string, unknown>,
    decision: PolicyDecision,
    outcome: 'allowed' | 'denied' | 'approved' | 'rejected' | 'timeout',
    userId?: string,
  ): Promise<void> {
    await this.audit({
      timestamp: new Date().toISOString(),
      tool,
      args,
      risk: decision.risk,
      decision: outcome,
      userId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  /** Resolve a path to absolute, expanding ~ and following symlinks */
  private resolvePath(path: string): string {
    const expanded = path.replace(/^~/, homedir());
    const resolved = resolve(normalize(expanded));
    // Follow symlinks to detect escapes from allowed directories.
    // Falls back to the resolved path if the file doesn't exist yet.
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  }

  /** Check if a path is in the hardcoded deny list */
  private isBlockedPath(absPath: string): boolean {
    return PolicyEngine.BLOCKED_PATH_PATTERNS.some(pattern => pattern.test(absPath));
  }

  /** Check if a path is within any of the allowed directories */
  private isInAllowedDir(absPath: string): boolean {
    // Data dir is always allowed (Muninn's own data)
    const resolvedDataDir = resolve(normalize(this.dataDir));
    if (absPath.startsWith(resolvedDataDir)) return true;

    return this.resolvedAllowedDirs.some(dir => absPath.startsWith(dir));
  }

  /** Check if a URL looks suspicious */
  private isSuspiciousUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      // Block file protocol
      if (parsed.protocol === 'file:') return true;

      // Block localhost and common aliases
      if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'].includes(hostname)) return true;

      // Block IPv6 bracket notation for loopback
      if (hostname.startsWith('[') && hostname.includes('::')) return true;

      // Block private ranges
      if (hostname.startsWith('192.168.')) return true;
      if (hostname.startsWith('10.')) return true;
      if (hostname.startsWith('172.')) return true;
      if (hostname.startsWith('169.254.')) return true;

      // Block octal/decimal IP representations of 127.0.0.1
      // e.g., 0177.0.0.1, 2130706433, 0x7f000001
      if (/^0[0-7]/.test(hostname)) return true;             // Octal notation
      if (/^0x[0-9a-f]+$/i.test(hostname)) return true;      // Hex notation
      if (/^\d{8,}$/.test(hostname)) return true;             // Decimal notation (large int)

      // Block hostnames that resolve to .local or other suspicious TLDs
      if (hostname.endsWith('.local')) return true;
      if (hostname.endsWith('.internal')) return true;

      return false;
    } catch {
      return true; // Malformed URL = suspicious
    }
  }

  /** Build a decision for a given risk level */
  private decisionForRisk(risk: RiskLevel, tool: string, args: Record<string, unknown>): PolicyDecision {
    if (risk === 'blocked') {
      return { allowed: false, risk, reason: `Blocked by risk override`, requiresApproval: false };
    }
    const requiresApproval = risk === 'medium' || risk === 'high';
    return { allowed: true, risk, reason: `Risk override for ${tool}`, requiresApproval };
  }

  /** Get the config for external access */
  getConfig(): PolicyConfig {
    return this.config;
  }

  // ═══════════════════════════════════════════════════════════
  // TASK MODE — auto-approve within approved plan scope
  // ═══════════════════════════════════════════════════════════

  /** Enter task mode — auto-approves medium risk ops in the working dir.
   *  Blocked and high risk operations still require manual approval. */
  enterTaskMode(taskId: string, workingDir: string): void {
    const resolved = this.resolvePath(workingDir);
    this.taskMode = { active: true, workingDir: resolved, taskId };
    console.log(`[Policy] Task mode ON: ${taskId} in ${resolved}`);
  }

  /** Exit task mode */
  exitTaskMode(): void {
    if (this.taskMode) {
      console.log(`[Policy] Task mode OFF: ${this.taskMode.taskId}`);
    }
    this.taskMode = null;
  }

  /** Check if task mode is active */
  isTaskMode(): boolean {
    return this.taskMode?.active ?? false;
  }

  /**
   * Evaluate with task mode awareness.
   * In task mode, medium-risk operations within the task working directory
   * are downgraded to not require approval. Blocked ops are never auto-approved.
   */
  evaluateForTask(toolName: string, args: Record<string, unknown>): PolicyDecision {
    const decision = this.evaluate(toolName, args);

    // If not in task mode, return normal decision
    if (!this.taskMode?.active) return decision;

    // Never auto-approve blocked operations
    if (decision.risk === 'blocked') return decision;

    // Never auto-approve high risk (delete, download)
    if (decision.risk === 'high') return decision;

    // Auto-approve medium risk if within task working directory
    if (decision.requiresApproval && decision.risk === 'medium') {
      // Check if the operation is within the task's working directory
      const path = String(args.path || args.from || args.savePath || '');
      if (path) {
        const resolved = this.resolvePath(path);
        if (resolved.startsWith(this.taskMode.workingDir)) {
          return {
            ...decision,
            requiresApproval: false,
            reason: `${decision.reason} [auto-godkjent i oppgavemodus]`,
          };
        }
      }

      // For shell commands, auto-approve if cwd is in task dir
      if (toolName === 'run_command') {
        const cwd = String(args.cwd || '');
        if (cwd) {
          const resolvedCwd = this.resolvePath(cwd);
          if (resolvedCwd.startsWith(this.taskMode.workingDir)) {
            return {
              ...decision,
              requiresApproval: false,
              reason: `${decision.reason} [auto-godkjent i oppgavemodus]`,
            };
          }
        }
      }
    }

    return decision;
  }
}
