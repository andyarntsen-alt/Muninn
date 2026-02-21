// Quick test: ask Muninn to create a landing page via processMessage
// Bypasses Telegram, auto-approves all tool calls

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import type { MuninnConfig, PolicyConfig, RiskLevel } from './src/core/types.js';
import { HuginnRuntime } from './src/core/runtime.js';
import { MemoryEngine } from './src/memory/memory-engine.js';
import { SoulManager } from './src/identity/soul-manager.js';
import { GoalsManager } from './src/identity/goals-manager.js';
import { Reflector } from './src/reflection/reflector.js';
import { PolicyEngine } from './src/core/policy-engine.js';
import { ApprovalManager } from './src/telegram/approval.js';
import { initializeTools } from './src/tools/index.js';

// Auto-approving approval manager for headless testing
class AutoApprovalManager extends ApprovalManager {
  constructor() {
    super([]);
  }
  async requestApproval(
    tool: string,
    args: Record<string, unknown>,
    risk: RiskLevel,
    description: string,
  ): Promise<boolean> {
    console.log(`[AutoApprove] ${tool}: ${description}`);
    return true;
  }
}

const dataDir = join(import.meta.dirname, 'data');

async function main() {
  const configContent = await readFile(join(dataDir, 'config.yaml'), 'utf-8');
  const config: MuninnConfig = YAML.parse(configContent);

  if (config.apiKey.startsWith('env:')) {
    config.apiKey = process.env[config.apiKey.replace('env:', '')] || '';
  }
  config.dataDir = dataDir;

  const memory = new MemoryEngine(dataDir);
  await memory.initialize();

  const soul = new SoulManager(dataDir);
  await soul.initialize();

  const goals = new GoalsManager(dataDir);
  await goals.initialize();

  const policyConfig: PolicyConfig = config.policy || {
    allowed_dirs: ['~/Desktop', '~/Documents', '~/Downloads'],
    blocked_commands: [],
    shell_enabled: true,
    browser_enabled: true,
    require_approval_for_writes: false,
  };
  policyConfig.require_approval_for_writes = false;

  const policyEngine = new PolicyEngine(policyConfig, dataDir);
  await policyEngine.initialize();

  const approvalManager = new AutoApprovalManager();

  const { tools } = await initializeTools(dataDir, config, memory, policyEngine, approvalManager);

  const reflector = new Reflector(config, memory, soul, goals);
  const runtime = new HuginnRuntime({
    config,
    memoryEngine: memory,
    soulManager: soul,
    goalsManager: goals,
    reflector,
    tools,
  });

  console.log('\n--- Sending message to Muninn ---\n');

  const response = await runtime.processMessage(
    'Skriv en enkel HTML-fil til ~/Desktop/muninn-landing/index.html. Bare en <h1>Muninn</h1> i en mørk side. Bruk write_file direkte.',
    'test-user',
  );

  console.log('\n--- Muninn response ---\n');
  console.log(response);

  const target = join(process.env.HOME || '', 'Desktop/muninn-landing/index.html');
  console.log(`\nFile created: ${existsSync(target)}`);
  if (existsSync(target)) {
    const content = await readFile(target, 'utf-8');
    console.log(`File size: ${content.length} bytes`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
