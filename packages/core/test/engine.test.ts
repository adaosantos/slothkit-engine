import { describe, expect, it } from 'vitest';
import { createEngine, defineSystem } from '../src/index.js';

describe('Engine clock', () => {
  it('runs 10 ticks per second by default', () => {
    const engine = createEngine({ seed: 1 });
    engine.advance(1000);
    expect(engine.tick).toBe(10);
  });

  it('accumulates partial time between calls', () => {
    const engine = createEngine({ seed: 1 });
    expect(engine.advance(250).ticks).toBe(2);
    expect(engine.alpha).toBeCloseTo(0.5);
    expect(engine.advance(50).ticks).toBe(1);
    expect(engine.tick).toBe(3);
  });

  it('respects a custom tick rate', () => {
    const engine = createEngine({ seed: 1, tickRate: 20 });
    engine.advance(1000);
    expect(engine.tick).toBe(20);
  });

  it('caps ticks per advance and reports dropped time', () => {
    const engine = createEngine({ seed: 1, maxTicksPerAdvance: 5 });
    const result = engine.advance(1050);
    expect(result.ticks).toBe(5);
    expect(result.droppedMs).toBe(500);
    expect(engine.alpha).toBeCloseTo(0.5);
  });

  it('rejects invalid time', () => {
    const engine = createEngine({ seed: 1 });
    expect(() => engine.advance(-1)).toThrow();
    expect(() => engine.advance(Number.NaN)).toThrow();
  });
});

describe('Systems', () => {
  it('run in registration order with a fixed dt', () => {
    const calls: string[] = [];
    const dts: number[] = [];
    const first = defineSystem({ name: 'first', run: () => calls.push('first') });
    const second = defineSystem({
      name: 'second',
      run: (ctx) => {
        calls.push('second');
        dts.push(ctx.dt);
      },
    });

    const engine = createEngine({ seed: 1, systems: [first, second] });
    engine.step(2);
    expect(calls).toEqual(['first', 'second', 'first', 'second']);
    expect(dts).toEqual([0.1, 0.1]);
  });

  it('can despawn entities while iterating a query', () => {
    type Game = { components: { health: { hp: number } } };
    const reaper = defineSystem<Game>({
      name: 'reaper',
      run: ({ world }) => {
        for (const e of world.query('health')) {
          if (e.health.hp <= 0) world.despawn(e.id);
        }
      },
    });

    const engine = createEngine<Game>({ seed: 1, systems: [reaper] });
    engine.world.spawn({ health: { hp: 0 } });
    const alive = engine.world.spawn({ health: { hp: 5 } });
    engine.world.spawn({ health: { hp: -3 } });

    engine.step();
    expect(engine.world.query('health').map((e) => e.id)).toEqual([alive.id]);
  });
});

describe('Events', () => {
  type Game = {
    components: { health: { hp: number } };
    events: { died: { id: number } };
  };

  const damage = defineSystem<Game>({
    name: 'damage',
    run: ({ world, emit }) => {
      for (const e of world.query('health')) {
        e.health.hp -= 1;
        if (e.health.hp <= 0) {
          emit('died', { id: e.id });
          world.despawn(e.id);
        }
      }
    },
  });

  it('are readable by later systems in the same tick', () => {
    const seen: number[] = [];
    const loot = defineSystem<Game>({
      name: 'loot',
      run: ({ read }) => {
        for (const event of read('died')) seen.push(event.id);
      },
    });

    const engine = createEngine<Game>({ seed: 1, systems: [damage, loot] });
    const entity = engine.world.spawn({ health: { hp: 1 } });
    engine.step();
    expect(seen).toEqual([entity.id]);
  });

  it('reach listeners only after the tick completes', () => {
    const engine = createEngine<Game>({ seed: 1, systems: [damage] });
    const entity = engine.world.spawn({ health: { hp: 2 } });
    const received: Array<{ id: number; tick: number; stillExists: boolean }> = [];

    engine.on('died', ({ id }, tick) => {
      received.push({ id, tick, stillExists: engine.world.has(id) });
    });

    engine.step();
    expect(received).toEqual([]);
    engine.step();
    expect(received).toEqual([{ id: entity.id, tick: 1, stillExists: false }]);
  });

  it('stop reaching a listener after it unsubscribes', () => {
    const engine = createEngine<Game>({ seed: 1, systems: [damage] });
    engine.world.spawn({ health: { hp: 1 } });
    let calls = 0;
    const off = engine.on('died', () => {
      calls++;
    });
    off();
    engine.step();
    expect(calls).toBe(0);
  });
});

describe('Commands', () => {
  type Game = {
    components: { position: { x: number } };
    commands: { teleport: { id: number; x: number } };
  };

  const createGame = () =>
    createEngine<Game>({
      seed: 1,
      recordCommands: true,
      commands: {
        teleport: ({ world }, { id, x }) => {
          const entity = world.get(id);
          if (entity?.position) entity.position.x = x;
        },
      },
    });

  it('are applied at the start of the next tick', () => {
    const engine = createGame();
    const entity = engine.world.spawn({ position: { x: 0 } });
    engine.dispatch({ type: 'teleport', id: entity.id, x: 10 });
    expect(entity.position?.x).toBe(0);
    engine.step();
    expect(entity.position?.x).toBe(10);
  });

  it('are logged with the tick they were applied on', () => {
    const engine = createGame();
    const entity = engine.world.spawn({ position: { x: 0 } });
    engine.step(3);
    engine.dispatch({ type: 'teleport', id: entity.id, x: 7 });
    engine.step();
    expect(engine.commandLog).toEqual([
      { tick: 3, command: { type: 'teleport', id: entity.id, x: 7 } },
    ]);
  });

  it('reject unknown types', () => {
    const engine = createGame();
    expect(() => engine.dispatch({ type: 'fly' } as never)).toThrow();
  });

  it('reject types inherited from Object.prototype', () => {
    const engine = createGame();
    expect(() => engine.dispatch({ type: 'toString' } as never)).toThrow();
    expect(engine.tryDispatch({ type: 'toString' })).toEqual({
      ok: false,
      reason: 'unknown-command',
    });
  });

  it('are drained from the log in batches', () => {
    const engine = createGame();
    const entity = engine.world.spawn({ position: { x: 0 } });
    engine.dispatch({ type: 'teleport', id: entity.id, x: 1 });
    engine.step();
    expect(engine.drainCommandLog()).toEqual([
      { tick: 0, command: { type: 'teleport', id: entity.id, x: 1 } },
    ]);
    expect(engine.commandLog).toEqual([]);
    expect(engine.drainCommandLog()).toEqual([]);

    engine.dispatch({ type: 'teleport', id: entity.id, x: 2 });
    engine.step();
    expect(engine.drainCommandLog()).toEqual([
      { tick: 1, command: { type: 'teleport', id: entity.id, x: 2 } },
    ]);
  });
});

describe('Untrusted commands', () => {
  type Game = {
    resources: { used: string[]; granted: number };
    commands: { use: { item: string }; grant: { amount: number } };
  };

  const createGame = (maxQueuedCommands?: number) =>
    createEngine<Game>({
      seed: 1,
      maxQueuedCommands,
      resources: { used: [], granted: 0 },
      commands: {
        use: {
          validate: (input) => typeof input.item === 'string' && input.item.length > 0,
          handle: ({ world }, { item }) => {
            world.resources.used.push(item);
          },
        },
        grant: ({ world }, { amount }) => {
          world.resources.granted += amount;
        },
      },
    });

  it('queue valid input and apply it on the next tick', () => {
    const engine = createGame();
    expect(engine.tryDispatch({ type: 'use', item: 'potion' })).toEqual({ ok: true });
    engine.step();
    expect(engine.world.resources.used).toEqual(['potion']);
  });

  it('reject malformed input without throwing', () => {
    const engine = createGame();
    const inputs: unknown[] = [
      undefined,
      null,
      42,
      'use',
      [],
      ['use'],
      {},
      { type: 7 },
      { type: 'use', item: () => 'potion' },
    ];
    for (const input of inputs) {
      expect(engine.tryDispatch(input)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('reject unknown types and trusted-only commands', () => {
    const engine = createGame();
    expect(engine.tryDispatch({ type: 'fly' })).toEqual({ ok: false, reason: 'unknown-command' });
    expect(engine.tryDispatch({ type: 'grant', amount: 1000 })).toEqual({
      ok: false,
      reason: 'unknown-command',
    });
    engine.dispatch({ type: 'grant', amount: 5 });
    engine.step();
    expect(engine.world.resources.granted).toBe(5);
  });

  it('reject input that fails validation', () => {
    const engine = createGame();
    expect(engine.tryDispatch({ type: 'use', item: '' })).toEqual({ ok: false, reason: 'invalid' });
    expect(engine.tryDispatch({ type: 'use' })).toEqual({ ok: false, reason: 'invalid' });
    engine.step();
    expect(engine.world.resources.used).toEqual([]);
  });

  it('treat a throwing validator as invalid', () => {
    const engine = createEngine<{ commands: { ping: Record<never, never> } }>({
      seed: 1,
      commands: {
        ping: {
          validate: () => {
            throw new Error('schema mismatch');
          },
          handle: () => {},
        },
      },
    });
    expect(engine.tryDispatch({ type: 'ping' })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('validate a copy, so later mutation of the input has no effect', () => {
    const engine = createGame();
    const input = { type: 'use', item: 'potion' };
    engine.tryDispatch(input);
    input.item = '';
    engine.step();
    expect(engine.world.resources.used).toEqual(['potion']);
  });

  it('reject input beyond the queue limit until the next tick', () => {
    const engine = createGame(2);
    expect(engine.tryDispatch({ type: 'use', item: 'a' }).ok).toBe(true);
    engine.dispatch({ type: 'grant', amount: 1 });
    expect(engine.tryDispatch({ type: 'use', item: 'b' })).toEqual({
      ok: false,
      reason: 'queue-full',
    });
    engine.dispatch({ type: 'grant', amount: 1 });
    engine.step();
    expect(engine.world.resources).toEqual({ used: ['a'], granted: 2 });
    expect(engine.tryDispatch({ type: 'use', item: 'c' }).ok).toBe(true);
  });

  it('reject invalid options', () => {
    expect(() => createGame(0)).toThrow(RangeError);
    expect(() =>
      createEngine<Game>({
        seed: 1,
        resources: { used: [], granted: 0 },
        commands: { use: { handle: () => {} } as never, grant: () => {} },
      }),
    ).toThrow(TypeError);
  });
});

describe('Determinism', () => {
  type Game = {
    components: {
      position: { x: number; y: number };
      velocity: { x: number; y: number };
      lifetime: { ticks: number };
    };
    events: { expired: { id: number } };
    commands: { burst: { count: number } };
    resources: { spawned: number; expired: number };
  };

  const spawner = defineSystem<Game>({
    name: 'spawner',
    run: ({ world, rng }) => {
      const random = rng('spawn');
      if (random.chance(0.3)) {
        world.spawn({
          position: { x: random.int(0, 100), y: random.int(0, 100) },
          velocity: { x: random.next() - 0.5, y: random.next() - 0.5 },
          lifetime: { ticks: random.int(5, 50) },
        });
        world.resources.spawned++;
      }
    },
  });

  const wander = defineSystem<Game>({
    name: 'wander',
    run: ({ world, rng, dt }) => {
      const random = rng('wander');
      for (const e of world.query('position', 'velocity')) {
        if (random.chance(0.1)) {
          e.velocity.x = random.next() * 2 - 1;
          e.velocity.y = random.next() * 2 - 1;
        }
        e.position.x += e.velocity.x * dt;
        e.position.y += e.velocity.y * dt;
      }
    },
  });

  const expire = defineSystem<Game>({
    name: 'expire',
    run: ({ world, emit }) => {
      for (const e of world.query('lifetime')) {
        e.lifetime.ticks--;
        if (e.lifetime.ticks <= 0) {
          emit('expired', { id: e.id });
          world.despawn(e.id);
        }
      }
    },
  });

  const counter = defineSystem<Game>({
    name: 'counter',
    run: ({ world, read }) => {
      world.resources.expired += read('expired').length;
    },
  });

  const createGame = () =>
    createEngine<Game>({
      seed: 2026,
      systems: [spawner, wander, expire, counter],
      resources: { spawned: 0, expired: 0 },
      commands: {
        burst: ({ world, rng }, { count }) => {
          const random = rng('burst');
          for (let i = 0; i < count; i++) {
            world.spawn({
              position: { x: random.int(0, 100), y: random.int(0, 100) },
              velocity: { x: 0, y: 0 },
              lifetime: { ticks: 20 },
            });
          }
        },
      },
    });

  /** Runs ticks [from, to), dispatching a burst every 250 ticks. */
  const run = (engine: ReturnType<typeof createGame>, from: number, to: number) => {
    for (let t = from; t < to; t++) {
      if (t % 250 === 0) engine.dispatch({ type: 'burst', count: 5 });
      engine.step();
    }
  };

  it('produces identical state for the same seed and commands', () => {
    const a = createGame();
    const b = createGame();
    run(a, 0, 2000);
    run(b, 0, 2000);
    expect(a.serialize()).toBe(b.serialize());
  });

  it('continues identically after save and load', () => {
    const straight = createGame();
    run(straight, 0, 2000);

    const first = createGame();
    run(first, 0, 1000);
    const save = first.serialize();

    const resumed = createGame();
    resumed.load(save);
    run(resumed, 1000, 2000);

    expect(resumed.serialize()).toBe(straight.serialize());
    expect(resumed.world.resources.spawned).toBeGreaterThan(0);
    expect(resumed.world.resources.expired).toBeGreaterThan(0);
  });

  it('gives the same result whether time arrives in one call or many', () => {
    const oneCall = createGame();
    oneCall.advance(5000);

    const manyCalls = createGame();
    for (let i = 0; i < 300; i++) manyCalls.advance(5000 / 300);

    expect(manyCalls.tick).toBe(oneCall.tick);
    expect(manyCalls.world.entities()).toEqual(oneCall.world.entities());
  });

  it('keeps pending commands across save and load', () => {
    const engine = createGame();
    engine.dispatch({ type: 'burst', count: 3 });
    const resumed = createGame();
    resumed.load(engine.serialize());
    resumed.step();
    expect(resumed.world.size).toBeGreaterThanOrEqual(3);
  });

  it('rejects saves in an unknown format', () => {
    const engine = createGame();
    expect(() => engine.load(JSON.stringify({ format: 99 }))).toThrow();
  });
});
