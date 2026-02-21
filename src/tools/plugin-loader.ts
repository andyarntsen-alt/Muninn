// ═══════════════════════════════════════════════════════════
// MUNINN — Plugin System
// Extend the raven's abilities — the WordPress model for AI
// ═══════════════════════════════════════════════════════════

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '../core/types.js';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  tools: PluginToolDef[];
}

export interface PluginToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  /** Command to execute — receives JSON args via stdin, returns result via stdout */
  command: string;
}

/**
 * Plugin Loader — discovers and loads tools from the plugins directory.
 *
 * Plugin structure:
 * ~/.muninn/plugins/
 *   my-plugin/
 *     manifest.json    — Plugin definition
 *     index.js         — Main script (optional, for JS plugins)
 *     ...
 *
 * Each plugin defines tools in manifest.json. Tools can either:
 * 1. Execute a shell command (receives args as JSON stdin)
 * 2. Run a JS module (imported dynamically)
 *
 * This is the "app store" foundation — anyone can write a plugin.
 */
export class PluginLoader {
  private pluginsDir: string;
  private loadedPlugins: Map<string, PluginManifest> = new Map();

  constructor(dataDir: string) {
    this.pluginsDir = join(dataDir, 'plugins');
  }

  /** Discover and load all plugins */
  async loadPlugins(): Promise<Tool[]> {
    if (!existsSync(this.pluginsDir)) {
      return [];
    }

    const tools: Tool[] = [];
    const entries = await readdir(this.pluginsDir);

    for (const entry of entries) {
      const pluginDir = join(this.pluginsDir, entry);
      const stats = await stat(pluginDir);
      if (!stats.isDirectory()) continue;

      try {
        const plugin = await this.loadPlugin(pluginDir);
        if (plugin) {
          const pluginTools = this.createToolsFromPlugin(plugin, pluginDir);
          tools.push(...pluginTools);
          this.loadedPlugins.set(plugin.name, plugin);
          console.log(`[Plugins] Loaded: ${plugin.name} (${pluginTools.length} tools)`);
        }
      } catch (error) {
        console.error(`[Plugins] Failed to load ${entry}:`, error instanceof Error ? error.message : error);
      }
    }

    return tools;
  }

  /** Load a single plugin from a directory */
  private async loadPlugin(pluginDir: string): Promise<PluginManifest | null> {
    const manifestPath = join(pluginDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      console.warn(`[Plugins] No manifest.json in ${pluginDir}`);
      return null;
    }

    const content = await readFile(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(content);

    // Validate required fields
    if (!manifest.name || !manifest.tools || !Array.isArray(manifest.tools)) {
      console.warn(`[Plugins] Invalid manifest in ${pluginDir}`);
      return null;
    }

    return manifest;
  }

  /** Create Tool instances from a plugin manifest */
  private createToolsFromPlugin(manifest: PluginManifest, pluginDir: string): Tool[] {
    return manifest.tools.map(toolDef => ({
      name: `${manifest.name}:${toolDef.name}`,
      description: `[${manifest.name}] ${toolDef.description}`,
      parameters: toolDef.parameters,
      execute: async (args: Record<string, unknown>): Promise<string> => {
        return this.executeTool(toolDef, args, pluginDir);
      },
    }));
  }

  /** Execute a plugin tool */
  private async executeTool(
    toolDef: PluginToolDef,
    args: Record<string, unknown>,
    pluginDir: string,
  ): Promise<string> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    // Check if it's a JS module
    if (toolDef.command.endsWith('.js') || toolDef.command.endsWith('.mjs')) {
      const modulePath = join(pluginDir, toolDef.command);
      try {
        const mod = await import(modulePath);
        if (typeof mod.default === 'function') {
          return await mod.default(args);
        }
        if (typeof mod.execute === 'function') {
          return await mod.execute(args);
        }
        return 'Plugin module has no default or execute function.';
      } catch (error) {
        return `Plugin error: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    // Shell command — pass args as JSON through env
    try {
      const [cmd, ...cmdArgs] = toolDef.command.split(' ');
      // Only pass explicit safe env vars to plugins — never leak the full process.env
      const safeEnv: Record<string, string> = {
        PATH: process.env.PATH || '/usr/bin:/bin',
        HOME: process.env.HOME || '',
        LANG: process.env.LANG || 'en_US.UTF-8',
        NODE_ENV: process.env.NODE_ENV || 'production',
        TERM: process.env.TERM || 'dumb',
        MUNINN_ARGS: JSON.stringify(args),
      };

      const { stdout, stderr } = await exec(cmd, cmdArgs, {
        cwd: pluginDir,
        env: safeEnv,
        timeout: 30000, // 30s timeout
      });

      if (stderr) {
        console.error(`[Plugin ${toolDef.name}] stderr:`, stderr);
      }

      return stdout.trim() || 'Command completed with no output.';
    } catch (error) {
      return `Plugin command failed: ${error instanceof Error ? error.message : 'Unknown'}`;
    }
  }

  /** Get list of loaded plugins */
  getLoadedPlugins(): PluginManifest[] {
    return [...this.loadedPlugins.values()];
  }
}
