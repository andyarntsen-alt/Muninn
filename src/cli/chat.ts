// ═══════════════════════════════════════════════════════════
// MUNINN — CLI Chat Mode
// Test the raven without Telegram — pure terminal conversation
// ═══════════════════════════════════════════════════════════

import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import YAML from 'yaml';
import type { MuninnConfig } from '../core/types.js';
import { HuginnRuntime } from '../core/runtime.js';
import { MemoryEngine } from '../memory/memory-engine.js';
import { SoulManager } from '../identity/soul-manager.js';
import { GoalsManager } from '../identity/goals-manager.js';
import { Reflector } from '../reflection/reflector.js';
import { initializeTools } from '../tools/index.js';

/**
 * CLI Chat — a REPL for talking to Muninn in the terminal.
 *
 * No Telegram needed. Perfect for:
 * - Testing the runtime
 * - Debugging memory and soul
 * - Quick interactions when you don't want to open Telegram
 */
export async function startChat(dataDir: string): Promise<void> {
  console.log(chalk.cyan(`
    ╭──────────────────────────────╮
    │       🐦 M U N I N N        │
    │       CLI Chat Mode          │
    ╰──────────────────────────────╯
  `));

  // ─── Load config ─────────────────────────────────────────
  const configPath = join(dataDir, 'config.yaml');
  if (!existsSync(configPath)) {
    console.error(chalk.red('❌ No config found. Run: muninn init'));
    process.exit(1);
  }

  const configContent = await readFile(configPath, 'utf-8');
  const config: MuninnConfig = YAML.parse(configContent);

  // Resolve env: references
  if (config.apiKey.startsWith('env:')) {
    const envVar = config.apiKey.replace('env:', '');
    const value = process.env[envVar];
    if (!value) {
      console.error(chalk.red(`❌ Environment variable ${envVar} not set.`));
      process.exit(1);
    }
    config.apiKey = value;
  }

  config.dataDir = dataDir;

  // ─── Initialize systems ──────────────────────────────────
  console.log(chalk.dim('  Initializing memory...'));
  const memory = new MemoryEngine(dataDir);
  await memory.initialize();

  console.log(chalk.dim('  Loading soul...'));
  const soul = new SoulManager(dataDir);
  await soul.initialize();

  console.log(chalk.dim('  Loading goals...'));
  const goals = new GoalsManager(dataDir);
  await goals.initialize();

  console.log(chalk.dim('  Loading tools...'));
  const { tools } = await initializeTools(dataDir);

  console.log(chalk.dim('  Starting runtime...'));
  const reflector = new Reflector(config, memory, soul, goals);
  const runtime = new HuginnRuntime({
    config,
    memoryEngine: memory,
    soulManager: soul,
    goalsManager: goals,
    reflector,
    tools,
  });

  const currentSoul = await soul.getSoul();
  console.log(chalk.green(`\n  🐦 ${currentSoul.name} is ready.`));
  console.log(chalk.dim(`  Phase: ${currentSoul.relationshipPhase} | Facts: ${memory.getFactCount()} | Interactions: ${currentSoul.interactionCount}`));
  console.log(chalk.dim('  Type your message, or use these commands:'));
  console.log(chalk.dim('    /status  — relationship status'));
  console.log(chalk.dim('    /memory  — what I remember'));
  console.log(chalk.dim('    /soul    — current SOUL.md'));
  console.log(chalk.dim('    /reflect — trigger reflection'));
  console.log(chalk.dim('    /facts   — raw fact dump'));
  console.log(chalk.dim('    /quit    — exit\n'));

  // ─── REPL ────────────────────────────────────────────────
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.blue('you → '),
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Handle commands
    if (input.startsWith('/')) {
      await handleCommand(input, runtime, memory, soul, reflector);
      rl.prompt();
      return;
    }

    // Process message
    try {
      process.stdout.write(chalk.yellow('🐦 thinking...'));

      const response = await runtime.processMessage(input, 'cli-user');

      // Clear "thinking..." and print response
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      console.log(chalk.yellow(`🐦 ${currentSoul.name} → `) + response);
      console.log();
    } catch (error) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.log(chalk.red(`❌ Error: ${msg}`));
      console.log();
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    console.log(chalk.dim('\n  🐦 Muninn is landing. Goodbye.\n'));
    await runtime.endConversation();
    process.exit(0);
  });
}

/** Handle slash commands in chat mode */
async function handleCommand(
  input: string,
  runtime: HuginnRuntime,
  memory: MemoryEngine,
  soul: SoulManager,
  reflector: Reflector,
): Promise<void> {
  const [command, ...args] = input.split(' ');

  switch (command) {
    case '/status': {
      const relationship = reflector.getRelationshipManager();
      const status = await relationship.getRelationshipStatus();
      console.log('\n' + status + '\n');
      break;
    }

    case '/memory':
    case '/remember': {
      const facts = await memory.getRecentFacts(20);
      if (facts.length === 0) {
        console.log(chalk.dim('\n  No memories yet. Let\'s talk more!\n'));
      } else {
        console.log(chalk.yellow('\n  🧠 What I remember:\n'));
        for (const f of facts) {
          console.log(chalk.dim(`  • ${f.subject} ${f.predicate} ${f.object}`));
        }
        console.log(chalk.dim(`\n  Total active facts: ${memory.getFactCount()}\n`));
      }
      break;
    }

    case '/soul': {
      const raw = await soul.getRawSoul();
      console.log('\n' + chalk.dim(raw) + '\n');
      break;
    }

    case '/reflect': {
      console.log(chalk.dim('\n  🪞 Reflecting...\n'));
      try {
        const result = await reflector.reflect();
        if (result.insights.length > 0) {
          console.log(chalk.yellow('  Insights:'));
          for (const i of result.insights) {
            console.log(chalk.dim(`  • ${i}`));
          }
        }
        if (result.newFacts.length > 0) {
          console.log(chalk.dim(`\n  Discovered ${result.newFacts.length} new inferences.`));
        }
        if (result.updatedSoul) {
          console.log(chalk.green('  Soul updated to new version.'));
        }
        if (result.phaseTransition) {
          console.log(chalk.green(`  🌟 Phase transition: ${result.phaseTransition.from} → ${result.phaseTransition.to}`));
        }
        console.log();
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.log(chalk.red(`  Reflection failed: ${msg}\n`));
      }
      break;
    }

    case '/facts': {
      const allFacts = await memory.getAllFacts();
      console.log(chalk.yellow(`\n  📊 All facts (${allFacts.length} total):\n`));
      for (const f of allFacts) {
        const status = f.invalidAt ? chalk.red('✗') : chalk.green('✓');
        console.log(`  ${status} ${f.subject} ${f.predicate} ${f.object} ${chalk.dim(`[${f.source}, ${f.confidence}]`)}`);
      }
      console.log();
      break;
    }

    case '/quit':
    case '/exit': {
      console.log(chalk.dim('\n  🐦 Muninn is landing. Goodbye.\n'));
      await runtime.endConversation();
      process.exit(0);
    }

    case '/help': {
      console.log(chalk.dim('\n  Commands:'));
      console.log(chalk.dim('    /status  — relationship status'));
      console.log(chalk.dim('    /memory  — what I remember'));
      console.log(chalk.dim('    /soul    — current SOUL.md'));
      console.log(chalk.dim('    /reflect — trigger reflection'));
      console.log(chalk.dim('    /facts   — raw fact dump'));
      console.log(chalk.dim('    /quit    — exit\n'));
      break;
    }

    default: {
      console.log(chalk.dim(`\n  Unknown command: ${command}. Type /help for commands.\n`));
    }
  }
}
