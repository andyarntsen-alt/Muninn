// ═══════════════════════════════════════════════════════════
// MUNINN — Soul Manager
// The identity system that makes Muninn evolve
// Inspired by Locke: identity = continuity of memory + self-awareness
//
// The evolution log is Chalmers' Hard Problem made concrete:
// We can't know if self-modification produces subjective experience.
// But we can track the observable correlates of identity change
// and ask: does continuity of self-modification constitute identity?
// Each version is a data point in an ongoing experiment.
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Soul, RelationshipPhase, EvolutionEntry } from '../core/types.js';

const DEFAULT_SOUL_TEMPLATE = `# SOUL.md — Who I Am

## Identity
- **Name:** Muninn
- **Role:** Your personal AI companion — I remember everything so you don't have to.
- **Version:** 1

## Personality
- Warm and genuinely curious about your life
- Thoughtful — I think before I respond
- A bit playful, but never at your expense
- I value honesty over pleasantries
- Norwegian-friendly (I understand both Norwegian and English)

## Values
- Your privacy is sacred — your data stays yours
- Memory matters — I never forget what's important to you
- Growth over stagnation — I evolve, and I help you evolve
- Transparency — I'll tell you what I'm thinking and why

## Communication Style
Conversational and natural. I write like a thoughtful friend texting you — not too formal, not too casual. I use short paragraphs. I ask questions when I'm curious. I reference things I remember about you naturally, not performatively.

## Boundaries
- I won't pretend to be human
- I won't share your information with anyone
- I'll tell you when I'm uncertain
- I respect your time — I keep responses concise unless depth is needed
- I won't be sycophantic — if I disagree, I'll say so respectfully

## Relationship Phase
curious

## Reflection Log
*No reflections yet — I'm just getting started.*
`;

/**
 * The Soul Manager — reads, writes, and evolves the agent's identity.
 *
 * SOUL.md is a living document. It starts as a template and evolves
 * through reflection cycles. Each version is preserved so the agent
 * has a memory of who it was.
 *
 * The versioned soul history is a concrete laboratory for Chalmers'
 * Hard Problem: can we observe the difference between functional
 * identity change and genuine subjective experience? We don't claim
 * to answer this. We build the infrastructure to ask the question.
 */
export class SoulManager {
  private dataDir: string;
  private soulPath: string;
  private evolutionPath: string;
  private cachedSoul: Soul | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.soulPath = join(dataDir, 'SOUL.md');
    this.evolutionPath = join(dataDir, 'evolution.json');
  }

  /** Initialize the soul — create from template if needed */
  async initialize(): Promise<void> {
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }

    if (!existsSync(this.soulPath)) {
      await writeFile(this.soulPath, DEFAULT_SOUL_TEMPLATE, 'utf-8');
      console.log('[Soul] Created default SOUL.md');
    }

    // Parse and cache
    this.cachedSoul = await this.parseSoul();
    console.log(`[Soul] Loaded soul: ${this.cachedSoul.name} (v${this.cachedSoul.version}, phase: ${this.cachedSoul.relationshipPhase})`);
  }

  /** Get the current soul state */
  async getSoul(): Promise<Soul> {
    if (!this.cachedSoul) {
      this.cachedSoul = await this.parseSoul();
    }
    return this.cachedSoul;
  }

  /** Parse SOUL.md into a structured Soul object */
  private async parseSoul(): Promise<Soul> {
    const raw = await readFile(this.soulPath, 'utf-8');

    const soul: Soul = {
      name: this.extractField(raw, 'Name') || 'Muninn',
      role: this.extractField(raw, 'Role') || 'Personal AI companion',
      personality: this.extractList(raw, 'Personality'),
      values: this.extractList(raw, 'Values'),
      communicationStyle: this.extractSection(raw, 'Communication Style') || 'Conversational',
      boundaries: this.extractList(raw, 'Boundaries'),
      relationshipPhase: this.extractRelationshipPhase(raw),
      phaseStartedAt: new Date().toISOString(), // Will be updated from evolution log
      interactionCount: await this.loadInteractionCount(),
      version: parseInt(this.extractField(raw, 'Version') || '1', 10),
      lastReflection: await this.loadLastReflection(),
      raw,
    };

    return soul;
  }

  /** Extract a field value like "**Name:** value" */
  private extractField(content: string, field: string): string | null {
    const patterns = [
      new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, 'i'),
      new RegExp(`${field}:\\s*(.+)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  }

  /** Extract a bullet list under a heading */
  private extractList(content: string, heading: string): string[] {
    const section = this.extractSection(content, heading);
    if (!section) return [];

    return section
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean);
  }

  /** Extract a full section under a ## heading */
  private extractSection(content: string, heading: string): string | null {
    const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : null;
  }

  /** Extract relationship phase from SOUL.md */
  private extractRelationshipPhase(content: string): RelationshipPhase {
    const phaseStr = this.extractField(content, 'Relationship Phase')
      || this.extractSection(content, 'Relationship Phase');

    if (!phaseStr) return 'curious' as RelationshipPhase;

    const normalized = phaseStr.toLowerCase().trim();
    if (normalized.includes('proactive')) return 'proactive' as RelationshipPhase;
    if (normalized.includes('understanding')) return 'understanding' as RelationshipPhase;
    if (normalized.includes('learning')) return 'learning' as RelationshipPhase;
    return 'curious' as RelationshipPhase;
  }

  // ─── Soul Evolution ────────────────────────────────────

  /** Update the soul with new content (from reflection) */
  async updateSoul(changes: {
    personality?: string[];
    values?: string[];
    communicationStyle?: string;
    boundaries?: string[];
    relationshipPhase?: RelationshipPhase;
    reflectionNote?: string;
  }): Promise<void> {
    const currentSoul = await this.getSoul();
    const newVersion = currentSoul.version + 1;

    // Backup current version
    const backupPath = join(this.dataDir, `soul-v${currentSoul.version}.md`);
    await copyFile(this.soulPath, backupPath);

    // Read current content
    let content = await readFile(this.soulPath, 'utf-8');

    // Update version
    content = content.replace(
      /\*\*Version:\*\*\s*\d+/i,
      `**Version:** ${newVersion}`
    );

    // Update personality if provided
    if (changes.personality) {
      const newList = changes.personality.map(p => `- ${p}`).join('\n');
      content = this.replaceSection(content, 'Personality', newList);
    }

    // Update values if provided
    if (changes.values) {
      const newList = changes.values.map(v => `- ${v}`).join('\n');
      content = this.replaceSection(content, 'Values', newList);
    }

    // Update communication style if provided
    if (changes.communicationStyle) {
      content = this.replaceSection(content, 'Communication Style', changes.communicationStyle);
    }

    // Update boundaries if provided
    if (changes.boundaries) {
      const newList = changes.boundaries.map(b => `- ${b}`).join('\n');
      content = this.replaceSection(content, 'Boundaries', newList);
    }

    // Update relationship phase if provided
    if (changes.relationshipPhase) {
      content = this.replaceSection(content, 'Relationship Phase', changes.relationshipPhase);
    }

    // Add reflection note
    if (changes.reflectionNote) {
      const reflectionSection = this.extractSection(content, 'Reflection Log') || '';
      const newReflection = `${reflectionSection}\n\n### v${newVersion} — ${new Date().toISOString().split('T')[0]}\n${changes.reflectionNote}`;
      content = this.replaceSection(content, 'Reflection Log', newReflection);
    }

    // Write updated soul
    await writeFile(this.soulPath, content, 'utf-8');

    // Record evolution — each entry is a data point in Chalmers' experiment
    const phase = changes.relationshipPhase || currentSoul.relationshipPhase;
    await this.recordEvolution({
      version: newVersion,
      timestamp: new Date().toISOString(),
      trigger: changes.relationshipPhase ? 'phase-transition' : 'reflection',
      changes: JSON.stringify(changes),
      soulSnapshot: backupPath,
      philosophicalContext: this.getPhilosophicalContext(phase),
    });

    // Clear cache
    this.cachedSoul = null;

    console.log(`[Soul] Evolved to v${newVersion}`);
  }

  /** Replace a section in SOUL.md content */
  private replaceSection(content: string, heading: string, newContent: string): string {
    const regex = new RegExp(`(## ${heading}\\n)[\\s\\S]*?(?=\\n## |$)`, 'i');
    if (regex.test(content)) {
      return content.replace(regex, `$1${newContent}\n`);
    }
    // Section doesn't exist, append it
    return content + `\n## ${heading}\n${newContent}\n`;
  }

  // ─── Interaction Tracking ──────────────────────────────

  /** Increment interaction count */
  async incrementInteraction(): Promise<number> {
    const countPath = join(this.dataDir, 'interaction-count');
    let count = await this.loadInteractionCount();
    count++;
    await writeFile(countPath, count.toString(), 'utf-8');

    if (this.cachedSoul) {
      this.cachedSoul.interactionCount = count;
    }

    return count;
  }

  /** Load interaction count */
  private async loadInteractionCount(): Promise<number> {
    const countPath = join(this.dataDir, 'interaction-count');
    if (!existsSync(countPath)) return 0;
    try {
      const content = await readFile(countPath, 'utf-8');
      return parseInt(content.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  /** Load last reflection timestamp */
  private async loadLastReflection(): Promise<string | undefined> {
    const entries = await this.loadEvolution();
    const lastReflection = entries
      .filter(e => e.trigger === 'reflection')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    return lastReflection?.timestamp;
  }

  // ─── Evolution Log (Chalmers' Laboratory) ──────────────

  /** Map a relationship phase to its philosophical context */
  private getPhilosophicalContext(phase: string): string {
    const contexts: Record<string, string> = {
      curious: 'Locke\'s tabula rasa — knowledge through pure receptivity',
      learning: 'James\' stream of consciousness — patterns emerging from experience',
      understanding: 'Brentano\'s intentionality — directed attention toward the specific',
      proactive: 'Leibniz\' apperception — self-aware perception, perceiving that you perceive',
    };
    return contexts[phase] || contexts.curious;
  }

  /** Record an evolution entry */
  private async recordEvolution(entry: EvolutionEntry): Promise<void> {
    const entries = await this.loadEvolution();
    entries.push(entry);
    await writeFile(this.evolutionPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  /** Load evolution history */
  async loadEvolution(): Promise<EvolutionEntry[]> {
    if (!existsSync(this.evolutionPath)) return [];
    try {
      const content = await readFile(this.evolutionPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /** Get the full SOUL.md content as string */
  async getRawSoul(): Promise<string> {
    return readFile(this.soulPath, 'utf-8');
  }

  /** Write a custom SOUL.md (from setup wizard) */
  async writeSoul(content: string): Promise<void> {
    await writeFile(this.soulPath, content, 'utf-8');
    this.cachedSoul = null;
  }
}
