#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// MUNINN — CLI Entry Point
// Type `muninn` and the raven appears
// ═══════════════════════════════════════════════════════════

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { setupWizard } from './setup.js';
import { startMuninn } from '../index.js';
import { startChat } from './chat.js';

// ─── ASCII Art ──────────────────────────────────────────

const RAVEN_BANNER = `
${chalk.cyan('    ┌─────────────────────────────────────┐')}
${chalk.cyan('    │')}                                       ${chalk.cyan('│')}
${chalk.cyan('    │')}    ${chalk.white.bold('🐦  M U N I N N')}                    ${chalk.cyan('│')}
${chalk.cyan('    │')}    ${chalk.dim('Your AI that remembers everything')}   ${chalk.cyan('│')}
${chalk.cyan('    │')}                                       ${chalk.cyan('│')}
${chalk.cyan('    └─────────────────────────────────────┘')}
`;

const RAVEN_WELCOME_BACK = (name: string, phase: string, facts: number, interactions: number) => `
${chalk.cyan('    ┌─────────────────────────────────────┐')}
${chalk.cyan('    │')}                                       ${chalk.cyan('│')}
${chalk.cyan('    │')}    ${chalk.white.bold(`🐦  ${name.toUpperCase()}`)}${' '.repeat(Math.max(0, 32 - name.length))}${chalk.cyan('│')}
${chalk.cyan('    │')}    ${chalk.dim('Your AI that remembers everything')}   ${chalk.cyan('│')}
${chalk.cyan('    │')}                                       ${chalk.cyan('│')}
${chalk.cyan('    │')}    ${chalk.dim(`Fase: ${phase}`)}${' '.repeat(Math.max(0, 31 - phase.length - 6))}${chalk.cyan('│')}
${chalk.cyan('    │')}    ${chalk.dim(`Minner: ${facts} fakta`)}${' '.repeat(Math.max(0, 31 - String(facts).length - 14))}${chalk.cyan('│')}
${chalk.cyan('    │')}    ${chalk.dim(`Samtaler: ${interactions}`)}${' '.repeat(Math.max(0, 31 - String(interactions).length - 10))}${chalk.cyan('│')}
${chalk.cyan('    │')}                                       ${chalk.cyan('│')}
${chalk.cyan('    └─────────────────────────────────────┘')}
`;

// ─── Helpers ────────────────────────────────────────────

const DEFAULT_DATA_DIR = join(process.env.HOME || '', '.muninn');

function isConfigured(dataDir: string): boolean {
  return existsSync(join(dataDir, 'config.yaml'));
}

async function getSoulInfo(dataDir: string): Promise<{ name: string; phase: string; interactions: number } | null> {
  try {
    const soulPath = join(dataDir, 'SOUL.md');
    if (!existsSync(soulPath)) return null;

    const content = await readFile(soulPath, 'utf-8');

    const nameMatch = content.match(/\*\*Name:\*\*\s*(.+)/);
    const phaseMatch = content.match(/## Relationship Phase\s*\n(\w+)/);
    const name = nameMatch ? nameMatch[1].trim() : 'Muninn';
    const phase = phaseMatch ? phaseMatch[1].trim() : 'curious';

    const countPath = join(dataDir, 'interaction-count');
    const interactions = existsSync(countPath)
      ? parseInt(await readFile(countPath, 'utf-8'), 10) || 0
      : 0;

    return { name, phase, interactions };
  } catch {
    return null;
  }
}

async function getFactCount(dataDir: string): Promise<number> {
  try {
    const factsDir = join(dataDir, 'facts');
    if (!existsSync(factsDir)) return 0;
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(factsDir);
    return files.filter(f => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

// ─── Interactive Default Command ────────────────────────

async function interactiveStart(): Promise<void> {
  const dataDir = DEFAULT_DATA_DIR;

  if (!isConfigured(dataDir)) {
    // ─── First time: show welcome + run setup ───────────
    console.log(RAVEN_BANNER);
    console.log(chalk.dim('  Velkommen! La oss sette opp Muninn.\n'));

    await setupWizard();
    return;
  }

  // ─── Returning user: show status + menu ─────────────
  const soulInfo = await getSoulInfo(dataDir);
  const factCount = await getFactCount(dataDir);

  if (soulInfo) {
    console.log(RAVEN_WELCOME_BACK(soulInfo.name, soulInfo.phase, factCount, soulInfo.interactions));
  } else {
    console.log(RAVEN_BANNER);
  }

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Hva vil du gjøre?',
    choices: [
      { name: '🚀  Start Telegram-bot', value: 'start' },
      { name: '💬  Chat i terminalen', value: 'chat' },
      { name: '📊  Vis status', value: 'status' },
      { name: '⚙️   Kjør setup på nytt', value: 'setup' },
      { name: '📦  Eksporter data', value: 'export' },
      { name: '👋  Avslutt', value: 'quit' },
    ],
  }]);

  switch (action) {
    case 'start':
      await startMuninn(dataDir);
      break;

    case 'chat':
      await startChat(dataDir);
      break;

    case 'status':
      await showStatus(dataDir);
      break;

    case 'setup':
      await setupWizard();
      break;

    case 'export':
      await exportData(dataDir);
      break;

    case 'quit':
      console.log(chalk.dim('\n  🐦 Vi ses!\n'));
      break;
  }
}

// ─── Status ─────────────────────────────────────────────

async function showStatus(dataDir: string): Promise<void> {
  const soulInfo = await getSoulInfo(dataDir);
  const factCount = await getFactCount(dataDir);

  console.log(chalk.cyan('\n  ─── Status ───────────────────────\n'));

  if (soulInfo) {
    console.log(`  ${chalk.white('Navn:')}        ${soulInfo.name}`);
    console.log(`  ${chalk.white('Fase:')}        ${soulInfo.phase}`);
    console.log(`  ${chalk.white('Minner:')}      ${factCount} fakta`);
    console.log(`  ${chalk.white('Samtaler:')}    ${soulInfo.interactions}`);
  }

  console.log(`  ${chalk.white('Datamappe:')}   ${dataDir}`);

  // Show config info
  try {
    const configContent = await readFile(join(dataDir, 'config.yaml'), 'utf-8');
    const config = YAML.parse(configContent);
    console.log(`  ${chalk.white('Modell:')}      ${config.model || '(standard)'}`);
    console.log(`  ${chalk.white('Provider:')}    ${config.provider || 'agent-sdk'}`);
    console.log(`  ${chalk.white('Telegram:')}    ${config.telegramToken ? '✅ Konfigurert' : '❌ Ikke satt opp'}`);

    if (config.policy) {
      console.log(`  ${chalk.white('Shell:')}       ${config.policy.shell_enabled ? '✅ På' : '❌ Av'}`);
      console.log(`  ${chalk.white('Mapper:')}      ${config.policy.allowed_dirs?.join(', ') || '(ingen)'}`);
    }
  } catch {
    // Config might be missing/broken
  }

  // Show SOUL.md
  const soulPath = join(dataDir, 'SOUL.md');
  if (existsSync(soulPath)) {
    const soulContent = await readFile(soulPath, 'utf-8');
    console.log(chalk.cyan('\n  ─── SOUL.md ──────────────────────\n'));
    console.log(chalk.dim(soulContent.split('\n').map(l => '  ' + l).join('\n')));
  }

  console.log();
}

// ─── Export ─────────────────────────────────────────────

async function exportData(dataDir: string): Promise<void> {
  const { MemoryEngine } = await import('../memory/memory-engine.js');
  const memory = new MemoryEngine(dataDir);
  await memory.initialize();

  const data = await memory.exportAll();
  const { writeFile: writeFs } = await import('node:fs/promises');
  const outputPath = './muninn-export.json';
  await writeFs(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(chalk.green(`\n  ✅ Eksportert til ${outputPath}`));
  console.log(chalk.dim(`     Fakta: ${data.facts.length}`));
  console.log(chalk.dim(`     Entiteter: ${data.entities.length}`));
  console.log(chalk.dim(`     Samtaler: ${data.conversations.length}\n`));
}

// ─── Commander (for subcommands) ────────────────────────

const program = new Command();

program
  .name('muninn')
  .description('🐦 Muninn — Your personal AI that remembers everything')
  .version('0.1.0');

// Default action: interactive menu
program
  .action(async () => {
    await interactiveStart();
  });

program
  .command('init')
  .description('Sett opp Muninn for første gang')
  .action(async () => {
    console.log(RAVEN_BANNER);
    await setupWizard();
  });

program
  .command('start')
  .description('Start Telegram-bot')
  .option('-d, --data-dir <path>', 'Datamappe', DEFAULT_DATA_DIR)
  .action(async (options) => {
    const dataDir = options.dataDir.replace('~', process.env.HOME || '');
    await startMuninn(dataDir);
  });

program
  .command('chat')
  .description('Chat med Muninn i terminalen')
  .option('-d, --data-dir <path>', 'Datamappe', DEFAULT_DATA_DIR)
  .action(async (options) => {
    const dataDir = options.dataDir.replace('~', process.env.HOME || '');
    await startChat(dataDir);
  });

program
  .command('status')
  .description('Vis Muninns status')
  .option('-d, --data-dir <path>', 'Datamappe', DEFAULT_DATA_DIR)
  .action(async (options) => {
    const dataDir = options.dataDir.replace('~', process.env.HOME || '');
    await showStatus(dataDir);
  });

program
  .command('export')
  .description('Eksporter all Muninn-data som JSON')
  .option('-d, --data-dir <path>', 'Datamappe', DEFAULT_DATA_DIR)
  .action(async (options) => {
    const dataDir = options.dataDir.replace('~', process.env.HOME || '');
    await exportData(dataDir);
  });

program.parse();
