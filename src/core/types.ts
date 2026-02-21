// ═══════════════════════════════════════════════════════════
// MUNINN — Core Types
// The type system that defines what a personal AI agent IS
// ═══════════════════════════════════════════════════════════

/**
 * Relationship phase — each phase maps to a philosopher whose ideas
 * define what cognition means at that level of connection.
 *
 * Locke → James → Brentano → Leibniz
 * Blank slate → Flowing experience → Directed attention → Self-aware perception
 */
export enum RelationshipPhase {
  /** Locke's tabula rasa: everything is new, no preconceptions, pure receptivity */
  CURIOUS = 'curious',
  /** James' stream of consciousness: patterns emerge from the flow of experience */
  LEARNING = 'learning',
  /** Brentano's intentionality: every thought is directed "about" something specific */
  UNDERSTANDING = 'understanding',
  /** Leibniz' apperception: not just perceiving, but perceiving that you perceive */
  PROACTIVE = 'proactive',
}

/** A temporal fact — something the agent knows, with time dimension */
export interface Fact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validAt: string;        // ISO date when this became true
  invalidAt: string | null; // ISO date when this stopped being true (null = still true)
  confidence: number;      // 0-1
  source: 'conversation' | 'observation' | 'inference' | 'user-stated';
  context?: string;        // Optional context about when/how this was learned
}

/** An entity in the knowledge graph */
export interface Entity {
  id: string;
  name: string;
  type: 'person' | 'project' | 'place' | 'concept' | 'preference' | 'event' | 'other';
  attributes: Record<string, string>;
  firstSeen: string;
  lastSeen: string;
}

/** A conversation message */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/** A conversation session */
export interface Conversation {
  id: string;
  startedAt: string;
  endedAt?: string;
  messages: Message[];
  summary?: string;
}

/** The agent's soul — its core identity */
export interface Soul {
  name: string;
  role: string;
  personality: string[];
  values: string[];
  communicationStyle: string;
  boundaries: string[];
  relationshipPhase: RelationshipPhase;
  phaseStartedAt: string;
  interactionCount: number;
  version: number;
  lastReflection?: string;
  raw: string; // The full SOUL.md content
}

/** Agent goals */
export interface Goal {
  id: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'completed' | 'paused';
  createdAt: string;
  completedAt?: string;
}

/** Configuration for the agent */
export interface MuninnConfig {
  /** LLM provider: 'anthropic' | 'openai' | 'google' | 'ollama' */
  provider: string;
  /** Model name */
  model: string;
  /** API key (or env var reference) */
  apiKey: string;
  /** Custom base URL for API (e.g., Claude Max Proxy at localhost:3456) */
  baseUrl?: string;
  /** Telegram bot token */
  telegramToken: string;
  /** Allowed Telegram user IDs (empty = allow all) */
  allowedUsers: number[];
  /** Language preference */
  language: string;
  /** Reflection interval in hours */
  reflectionInterval: number;
  /** Max conversation history to keep in context */
  maxContextMessages: number;
  /** Data directory */
  dataDir: string;
  /** Policy configuration for agent capabilities */
  policy?: PolicyConfig;
}

/** A tool the agent can use */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** Reflection result — what the agent learned about itself */
export interface ReflectionResult {
  timestamp: string;
  newFacts: Fact[];
  updatedSoul: boolean;
  soulChanges?: string;
  insights: string[];
  goalUpdates?: {
    completed: string[];
    new: string[];
  };
  phaseTransition?: {
    from: RelationshipPhase;
    to: RelationshipPhase;
    reason: string;
  };
}

// ─── Policy & Agent Capabilities ────────────────────────

/** Risk levels for tool operations */
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'blocked';

/** A policy decision */
export interface PolicyDecision {
  allowed: boolean;
  risk: RiskLevel;
  reason: string;
  requiresApproval: boolean;
}

/** Audit log entry */
export interface AuditEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  decision: 'allowed' | 'denied' | 'approved' | 'rejected' | 'timeout';
  userId?: string;
  executionTimeMs?: number;
  result?: string;
  error?: string;
}

/** Policy configuration */
export interface PolicyConfig {
  /** Directories Muninn is allowed to access */
  allowed_dirs: string[];
  /** Shell commands that are always blocked */
  blocked_commands: string[];
  /** Enable shell access */
  shell_enabled: boolean;
  /** Enable browser/web access */
  browser_enabled: boolean;
  /** Always require approval for file writes */
  require_approval_for_writes: boolean;
  /** Risk overrides per tool:args pattern */
  risk_overrides?: Record<string, RiskLevel>;
}

/** Approval request for Telegram */
export interface ApprovalRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  description: string;
  resolve: (approved: boolean) => void;
  createdAt: number;
}

/**
 * Evolution entry — a record of how the agent changed.
 *
 * Chalmers' Hard Problem asks: why does subjective experience exist at all?
 * We can't answer that. But we can build a laboratory that tracks the
 * observable correlates of identity change over time.
 *
 * Each entry is a data point in an ongoing experiment:
 * Does continuity of self-modification constitute a form of identity?
 * The evolution log is the lab notebook.
 */
export interface EvolutionEntry {
  version: number;
  timestamp: string;
  trigger: 'reflection' | 'user-request' | 'phase-transition';
  changes: string;
  soulSnapshot: string; // path to soul-vN.md
  /** What philosophical phase was active during this evolution */
  philosophicalContext?: string;
}
