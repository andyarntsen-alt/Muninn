// ═══════════════════════════════════════════════════════════
// MUNINN — Entry Point
// Where two ravens take flight
// ═══════════════════════════════════════════════════════════

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import cron from 'node-cron';
import type { MuninnConfig, PolicyConfig } from './core/types.js';
import { HuginnRuntime } from './core/runtime.js';
import { MemoryEngine } from './memory/memory-engine.js';
import { SoulManager } from './identity/soul-manager.js';
import { GoalsManager } from './identity/goals-manager.js';
import { Reflector } from './reflection/reflector.js';
import { MuninnBot } from './telegram/bot.js';
import { ProactiveEngine } from './telegram/proactive.js';
import { PolicyEngine } from './core/policy-engine.js';
import { ApprovalManager } from './telegram/approval.js';
import { initializeTools } from './tools/index.js';

/** Default policy config — conservative defaults */
const DEFAULT_POLICY: PolicyConfig = {
  allowed_dirs: [],
  blocked_commands: [],
  shell_enabled: false,
  browser_enabled: true,
  require_approval_for_writes: true,
};

/**
 * Start Muninn — the full system.
 *
 * Initialization order:
 * 1. Load config
 * 2. Initialize memory (Muninn — the memory raven)
 * 3. Initialize soul (identity system)
 * 4. Initialize policy engine + approval system
 * 5. Initialize tools (+ plugins)
 * 6. Initialize reflector
 * 7. Initialize runtime (Huginn — the reasoning raven)
 * 8. Initialize proactive engine
 * 9. Start Telegram bot
 * 10. Start cron jobs (reminders, reflection, proactive)
 */
export async function startMuninn(dataDir: string): Promise<void> {
  console.log('🐦 Muninn is waking up...\n');

  // ─── 1. Load config ─────────────────────────────────────
  const configPath = join(dataDir, 'config.yaml');
  if (!existsSync(configPath)) {
    console.error('❌ No config found. Run: muninn init');
    process.exit(1);
  }

  const configContent = await readFile(configPath, 'utf-8');
  const config: MuninnConfig = YAML.parse(configContent);

  // Resolve env: references in API key
  if (config.apiKey.startsWith('env:')) {
    const envVar = config.apiKey.replace('env:', '');
    const value = process.env[envVar];
    if (!value) {
      console.error(`❌ Environment variable ${envVar} not set.`);
      process.exit(1);
    }
    config.apiKey = value;
  }

  // Resolve telegram token env references
  if (config.telegramToken.startsWith('env:')) {
    const envVar = config.telegramToken.replace('env:', '');
    const value = process.env[envVar];
    if (!value) {
      console.error(`❌ Environment variable ${envVar} not set.`);
      process.exit(1);
    }
    config.telegramToken = value;
  }

  config.dataDir = dataDir;

  // ─── 2. Initialize Memory ──────────────────────────────
  console.log('🧠 Initializing memory...');
  const memory = new MemoryEngine(dataDir);
  await memory.initialize();

  // ─── 3. Initialize Soul ────────────────────────────────
  console.log('👤 Loading soul...');
  const soul = new SoulManager(dataDir);
  await soul.initialize();

  // ─── 3b. Initialize Goals ───────────────────────────────
  console.log('🎯 Loading goals...');
  const goals = new GoalsManager(dataDir);
  await goals.initialize();

  // ─── 4. Initialize Policy Engine + Approval ─────────────
  const policyConfig: PolicyConfig = config.policy || DEFAULT_POLICY;
  let policyEngine: PolicyEngine | undefined;
  let approvalManager: ApprovalManager | undefined;

  if (policyConfig.allowed_dirs.length > 0 || policyConfig.shell_enabled || policyConfig.browser_enabled) {
    console.log('🛡️  Initializing policy engine...');
    policyEngine = new PolicyEngine(policyConfig, dataDir);
    await policyEngine.initialize();

    approvalManager = new ApprovalManager(config.allowedUsers);

    console.log(`[Policy] Allowed dirs: ${policyConfig.allowed_dirs.join(', ') || '(none)'}`);
    console.log(`[Policy] Shell: ${policyConfig.shell_enabled ? 'ON' : 'OFF'}`);
    console.log(`[Policy] Browser: ${policyConfig.browser_enabled ? 'ON' : 'OFF'}`);
  }

  // ─── 5. Initialize Tools ───────────────────────────────
  console.log('🔧 Loading tools...');
  const { tools, reminderStore, taskStore } = await initializeTools(
    dataDir, config, memory, policyEngine, approvalManager
  );

  // ─── 6. Initialize Reflector ───────────────────────────
  console.log('🪞 Setting up reflection...');
  const reflector = new Reflector(config, memory, soul, goals);

  // ─── 7. Initialize Runtime ─────────────────────────────
  console.log('⚡ Starting Huginn runtime...');
  const runtime = new HuginnRuntime({
    config,
    memoryEngine: memory,
    soulManager: soul,
    goalsManager: goals,
    reflector,
    tools,
  });

  // ─── 8. Initialize Proactive Engine ────────────────────
  console.log('🔔 Setting up proactive messaging...');
  const proactive = new ProactiveEngine(config, memory, soul, reminderStore, taskStore);
  await proactive.initialize();

  // ─── 9. Start Telegram Bot ─────────────────────────────
  console.log('💬 Connecting to Telegram...');
  const bot = new MuninnBot(config, runtime, reflector, soul, memory, goals);
  bot.setProactiveEngine(proactive);

  // Connect approval manager to bot (for inline keyboard callbacks)
  if (approvalManager) {
    bot.setApprovalManager(approvalManager);
  }

  await bot.start();

  // ─── 10. Start Cron Jobs ────────────────────────────────

  // Check reminders every minute — deliver through Huginn for natural phrasing
  cron.schedule('* * * * *', async () => {
    const due = await reminderStore.getDue();
    for (const reminder of due) {
      console.log(`[Reminder] Due: ${reminder.text}`);
      for (const userId of config.allowedUsers) {
        try {
          const response = await runtime.processMessage(
            `[SYSTEM: A reminder is now due. Remind the user about: "${reminder.text}". Be natural and brief — don't say "you asked me to remind you", just bring it up naturally.]`,
            userId.toString(),
          );
          await bot.sendMessage(userId, response);
        } catch (err) {
          await bot.sendMessage(userId, `⏰ Reminder: ${reminder.text}`).catch(() => {});
          console.error(`[Reminder] Failed to deliver to ${userId}:`, err);
        }
      }
      await reminderStore.markNotified(reminder.id);
    }
  });

  // Check for proactive messages every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const messages = await proactive.checkForMessages();
      for (const msg of messages) {
        for (const userId of config.allowedUsers) {
          await bot.sendMessage(userId, msg.text);
        }
      }
    } catch (error) {
      console.error('[Cron] Proactive check failed:', error);
    }
  });

  // Reflection check every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      await runtime.maybeReflect();
    } catch (error) {
      console.error('[Cron] Reflection check failed:', error);
    }
  });

  console.log('\n🐦 Muninn is airborne. Waiting for messages...\n');

  // ─── Graceful shutdown ─────────────────────────────────
  const shutdown = async () => {
    console.log('\n🐦 Muninn is landing...');
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Direct execution only when run as main module (not when imported by CLI)
const isDirectRun = process.argv[1]?.endsWith('/index.js') && !process.argv[1]?.includes('/cli/');
if (isDirectRun) {
  const args = process.argv.slice(2);
  if (args.length > 0 && !args[0].startsWith('-')) {
    const dataDir = args[0].replace('~', process.env.HOME || '');
    startMuninn(dataDir);
  }
}
