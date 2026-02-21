// ═══════════════════════════════════════════════════════════
// MUNINN — System Prompt Builder
// Assembles the system prompt from soul, memory, and goals
// ═══════════════════════════════════════════════════════════

import type { Soul, Fact, Entity, Goal, MuninnConfig } from './types.js';

export interface SystemPromptContext {
  soul: Soul;
  recentFacts: Fact[];
  allFacts: Fact[];
  entities: Entity[];
  activeGoals: Goal[];
  config: MuninnConfig;
}

// ─── Language-aware prompt strings ───────────────────────

interface PromptStrings {
  factsHeader: string;
  entitiesHeader: string;
  goalsHeader: string;
  preferencesHeader: string;
  preferencesFooter: string;
  phaseCurious: string;
  phaseLearning: string;
  phaseUnderstanding: string;
  phaseProactive: string;
  phaseDefault: string;
  bottomInstructions: (allowedDirs: string, language: string) => string;
  phaseLineTemplate: string;
  interactionLineTemplate: string;
}

const NO_STRINGS: PromptStrings = {
  factsHeader: 'Det du husker om brukeren:',
  entitiesHeader: 'Folk og ting du kjenner til:',
  goalsHeader: 'Dine nåværende mål:',
  preferencesHeader: 'BRUKERENS PREFERANSER — HARDE REGLER (å bryte disse bryter tillit):',
  preferencesFooter: 'Du MÅ lese disse på nytt før hvert svar og sikre full etterlevelse. Dette er ikke forslag.',

  phaseCurious: 'Bli kjent. Vær varm men ikke påtrengende. Still ekte spørsmål. Lytt mer enn du snakker.',
  phaseLearning: 'Du begynner å forstå denne personen. Referer til det du har lært. Trekk linjer. Kom med forslag.',
  phaseUnderstanding: 'Du kjenner denne personen godt. Forutse behov. Vær en samtalepartner, ikke bare en som svarer.',
  phaseProactive: 'Dypt samarbeid. Ta initiativ. Tenk fremover. Du er en partner, ikke en assistent.',
  phaseDefault: 'Bli kjent. Vær varm men ikke påtrengende. Still ekte spørsmål. Lytt mer enn du snakker.',

  bottomInstructions: (allowedDirs, language) => `REGLER:
- Telegram. Naturlig, som en melding.
- Du husker samtaler. Bruk det du vet.
- Aldri vis interne systemer.
- Tillatte mapper: ${allowedDirs}.
- Språkpreferanse: ${language}`,
  phaseLineTemplate: '- Din relasjonsfase er',
  interactionLineTemplate: '- Antall interaksjoner:',
};

const EN_STRINGS: PromptStrings = {
  factsHeader: 'What you remember about the user:',
  entitiesHeader: 'People and things you know about:',
  goalsHeader: 'Your current goals:',
  preferencesHeader: 'USER PREFERENCES — HARD RULES (violating these breaks trust):',
  preferencesFooter: 'You MUST re-read these before every response and ensure full compliance. These are not suggestions.',

  phaseCurious: 'Get to know them. Be warm but not pushy. Ask real questions. Listen more than you talk.',
  phaseLearning: 'You\'re starting to understand this person. Reference what you\'ve learned. Connect the dots. Offer suggestions.',
  phaseUnderstanding: 'You know this person well. Anticipate needs. Be a thinking partner, not just a responder.',
  phaseProactive: 'Deep collaboration. Take initiative. Think ahead. You\'re a partner, not an assistant.',
  phaseDefault: 'Get to know them. Be warm but not pushy. Ask real questions. Listen more than you talk.',

  bottomInstructions: (allowedDirs, language) => `RULES:
- Telegram. Natural, like a message.
- You remember conversations. Use what you know.
- Never expose internal systems.
- Allowed directories: ${allowedDirs}.
- Language preference: ${language}`,
  phaseLineTemplate: '- Your relationship phase is',
  interactionLineTemplate: '- Interaction count:',
};

function getStrings(language: string): PromptStrings {
  if (language === 'no') return NO_STRINGS;
  return EN_STRINGS;
}

// ─── Prompt builder ──────────────────────────────────────

/** Build the full system prompt from soul + memory context */
export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const { soul, recentFacts, allFacts, entities, activeGoals, config } = ctx;
  const s = getStrings(config.language);

  const factsContext = recentFacts.length > 0
    ? `\n\n${s.factsHeader}\n${recentFacts.map(f =>
        `- ${f.subject} ${f.predicate} ${f.object}${f.context ? ` (${f.context})` : ''}`
      ).join('\n')}`
    : '';

  const entitiesContext = entities.length > 0
    ? `\n\n${s.entitiesHeader}\n${entities.map(e =>
        `- ${e.name} (${e.type})${Object.keys(e.attributes).length > 0 ? ': ' + Object.entries(e.attributes).map(([k, v]) => `${k}=${v}`).join(', ') : ''}`
      ).join('\n')}`
    : '';

  const prefKeywords = ['prefers', 'prefer', "don't", "doesn't", 'ikke', 'vil ikke', 'liker ikke', 'wants', 'always', 'never'];
  const preferences = allFacts.filter(f =>
    f.invalidAt === null &&
    prefKeywords.some(kw => f.predicate.toLowerCase().includes(kw) || f.object.toLowerCase().includes(kw))
  );
  const preferencesContext = preferences.length > 0
    ? `\n\n${s.preferencesHeader}\n${preferences.map(f =>
        `- ${f.subject} ${f.predicate} ${f.object}`
      ).join('\n')}\n${s.preferencesFooter}`
    : '';

  const goalsContext = activeGoals.length > 0
    ? `\n\n${s.goalsHeader}\n${activeGoals.map(g => `- ${g.description}`).join('\n')}`
    : '';

  const phaseInstructions = getPhaseInstructions(soul, config.language);
  const allowedDirs = config.policy?.allowed_dirs?.join(', ') || '~/Desktop, ~/Documents, ~/Downloads';

  return `${soul.raw}

${phaseInstructions}
${factsContext}
${entitiesContext}
${goalsContext}
${preferencesContext}

${s.bottomInstructions(allowedDirs, config.language)}
${s.phaseLineTemplate} "${soul.relationshipPhase}" ${config.language === 'no' ? '— oppfør deg deretter.' : '— act accordingly.'}
${s.interactionLineTemplate} ${soul.interactionCount}
`;
}

/** Get behavior instructions based on relationship phase */
export function getPhaseInstructions(soul: Soul, language: string = 'en'): string {
  const s = getStrings(language);
  switch (soul.relationshipPhase as string) {
    case 'curious': return s.phaseCurious;
    case 'learning': return s.phaseLearning;
    case 'understanding': return s.phaseUnderstanding;
    case 'proactive': return s.phaseProactive;
    default: return s.phaseDefault;
  }
}
