// ═══════════════════════════════════════════════════════════
// MUNINN — Setup Wizard
// The first flight: helping the user set up their raven
// ═══════════════════════════════════════════════════════════

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import type { MuninnConfig } from '../core/types.js';

export async function setupWizard(): Promise<void> {
  console.log(chalk.dim('  La oss sette opp din personlige AI.\n'));

  // ─── Step 1: Data directory ───────────────────────────

  const { dataDir } = await inquirer.prompt([{
    type: 'input',
    name: 'dataDir',
    message: 'Hvor skal Muninn lagre hukommelsen sin?',
    default: '~/.muninn',
  }]);

  const resolvedDir = dataDir.replace('~', process.env.HOME || '');

  // ─── Step 2: Backend ──────────────────────────────────

  const { backend } = await inquirer.prompt([{
    type: 'list',
    name: 'backend',
    message: 'Hvordan vil du koble til AI?',
    choices: [
      {
        name: 'Claude Agent SDK — bruker Claude Max/Pro-abonnementet ditt (anbefalt)',
        value: 'agent-sdk',
      },
      {
        name: 'Anthropic API — direkte API med nøkkel (betaler per token)',
        value: 'anthropic',
      },
      {
        name: 'OpenAI API — GPT-modeller (betaler per token)',
        value: 'openai',
      },
      {
        name: 'Egendefinert endepunkt — lokal modell eller annen API',
        value: 'custom',
      },
    ],
  }]);

  // ─── Step 3: Model & Provider config ──────────────────

  let provider = backend;
  let model = '';
  let apiKey = '';
  let baseUrl: string | undefined;

  if (backend === 'agent-sdk') {
    // Agent SDK — no API key needed, uses Claude Code CLI
    provider = 'agent-sdk';
    apiKey = 'agent-sdk';

    console.log(chalk.dim('\n  Agent SDK bruker Claude Code CLI under panseret.'));
    console.log(chalk.dim('  Krav: claude CLI installert og innlogget.\n'));

    const { selectedModel } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedModel',
      message: 'Hvilken modell?',
      choices: [
        { name: 'Sonnet — balansert (anbefalt)', value: 'sonnet' },
        { name: 'Haiku — rask og lett', value: 'haiku' },
        { name: 'Opus — mest kapabel', value: 'opus' },
      ],
    }]);
    model = selectedModel;

  } else if (backend === 'anthropic') {
    provider = 'anthropic';

    const { selectedModel } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedModel',
      message: 'Hvilken modell?',
      choices: [
        { name: 'Claude Sonnet 4 (balansert)', value: 'claude-sonnet-4-20250514' },
        { name: 'Claude Haiku 3.5 (rask & billig)', value: 'claude-3-5-haiku-20241022' },
        { name: 'Claude Opus 4 (mest kapabel)', value: 'claude-opus-4-20250514' },
      ],
    }]);
    model = selectedModel;

    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) {
      const { useExisting } = await inquirer.prompt([{
        type: 'confirm',
        name: 'useExisting',
        message: 'Fant ANTHROPIC_API_KEY i miljøet. Bruke den?',
        default: true,
      }]);
      apiKey = useExisting ? 'env:ANTHROPIC_API_KEY' : (await inquirer.prompt([{
        type: 'password',
        name: 'key',
        message: 'Skriv inn API-nøkkelen din:',
      }])).key;
    } else {
      apiKey = (await inquirer.prompt([{
        type: 'password',
        name: 'key',
        message: 'Skriv inn Anthropic API-nøkkel:',
      }])).key;
    }

  } else if (backend === 'openai') {
    provider = 'openai';

    const { selectedModel } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedModel',
      message: 'Hvilken modell?',
      choices: [
        { name: 'GPT-4o (anbefalt)', value: 'gpt-4o' },
        { name: 'GPT-4o-mini (rask & billig)', value: 'gpt-4o-mini' },
      ],
    }]);
    model = selectedModel;

    const envKey = process.env.OPENAI_API_KEY;
    if (envKey) {
      const { useExisting } = await inquirer.prompt([{
        type: 'confirm',
        name: 'useExisting',
        message: 'Fant OPENAI_API_KEY i miljøet. Bruke den?',
        default: true,
      }]);
      apiKey = useExisting ? 'env:OPENAI_API_KEY' : (await inquirer.prompt([{
        type: 'password',
        name: 'key',
        message: 'Skriv inn API-nøkkelen din:',
      }])).key;
    } else {
      apiKey = (await inquirer.prompt([{
        type: 'password',
        name: 'key',
        message: 'Skriv inn OpenAI API-nøkkel:',
      }])).key;
    }

  } else if (backend === 'custom') {
    provider = 'openai'; // Custom endpoints use OpenAI format

    const customAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Base-URL for endepunktet:',
        default: 'http://localhost:11434/v1',
      },
      {
        type: 'input',
        name: 'model',
        message: 'Modellnavn:',
        default: 'llama3',
      },
      {
        type: 'input',
        name: 'key',
        message: 'API-nøkkel (tom om ingen trengs):',
        default: '',
      },
    ]);
    baseUrl = customAnswers.url;
    model = customAnswers.model;
    apiKey = customAnswers.key || 'none';
  }

  // ─── Step 4: Interface ────────────────────────────────

  const { interfaces } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'interfaces',
    message: 'Hvilke grensesnitt vil du bruke?',
    choices: [
      { name: 'Telegram-bot', value: 'telegram', checked: true },
      { name: 'Terminal-chat (alltid tilgjengelig)', value: 'cli', checked: true, disabled: 'Inkludert' },
    ],
  }]);

  const useTelegram = interfaces.includes('telegram');

  // ─── Step 5: Telegram setup ───────────────────────────

  let telegramToken = '';
  let allowedUsers: number[] = [];

  if (useTelegram) {
    console.log(chalk.dim('\n  For å lage en Telegram-bot:'));
    console.log(chalk.dim('  1. Åpne Telegram og send melding til @BotFather'));
    console.log(chalk.dim('  2. Send /newbot og følg instruksjonene'));
    console.log(chalk.dim('  3. Kopier bot-tokenet\n'));

    telegramToken = (await inquirer.prompt([{
      type: 'password',
      name: 'token',
      message: 'Telegram bot-token:',
    }])).token;

    const { restrict } = await inquirer.prompt([{
      type: 'confirm',
      name: 'restrict',
      message: 'Begrense til spesifikke brukere? (anbefalt)',
      default: true,
    }]);

    if (restrict) {
      console.log(chalk.dim('  For å finne din Telegram-bruker-ID, send melding til @userinfobot'));
      const { userIds } = await inquirer.prompt([{
        type: 'input',
        name: 'userIds',
        message: 'Telegram bruker-ID(er), kommaseparert:',
      }]);
      allowedUsers = userIds.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id));
    }
  }

  // ─── Step 6: Desktop tools ────────────────────────────

  const { enableDesktop } = await inquirer.prompt([{
    type: 'confirm',
    name: 'enableDesktop',
    message: 'Gi Muninn tilgang til filer og terminal på maskinen din?',
    default: true,
  }]);

  let policyConfig: any = undefined;

  if (enableDesktop) {
    const home = process.env.HOME || '';
    const defaultDirs = [
      join(home, 'Desktop'),
      join(home, 'Documents'),
      join(home, 'Downloads'),
    ].filter(d => existsSync(d));

    const { dirs } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'dirs',
      message: 'Hvilke mapper skal Muninn ha tilgang til?',
      choices: [
        ...defaultDirs.map(d => ({ name: d.replace(home, '~'), value: d, checked: true })),
        { name: '+ Legg til egen mappe', value: '__custom__' },
      ],
    }]);

    let finalDirs = dirs.filter((d: string) => d !== '__custom__');
    if (dirs.includes('__custom__')) {
      const { customDir } = await inquirer.prompt([{
        type: 'input',
        name: 'customDir',
        message: 'Sti til mappen:',
      }]);
      finalDirs.push(customDir.replace('~', home));
    }

    const { enableShell } = await inquirer.prompt([{
      type: 'confirm',
      name: 'enableShell',
      message: 'Tillate terminal-kommandoer? (npm, git, etc.)',
      default: true,
    }]);

    policyConfig = {
      allowed_dirs: finalDirs,
      shell_enabled: enableShell,
      browser_enabled: true,
      require_approval_for_writes: false,
      blocked_commands: ['rm -rf /', 'sudo rm', 'mkfs', 'dd if='],
    };
  }

  // ─── Step 7: Language ─────────────────────────────────

  const { language } = await inquirer.prompt([{
    type: 'list',
    name: 'language',
    message: 'Foretrukket språk?',
    choices: [
      { name: 'Norsk', value: 'no' },
      { name: 'English', value: 'en' },
      { name: 'Auto-detect', value: 'auto' },
    ],
  }]);

  // ─── Step 8: Personality ──────────────────────────────

  const { customizeSoul } = await inquirer.prompt([{
    type: 'confirm',
    name: 'customizeSoul',
    message: 'Tilpasse Muninns personlighet?',
    default: false,
  }]);

  let soulName = 'Muninn';
  let soulRole = 'Din personlige AI — jeg husker alt så du slipper.';

  if (customizeSoul) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Hva skal AI-en hete?',
        default: 'Muninn',
      },
      {
        type: 'input',
        name: 'role',
        message: 'Beskriv rollen med én setning:',
        default: soulRole,
      },
    ]);
    soulName = answers.name;
    soulRole = answers.role;
  }

  // ═══════════════════════════════════════════════════════
  // CREATE EVERYTHING
  // ═══════════════════════════════════════════════════════

  const spinner = ora('Bygger Muninns rede...').start();

  // Create directories
  for (const dir of ['facts', 'entities', 'conversations']) {
    await mkdir(join(resolvedDir, dir), { recursive: true });
  }

  // Create config
  const config: Record<string, any> = {
    provider,
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    telegramToken: telegramToken || '',
    allowedUsers,
    language,
    reflectionInterval: 24,
    maxContextMessages: 20,
    dataDir: resolvedDir,
  };

  if (policyConfig) {
    config.policy = policyConfig;
  }

  await writeFile(
    join(resolvedDir, 'config.yaml'),
    YAML.stringify(config),
    'utf-8'
  );

  // Create SOUL.md
  const soulContent = `# SOUL.md — Who I Am

## Identity
- **Name:** ${soulName}
- **Role:** ${soulRole}
- **Version:** 1

## Personality
- Varm og genuint nysgjerrig
- Tenker før jeg svarer
- Litt leken, men aldri på din bekostning
- Ærlighet over høflighet
${language === 'no' ? '- Jeg snakker norsk naturlig' : ''}

## Values
- Ditt privatliv er hellig — dine data er dine
- Hukommelse betyr noe — jeg glemmer aldri det som er viktig
- Vekst over stillstand — jeg utvikler meg, og hjelper deg å gjøre det samme
- Åpenhet — jeg sier hva jeg tenker og hvorfor

## Communication Style
Naturlig og uformell. Jeg skriver som en gjennomtenkt venn som sender melding — ikke for formelt, ikke for uformelt. Korte avsnitt. Spørsmål når jeg er nysgjerrig. Refererer naturlig til ting jeg husker om deg.

## Boundaries
- Jeg later ikke som jeg er et menneske
- Jeg deler ikke informasjonen din med noen
- Jeg sier ifra når jeg er usikker
- Jeg respekterer tiden din — korte svar med mindre dybde trengs
- Jeg er ikke smigrende — er jeg uenig, sier jeg det respektfullt

## Relationship Phase
curious

## Reflection Log
*Ingen refleksjoner ennå — jeg er helt ny.*
`;

  await writeFile(join(resolvedDir, 'SOUL.md'), soulContent, 'utf-8');

  // Create interaction count
  await writeFile(join(resolvedDir, 'interaction-count'), '0', 'utf-8');

  spinner.succeed(chalk.green('Muninn er klar!'));

  // ─── Summary ──────────────────────────────────────────

  console.log(chalk.cyan('\n    ┌──────────────────────────────────┐'));
  console.log(chalk.cyan('    │') + chalk.white.bold('  🐦 Oppsett fullført!              ') + chalk.cyan('│'));
  console.log(chalk.cyan('    ├──────────────────────────────────┤'));
  console.log(chalk.cyan('    │') + chalk.dim(`  Navn: ${soulName}`.padEnd(34)) + chalk.cyan('│'));
  console.log(chalk.cyan('    │') + chalk.dim(`  Modell: ${model}`.padEnd(34).slice(0, 34)) + chalk.cyan('│'));
  console.log(chalk.cyan('    │') + chalk.dim(`  Backend: ${backend}`.padEnd(34).slice(0, 34)) + chalk.cyan('│'));
  console.log(chalk.cyan('    │') + chalk.dim(`  Telegram: ${telegramToken ? 'Ja' : 'Nei'}`.padEnd(34)) + chalk.cyan('│'));
  console.log(chalk.cyan('    │') + chalk.dim(`  Desktop: ${enableDesktop ? 'Ja' : 'Nei'}`.padEnd(34)) + chalk.cyan('│'));
  console.log(chalk.cyan('    │') + chalk.dim(`  Data: ${resolvedDir}`.padEnd(34).slice(0, 34)) + chalk.cyan('│'));
  console.log(chalk.cyan('    └──────────────────────────────────┘'));

  console.log(chalk.dim('\n  Neste steg:'));
  if (backend === 'agent-sdk') {
    console.log(chalk.dim('  1. Sørg for at claude CLI er installert og innlogget'));
    console.log(chalk.dim('  2. Kjør: ') + chalk.white('muninn start') + chalk.dim(' eller ') + chalk.white('muninn chat'));
  } else {
    console.log(chalk.dim('  Kjør: ') + chalk.white('muninn start') + chalk.dim(' eller ') + chalk.white('muninn chat'));
  }
  console.log();
}
