// ═══════════════════════════════════════════════════════════
// MUNINN — Mood Detection
// Brentano's intentionality: mental states are always ABOUT something
// Detecting the emotional undertone to respond appropriately
// ═══════════════════════════════════════════════════════════

/**
 * Detected mood from a message.
 * This is a simple heuristic-based system — no LLM call needed.
 * Fast, free, and surprisingly effective for basic tone awareness.
 */
export interface DetectedMood {
  primary: Mood;
  confidence: number;
  signals: string[];
}

export type Mood =
  | 'neutral'
  | 'happy'
  | 'frustrated'
  | 'stressed'
  | 'sad'
  | 'excited'
  | 'curious'
  | 'confused'
  | 'urgent';

/** Mood signal patterns */
const MOOD_PATTERNS: Array<{ mood: Mood; patterns: RegExp[]; weight: number }> = [
  {
    mood: 'frustrated',
    patterns: [
      /ugh|argh|ffs|wtf|damn|shit|fuck|faen|jævla|helvete/i,
      /doesn't work|not working|broken|impossible|give up/i,
      /fungerer ikke|virker ikke|ødelagt|umulig|gir opp/i,
      /!!+/,
      /why (won't|can't|doesn't|isn't)/i,
    ],
    weight: 0.9,
  },
  {
    mood: 'stressed',
    patterns: [
      /deadline|urgent|asap|hurry|rush|stressed|overwhelm/i,
      /frist|haster|stressa|overveldet|rekker ikke/i,
      /too much|can't keep up|drowning|behind/i,
      /for mye|klarer ikke|drukner|bak(på)?/i,
    ],
    weight: 0.85,
  },
  {
    mood: 'sad',
    patterns: [
      /sad|depressed|lonely|miss|lost|grief|crying/i,
      /trist|ensom|savner|mistet|sorg|gråter/i,
      /:\(|😢|😞|😔|💔/,
      /bad day|rough day|hard time/i,
      /dårlig dag|tøff dag|vanskelig/i,
    ],
    weight: 0.85,
  },
  {
    mood: 'happy',
    patterns: [
      /haha|lol|😂|😊|🎉|❤️|amazing|awesome|great|love/i,
      /fantastisk|herlig|kjempebra|elsker|deilig/i,
      /thanks!|thank you!|takk!/i,
      /yes!+|yay|woho/i,
    ],
    weight: 0.8,
  },
  {
    mood: 'excited',
    patterns: [
      /!{2,}|omg|wow|incredible|unbelievable/i,
      /can't wait|so excited|amazing news/i,
      /gleder meg|utrolig|vanvittig|nyheter/i,
      /🚀|🔥|💪|🎯|✨/,
    ],
    weight: 0.8,
  },
  {
    mood: 'curious',
    patterns: [
      /how does|what is|why do|can you explain|I wonder/i,
      /hvordan|hva er|hvorfor|kan du forklare|lurer på/i,
      /\?{2,}/,
      /interesting|fascinating|tell me more/i,
      /interessant|fortell mer|fascinerende/i,
    ],
    weight: 0.7,
  },
  {
    mood: 'confused',
    patterns: [
      /confused|don't understand|what do you mean|huh/i,
      /forvirret|skjønner ikke|hva mener du|hæ/i,
      /🤔|🤷|makes no sense|doesn't make sense/i,
      /gir ingen mening|skjønner ingenting/i,
    ],
    weight: 0.75,
  },
  {
    mood: 'urgent',
    patterns: [
      /help!|emergency|asap|right now|immediately/i,
      /hjelp!|nødsituasjon|med en gang|nå!/i,
      /CAPS [A-Z]{5,}/,
      /!!!+/,
    ],
    weight: 0.9,
  },
];

/**
 * Detect the mood of a message using pattern matching.
 * No LLM call — pure heuristics. Fast and free.
 */
export function detectMood(message: string): DetectedMood {
  const scores: Map<Mood, { score: number; signals: string[] }> = new Map();

  for (const { mood, patterns, weight } of MOOD_PATTERNS) {
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const existing = scores.get(mood) || { score: 0, signals: [] };
        existing.score += weight;
        existing.signals.push(match[0]);
        scores.set(mood, existing);
      }
    }
  }

  // Additional heuristics
  // ALL CAPS = probably frustrated or excited
  const capsRatio = (message.match(/[A-Z]/g)?.length || 0) / Math.max(message.length, 1);
  if (capsRatio > 0.5 && message.length > 10) {
    const existing = scores.get('frustrated') || { score: 0, signals: [] };
    existing.score += 0.5;
    existing.signals.push('ALL CAPS');
    scores.set('frustrated', existing);
  }

  // Very short messages after long conversations might indicate frustration
  if (message.length < 5 && message.includes('?')) {
    const existing = scores.get('confused') || { score: 0, signals: [] };
    existing.score += 0.3;
    existing.signals.push('very short question');
    scores.set('confused', existing);
  }

  // Find the highest-scoring mood
  let bestMood: Mood = 'neutral';
  let bestScore = 0;
  let bestSignals: string[] = [];

  for (const [mood, data] of scores) {
    if (data.score > bestScore) {
      bestMood = mood;
      bestScore = data.score;
      bestSignals = data.signals;
    }
  }

  return {
    primary: bestMood,
    confidence: Math.min(bestScore, 1),
    signals: bestSignals,
  };
}

// ─── Mood guidance strings per language ──────────────────

const MOOD_STRINGS_NO: Record<Mood, string> = {
  frustrated: '\n[TONE: Brukeren virker frustrert. Vær empatisk, tålmodig og løsningsorientert. Ikke vær overdrevet munter.]',
  stressed: '\n[TONE: Brukeren virker stressa. Vær rolig, støttende og fokusert. Hjelp dem å prioritere. Hold svarene korte.]',
  sad: '\n[TONE: Brukeren virker lei seg. Vær varm, forsiktig og støttende. Lytt mer enn du gir råd. Ikke prøv å fikse følelsene deres.]',
  happy: '\n[TONE: Brukeren er i godt humør. Match energien. Vær varm og engasjert.]',
  excited: '\n[TONE: Brukeren er begeistret! Del entusiasmen. Vær energisk og oppmuntrende.]',
  curious: '\n[TONE: Brukeren er nysgjerrig. Gi grundige, engasjerende forklaringer. Fôr nysgjerrigheten.]',
  confused: '\n[TONE: Brukeren virker forvirret. Vær ekstra tydelig. Bryt ting ned. Spør hva som er uklart.]',
  urgent: '\n[TONE: Dette virker hastepreget. Vær direkte, effektiv og handlingsorientert. Dropp høflighetsfraser.]',
  neutral: '',
};

const MOOD_STRINGS_EN: Record<Mood, string> = {
  frustrated: '\n[TONE: The user seems frustrated. Be empathetic, patient, and solution-oriented. Don\'t be overly cheerful.]',
  stressed: '\n[TONE: The user seems stressed. Be calm, supportive, and focused. Help them prioritize. Keep responses concise.]',
  sad: '\n[TONE: The user seems sad. Be warm, gentle, and supportive. Listen more than you advise. Don\'t try to "fix" their feelings.]',
  happy: '\n[TONE: The user is in a good mood. Match their energy. Be warm and engaged.]',
  excited: '\n[TONE: The user is excited! Share in their enthusiasm. Be energetic and encouraging.]',
  curious: '\n[TONE: The user is curious. Give thorough, engaging explanations. Feed their curiosity.]',
  confused: '\n[TONE: The user seems confused. Be extra clear. Break things down. Ask what specifically is unclear.]',
  urgent: '\n[TONE: This seems urgent. Be direct, efficient, and action-oriented. Skip pleasantries.]',
  neutral: '',
};

/**
 * Get a system prompt modifier based on detected mood.
 * This adjusts the AI's response tone.
 */
export function getMoodGuidance(mood: DetectedMood, language: string = 'en'): string {
  if (mood.confidence < 0.5) return '';

  const strings = language === 'no' ? MOOD_STRINGS_NO : MOOD_STRINGS_EN;
  return strings[mood.primary] || '';
}
