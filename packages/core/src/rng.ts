/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * Every random decision in the simulation goes through an Rng, so the same
 * seed and the same commands always produce the same state.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** True with the given probability (0 to 1). */
  chance(probability: number): boolean;
  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Current internal state, for saving. */
  getState(): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(probability) {
      return next() < probability;
    },
    pick(items) {
      if (items.length === 0) throw new Error('Rng.pick: cannot pick from an empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    getState() {
      return state;
    },
  };
}
