// ═══════════════════════════════════════════════════════════
// MUNINN — Mood Detection Tests
// ═══════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectMood, getMoodGuidance } from '../core/mood.js';

describe('Mood Detection', () => {
  it('should detect neutral mood for plain messages', () => {
    const mood = detectMood('Hello, how are you?');
    assert.equal(mood.primary, 'neutral');
  });

  it('should detect frustration', () => {
    const mood = detectMood('Ugh this is broken, nothing works!!');
    assert.equal(mood.primary, 'frustrated');
    assert.ok(mood.confidence > 0.5);
  });

  it('should detect happiness', () => {
    const mood = detectMood('Haha that was amazing! Thanks! 😊');
    assert.equal(mood.primary, 'happy');
    assert.ok(mood.confidence > 0.5);
  });

  it('should detect stress', () => {
    const mood = detectMood('I have a deadline tomorrow and I can\'t keep up');
    assert.equal(mood.primary, 'stressed');
  });

  it('should detect sadness', () => {
    const mood = detectMood('Having a really bad day, feeling sad');
    assert.equal(mood.primary, 'sad');
  });

  it('should detect curiosity', () => {
    const mood = detectMood('How does this work? Can you explain??');
    assert.equal(mood.primary, 'curious');
  });

  it('should detect Norwegian frustration', () => {
    const mood = detectMood('Faen, dette fungerer ikke i det hele tatt');
    assert.equal(mood.primary, 'frustrated');
  });

  it('should detect Norwegian stress', () => {
    const mood = detectMood('Fristen er i morgen og jeg er stressa');
    assert.equal(mood.primary, 'stressed');
  });

  it('should provide mood guidance', () => {
    const frustrated = detectMood('This is broken!! UGH');
    const guidance = getMoodGuidance(frustrated);
    assert.ok(guidance.includes('frustrated'));
  });

  it('should return empty guidance for neutral mood', () => {
    const neutral = detectMood('What time is it?');
    const guidance = getMoodGuidance(neutral);
    assert.equal(guidance, '');
  });
});
