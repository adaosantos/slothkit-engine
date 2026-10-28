import { EventQueue, type Listener } from './events.js';
import { createRngStreams, type Rng } from './rng.js';
import { type Entity, type World, type WorldSnapshot, WorldStore } from './world.js';

type Empty = Record<never, never>;
type Bag = Record<string, unknown>;

/**
 * Describes a game's types. Every field is optional.
 *
 * ```ts
 * type Game = {
 *   components: { position: { x: number; y: number } };
 *   events: { arrived: { id: number } };
 *   commands: { stop: { id: number } };
 *   resources: { elapsed: number };
 * };
 * ```
 */
export interface GameTypes {
  components?: object;
  events?: object;
  commands?: object;
  resources?: object;
}

export type ComponentsOf<T extends GameTypes> = T extends { components: infer X extends object }
  ? X
  : Empty;
export type EventsOf<T extends GameTypes> = T extends { events: infer X extends object }
  ? X
  : Empty;
export type CommandsOf<T extends GameTypes> = T extends { commands: infer X extends object }
  ? X
  : Empty;
export type ResourcesOf<T extends GameTypes> = T extends { resources: infer X extends object }
  ? X
  : Empty;

/** A command as dispatched: its `type` plus its payload fields. */
export type CommandOf<T extends GameTypes> = {
  [K in keyof CommandsOf<T> & string]: { readonly type: K } & CommandsOf<T>[K];
}[keyof CommandsOf<T> & string];

/** What systems and command handlers receive on every tick. */
export interface TickContext<T extends GameTypes> {
  readonly world: World<ComponentsOf<T>, ResourcesOf<T>>;
  /** Index of the tick being run, starting at 0. */
  readonly tick: number;
  /** Fixed duration of one tick, in seconds. */
  readonly dt: number;
  /** Named, independent RNG stream. Never use `Math.random()` in the simulation. */
  rng(stream: string): Rng;
  /** Queues an event. Later systems in this tick can read it; listeners get it after the tick. */
  emit<K extends keyof EventsOf<T>>(type: K, payload: EventsOf<T>[K]): void;
  /** Events of this type emitted so far in the current tick. */
  read<K extends keyof EventsOf<T>>(type: K): readonly EventsOf<T>[K][];
}

/** A unit of game logic that runs once per tick, in the order systems are registered. */
export interface System<T extends GameTypes> {
  readonly name: string;
  run(ctx: TickContext<T>): void;
}

/** Identity helper that gives a system full type inference. */
export function defineSystem<T extends GameTypes>(system: System<T>): System<T> {
  return system;
}

/** Applies a command at the start of a tick. Enforces game rules against the real state. */
export type CommandHandler<T extends GameTypes, K extends keyof CommandsOf<T> & string> = (
  ctx: TickContext<T>,
  command: { readonly type: K } & CommandsOf<T>[K],
) => void;

/** What `validate` receives: a plain object whose `type` is already known to be `K`. */
export type CommandInput<K extends string> = {
  readonly type: K;
  readonly [field: string]: unknown;
};

/**
 * A command that untrusted sources can send through `tryDispatch`.
 *
 * `validate` checks the payload's shape only. It never sees the game state,
 * because the state can change before the command is applied: game rules
 * belong in `handle`.
 */
export interface CommandDefinition<T extends GameTypes, K extends keyof CommandsOf<T> & string> {
  /** Returns true when `input` is a well-formed command. Throwing counts as false. */
  validate(input: CommandInput<K>): boolean;
  handle: CommandHandler<T, K>;
}

/**
 * Command handlers by type. A plain function is trusted: only `dispatch` can
 * queue it. A `{ validate, handle }` definition can also come through `tryDispatch`.
 */
export type CommandHandlers<T extends GameTypes> = {
  [K in keyof CommandsOf<T> & string]: CommandHandler<T, K> | CommandDefinition<T, K>;
};

interface BaseOptions<T extends GameTypes> {
  /** Seed for every RNG stream. */
  seed: number;
  /** Simulation ticks per second. Defaults to 10. */
  tickRate?: number;
  /**
   * Maximum ticks a single `advance()` call will run. Time beyond that is
   * dropped and reported, so a long pause can't freeze the game. Long absences
   * belong to offline progress estimation. Defaults to one minute of ticks.
   */
  maxTicksPerAdvance?: number;
  /** Systems, in execution order. */
  systems?: readonly System<T>[];
  /** Keep a log of applied commands for replays. Defaults to false. */
  recordCommands?: boolean;
  /**
   * Maximum commands waiting for the next tick. `tryDispatch` rejects commands
   * beyond it; `dispatch` always queues. Defaults to 16.
   */
  maxQueuedCommands?: number;
  /** Scene-only state, left out of persistent saves and dropped by `resetScene()`. */
  transient?: TransientOptions<T>;
}

/**
 * Declares which state belongs to the current scene only. Transient state is
 * never in a persistent save and can be thrown away without the player losing
 * anything: systems regenerate it.
 */
export interface TransientOptions<T extends GameTypes> {
  /**
   * Marker components: an entity carrying any of them is transient as a whole
   * (e.g. `'wild'`). Removing the marker makes the entity persistent.
   */
  entities?: readonly (keyof ComponentsOf<T> & string)[];
  /** Components stripped from persistent entities (e.g. `'position'`, `'target'`). */
  components?: readonly (keyof ComponentsOf<T> & string)[];
  /** Resources reset to their initial value from `resources`. */
  resources?: readonly (keyof ResourcesOf<T> & string)[];
}

type CommandsField<T extends GameTypes> = [keyof CommandsOf<T>] extends [never]
  ? { commands?: CommandHandlers<T> }
  : { commands: CommandHandlers<T> };

type ResourcesField<T extends GameTypes> = [keyof ResourcesOf<T>] extends [never]
  ? { resources?: ResourcesOf<T> }
  : { resources: ResourcesOf<T> };

export type EngineOptions<T extends GameTypes> = BaseOptions<T> &
  CommandsField<T> &
  ResourcesField<T>;

/**
 * `full` is the exact simulation state. `persistent` keeps only what the player
 * owns: no transient state, no pending commands, no partial tick.
 */
export type SaveTier = 'full' | 'persistent';

export interface SerializeOptions {
  /** Defaults to `'full'`. */
  tier?: SaveTier;
}

export interface AdvanceResult {
  /** Ticks run by this call. */
  readonly ticks: number;
  /** Milliseconds discarded because `maxTicksPerAdvance` was reached. */
  readonly droppedMs: number;
}

/** Why `tryDispatch` rejected an input. */
export type DispatchRejection =
  /** Not a cloneable object with a string `type`. */
  | 'malformed'
  /** No command of that type, or one without `validate`. */
  | 'unknown-command'
  /** `validate` returned false or threw. */
  | 'invalid'
  /** `maxQueuedCommands` reached. */
  | 'queue-full';

export type DispatchResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DispatchRejection };

export interface CommandLogEntry<T extends GameTypes> {
  readonly tick: number;
  readonly command: CommandOf<T>;
}

export interface Engine<T extends GameTypes> {
  readonly world: World<ComponentsOf<T>, ResourcesOf<T>>;
  /** Number of ticks completed. */
  readonly tick: number;
  readonly tickRate: number;
  /**
   * How far the simulation is into the next tick, from 0 to 1. Renderers use it
   * to interpolate between the previous and current state.
   */
  readonly alpha: number;
  /**
   * Applied commands not yet drained, when `recordCommands` is enabled. It
   * grows without limit unless `drainCommandLog()` is called.
   */
  readonly commandLog: readonly CommandLogEntry<T>[];
  /** Adds elapsed real time and runs every tick that fits. */
  advance(ms: number): AdvanceResult;
  /** Runs an exact number of ticks, ignoring real time. */
  step(ticks?: number): void;
  /**
   * Queues a command from trusted code. It's applied at the start of the next
   * tick. Skips `validate` and the queue limit; throws on an unknown type.
   */
  dispatch(command: CommandOf<T>): void;
  /**
   * Queues a command from an untrusted source, such as a socket. Never throws:
   * accepts only types declared with `validate`, and only while the queue has room.
   */
  tryDispatch(input: unknown): DispatchResult;
  /** Returns the command log entries recorded since the last drain and clears them. */
  drainCommandLog(): CommandLogEntry<T>[];
  /** Subscribes to an event. Listeners run after the tick that emitted it. */
  on<K extends keyof EventsOf<T>>(type: K, listener: Listener<EventsOf<T>[K]>): () => void;
  /**
   * The simulation state as a JSON string. A `full` save resumes exactly. A
   * `persistent` save keeps entity ids, ticks, and RNG state, and loads into
   * the same state `resetScene()` produces.
   */
  serialize(options?: SerializeOptions): string;
  /** Replaces the simulation state with a string produced by `serialize()`, of either tier. */
  load(data: string): void;
  /**
   * Drops transient state in place: transient entities, transient components,
   * transient resources (back to their initial value), pending commands, and
   * the partial tick. Equivalent to loading a persistent save of the current
   * state. Can't be called during a tick.
   */
  resetScene(): void;
}

const SAVE_FORMAT = 1;

interface SaveData<T extends GameTypes> {
  format: number;
  kind: SaveTier;
  tick: number;
  accumulator: number;
  world: WorldSnapshot<ComponentsOf<T>, ResourcesOf<T>>;
  rng: Record<string, number>;
  pending: CommandOf<T>[];
}

interface RegisteredCommand<T extends GameTypes> {
  handle: (ctx: TickContext<T>, command: CommandOf<T>) => void;
  validate?: (input: CommandInput<string>) => boolean;
}

type AnyCommandEntry<T extends GameTypes> =
  | RegisteredCommand<T>['handle']
  | { validate: RegisteredCommand<T>['validate']; handle: RegisteredCommand<T>['handle'] };

function registerCommands<T extends GameTypes>(
  handlers: CommandHandlers<T> | undefined,
): Map<string, RegisteredCommand<T>> {
  const commands = new Map<string, RegisteredCommand<T>>();
  for (const [type, entry] of Object.entries(
    (handlers ?? {}) as Record<string, AnyCommandEntry<T>>,
  )) {
    if (typeof entry === 'function') {
      commands.set(type, { handle: entry });
    } else if (typeof entry?.handle === 'function' && typeof entry.validate === 'function') {
      commands.set(type, { handle: entry.handle, validate: entry.validate });
    } else {
      throw new TypeError(
        `createEngine: command "${type}" must be a function or { validate, handle }`,
      );
    }
  }
  return commands;
}

function isCommandInput(value: unknown): value is CommandInput<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

const reject = (reason: DispatchRejection): DispatchResult => ({ ok: false, reason });

export function createEngine<T extends GameTypes>(options: EngineOptions<T>): Engine<T> {
  const tickRate = options.tickRate ?? 10;
  if (!Number.isFinite(tickRate) || tickRate <= 0) {
    throw new RangeError('createEngine: tickRate must be a positive number');
  }
  const maxTicksPerAdvance = options.maxTicksPerAdvance ?? tickRate * 60;
  if (!Number.isInteger(maxTicksPerAdvance) || maxTicksPerAdvance < 1) {
    throw new RangeError('createEngine: maxTicksPerAdvance must be a positive integer');
  }

  const stepMs = 1000 / tickRate;
  const dt = 1 / tickRate;
  const systems = [...(options.systems ?? [])];
  const commands = registerCommands(options.commands);
  const recordCommands = options.recordCommands ?? false;
  const maxQueuedCommands = options.maxQueuedCommands ?? 16;
  if (!Number.isInteger(maxQueuedCommands) || maxQueuedCommands < 1) {
    throw new RangeError('createEngine: maxQueuedCommands must be a positive integer');
  }

  const initialResources = structuredClone(options.resources ?? {}) as ResourcesOf<T>;
  const world = new WorldStore<ComponentsOf<T>, ResourcesOf<T>>(structuredClone(initialResources));

  const transientEntities: readonly string[] = options.transient?.entities ?? [];
  const transientComponents: readonly string[] = options.transient?.components ?? [];
  const transientResources: readonly string[] = options.transient?.resources ?? [];
  for (const key of transientResources) {
    if (!Object.hasOwn(initialResources, key)) {
      throw new Error(`createEngine: transient resource "${key}" has no initial value`);
    }
  }
  const isTransient = (entity: Entity<ComponentsOf<T>>): boolean =>
    transientEntities.some((key) => (entity as Bag)[key] !== undefined);
  const initialResource = (key: string): unknown => structuredClone((initialResources as Bag)[key]);
  const rng = createRngStreams(options.seed);
  const events = new EventQueue<EventsOf<T>>();

  let tick = 0;
  let inTick = false;
  let accumulator = 0;
  let pending: CommandOf<T>[] = [];
  const commandLog: CommandLogEntry<T>[] = [];

  const ctx: TickContext<T> = {
    world,
    get tick() {
      return tick;
    },
    dt,
    rng: (stream) => rng.stream(stream),
    emit: (type, payload) => events.emit(type, payload),
    read: (type) => events.read(type),
  };

  function runTick(): void {
    inTick = true;
    world.beginDeferred();
    try {
      const queued = pending;
      pending = [];
      for (const command of queued) {
        const registered = commands.get(command.type);
        if (!registered) throw new Error(`Unknown command "${command.type}"`);
        registered.handle(ctx, command);
        if (recordCommands) commandLog.push({ tick, command });
      }
      world.flushDeferred();

      for (const system of systems) {
        system.run(ctx);
        world.flushDeferred();
      }
    } finally {
      world.endDeferred();
      inTick = false;
    }

    const completed = tick;
    tick++;
    events.flush(completed);
  }

  /** The world as `resetScene()` would leave it, without touching the live world. */
  function persistentSnapshot(): WorldSnapshot<ComponentsOf<T>, ResourcesOf<T>> {
    const snapshot = world.snapshot();
    const entities = snapshot.entities
      .filter((entity) => !isTransient(entity))
      .map((entity) => {
        const copy = { ...entity } as Bag;
        for (const key of transientComponents) delete copy[key];
        return copy as Entity<ComponentsOf<T>>;
      });
    const resources = { ...snapshot.resources } as Bag;
    for (const key of transientResources) resources[key] = initialResource(key);
    return { nextId: snapshot.nextId, entities, resources: resources as ResourcesOf<T> };
  }

  return {
    world,
    get tick() {
      return tick;
    },
    tickRate,
    get alpha() {
      return accumulator / stepMs;
    },
    commandLog,

    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError('Engine.advance: ms must be a non-negative number');
      }
      accumulator += ms;
      let ticks = 0;
      while (accumulator >= stepMs && ticks < maxTicksPerAdvance) {
        accumulator -= stepMs;
        runTick();
        ticks++;
      }
      let droppedMs = 0;
      if (accumulator >= stepMs) {
        const remainder = accumulator % stepMs;
        droppedMs = accumulator - remainder;
        accumulator = remainder;
      }
      return { ticks, droppedMs };
    },

    step(count = 1) {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError('Engine.step: count must be a non-negative integer');
      }
      for (let i = 0; i < count; i++) runTick();
    },

    dispatch(command) {
      if (!commands.has(command.type)) {
        throw new Error(`Engine.dispatch: no handler for command "${command.type}"`);
      }
      pending.push(structuredClone(command));
    },

    tryDispatch(input) {
      if (pending.length >= maxQueuedCommands) return reject('queue-full');
      // Clone first and check only the clone, so getters or later mutations
      // can't change the command after it passes validation.
      let command: unknown;
      try {
        command = structuredClone(input);
      } catch {
        return reject('malformed');
      }
      if (!isCommandInput(command)) return reject('malformed');
      const validate = commands.get(command.type)?.validate;
      if (!validate) return reject('unknown-command');
      let valid: boolean;
      try {
        valid = validate(command);
      } catch {
        valid = false;
      }
      if (valid !== true) return reject('invalid');
      pending.push(command as CommandOf<T>);
      return { ok: true };
    },

    drainCommandLog() {
      return commandLog.splice(0);
    },

    on(type, listener) {
      return events.on(type, listener);
    },

    serialize({ tier = 'full' } = {}) {
      const data: SaveData<T> =
        tier === 'full'
          ? {
              format: SAVE_FORMAT,
              kind: 'full',
              tick,
              accumulator,
              world: world.snapshot(),
              rng: rng.getState(),
              pending,
            }
          : {
              format: SAVE_FORMAT,
              kind: 'persistent',
              tick,
              accumulator: 0,
              world: persistentSnapshot(),
              rng: rng.getState(),
              pending: [],
            };
      return JSON.stringify(data);
    },

    resetScene() {
      if (inTick) throw new Error('Engine.resetScene: cannot reset during a tick');
      for (const entity of world.entities()) {
        if (isTransient(entity)) {
          world.despawn(entity.id);
          continue;
        }
        for (const key of transientComponents) {
          world.remove(entity, key as keyof ComponentsOf<T>);
        }
      }
      const resources = world.resources as Bag;
      for (const key of transientResources) resources[key] = initialResource(key);
      pending = [];
      accumulator = 0;
    },

    load(serialized) {
      const data = JSON.parse(serialized) as SaveData<T>;
      if (data.format !== SAVE_FORMAT) {
        throw new Error(`Engine.load: unsupported save format ${String(data.format)}`);
      }
      if (data.kind !== 'full' && data.kind !== 'persistent') {
        throw new Error(`Engine.load: unknown save kind ${String(data.kind)}`);
      }
      world.restore(data.world);
      rng.setState(data.rng);
      tick = data.tick;
      accumulator = data.accumulator;
      pending = data.pending;
      events.clear();
    },
  };
}
