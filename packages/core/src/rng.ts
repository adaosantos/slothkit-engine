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

/**
 * Independent named RNG streams derived from one seed.
 *
 * Each system draws from its own stream (`streams.stream('loot')`), so adding
 * a random call in one system doesn't shift the results of every other system.
 */
export interface RngStreams {
  stream(name: string): Rng;
  /** State of every stream used so far, for saving. */
  getState(): Record<string, number>;
  /** Restores stream states. Streams not listed start fresh from the seed. */
  setState(state: Record<string, number>): void;
}

export function createRngStreams(seed: number): RngStreams {
  const root = seed >>> 0;
  let streams = new Map<string, Rng>();

  return {
    stream(name) {
      let rng = streams.get(name);
      if (!rng) {
        rng = createRng(deriveSeed(root, name));
        streams.set(name, rng);
      }
      return rng;
    },
    getState() {
      const state: Record<string, number> = {};
      for (const name of [...streams.keys()].sort()) {
        const rng = streams.get(name);
        if (rng) state[name] = rng.getState();
      }
      return state;
    },
    setState(state) {
      streams = new Map();
      for (const [name, value] of Object.entries(state)) {
        streams.set(name, createRng(value));
      }
    },
  };
}

/** Mixes a seed with a stream name (FNV-1a + murmur3 finalizer). */
function deriveSeed(seed: number, name: string): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
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
