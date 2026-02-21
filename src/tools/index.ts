// ═══════════════════════════════════════════════════════════
// MUNINN — Tools Registry
// All the tools the raven can use
// ═══════════════════════════════════════════════════════════

import type { Tool, MuninnConfig } from '../core/types.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { PolicyEngine } from '../core/policy-engine.js';
import type { ApprovalManager } from '../telegram/approval.js';
import { createWebSearchTool } from './web-search.js';
import { ReminderStore, createReminderTools } from './reminders.js';
import { TaskStore, createTaskTools } from './tasks.js';
import { createUrlSummarizerTool } from './url-summarizer.js';
import { createConversationSearchTool } from './conversation-search.js';
import { createFilesystemTools } from './filesystem.js';
import { createShellTools } from './shell.js';
import { createBrowserTools } from './browser.js';
import { createScreenshotTool } from './screenshot.js';
import { createGitTools } from './git.js';
import { createClipboardTools } from './clipboard.js';
import { createOpenTool } from './open.js';
import { PluginLoader } from './plugin-loader.js';

export { ReminderStore } from './reminders.js';
export { TaskStore } from './tasks.js';
export { PluginLoader } from './plugin-loader.js';

/**
 * Initialize all built-in tools + plugins.
 * Returns the tools array and the stores (for reminder checking, etc.)
 */
export async function initializeTools(
  dataDir: string,
  config?: MuninnConfig,
  memory?: MemoryEngine,
  policy?: PolicyEngine,
  approval?: ApprovalManager,
): Promise<{
  tools: Tool[];
  reminderStore: ReminderStore;
  taskStore: TaskStore;
}> {
  const reminderStore = new ReminderStore(dataDir);
  await reminderStore.initialize();

  const taskStore = new TaskStore(dataDir);
  await taskStore.initialize();

  const tools: Tool[] = [
    createWebSearchTool(),
    ...createReminderTools(reminderStore),
    ...createTaskTools(taskStore),
  ];

  // Add URL summarizer if config available
  if (config) {
    tools.push(createUrlSummarizerTool(config));
  }

  // Add conversation search if memory available
  if (memory) {
    tools.push(createConversationSearchTool(memory));
  }

  // ─── Agent capabilities (gated by policy engine) ─────────
  if (policy && approval) {
    const policyConfig = policy.getConfig();

    // Filesystem tools — always available when policy is configured
    tools.push(...createFilesystemTools(policy, approval));
    console.log('[Tools] Filesystem tools enabled');

    // Shell tools — only if enabled in config
    if (policyConfig.shell_enabled) {
      tools.push(...createShellTools(policy, approval));
      console.log('[Tools] Shell tools enabled');
    }

    // Browser tools — only if enabled in config
    if (policyConfig.browser_enabled) {
      tools.push(...createBrowserTools(policy, approval));
      console.log('[Tools] Browser tools enabled');
    }

    // Screenshot tool (with approval gating)
    tools.push(createScreenshotTool(dataDir, approval));
    console.log('[Tools] Screenshot tool enabled');

    // Git tools — always available when policy is configured
    tools.push(...createGitTools(policy, approval));
    console.log('[Tools] Git tools enabled');

    // Clipboard tools (macOS pbpaste/pbcopy)
    tools.push(...createClipboardTools(policy, approval));
    console.log('[Tools] Clipboard tools enabled');

    // Open tool (macOS open command)
    tools.push(createOpenTool(policy, approval));
    console.log('[Tools] Open tool enabled');
  }

  // Load plugins
  const pluginLoader = new PluginLoader(dataDir);
  const pluginTools = await pluginLoader.loadPlugins();
  tools.push(...pluginTools);

  if (pluginTools.length > 0) {
    console.log(`[Tools] Loaded ${pluginTools.length} plugin tools`);
  }

  console.log(`[Tools] ${tools.length} tools available`);

  return { tools, reminderStore, taskStore };
}
