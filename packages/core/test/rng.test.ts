import { describe, expect, it } from 'vitest';
import { createRng } from '../src/index.js';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 1000 }, () => a.next());
    const seqB = Array.from({ length: 1000 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('resumes from a saved state', () => {
    const original = createRng(7);
    for (let i = 0; i < 50; i++) original.next();

    const restored = createRng(original.getState());
    expect(restored.next()).toBe(original.next());
  });

  it('keeps int() within inclusive bounds', () => {
    const rng = createRng(123);
    for (let i = 0; i < 10_000; i++) {
      const n = rng.int(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('throws when picking from an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });
});
