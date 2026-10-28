import { EventQueue, type Listener } from './events.js';
import { createRngStreams, type Rng } from './rng.js';
import { type World, type WorldSnapshot, WorldStore } from './world.js';

type Empty = Record<never, never>;

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

export type CommandHandlers<T extends GameTypes> = {
  [K in keyof CommandsOf<T> & string]: (
    ctx: TickContext<T>,
    command: { readonly type: K } & CommandsOf<T>[K],
  ) => void;
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

export interface AdvanceResult {
  /** Ticks run by this call. */
  readonly ticks: number;
  /** Milliseconds discarded because `maxTicksPerAdvance` was reached. */
  readonly droppedMs: number;
}

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
  /** Applied commands, when `recordCommands` is enabled. */
  readonly commandLog: readonly CommandLogEntry<T>[];
  /** Adds elapsed real time and runs every tick that fits. */
  advance(ms: number): AdvanceResult;
  /** Runs an exact number of ticks, ignoring real time. */
  step(ticks?: number): void;
  /** Queues a command. It's applied at the start of the next tick. */
  dispatch(command: CommandOf<T>): void;
  /** Subscribes to an event. Listeners run after the tick that emitted it. */
  on<K extends keyof EventsOf<T>>(type: K, listener: Listener<EventsOf<T>[K]>): () => void;
  /** The full simulation state as a JSON string. */
  serialize(): string;
  /** Replaces the simulation state with a string produced by `serialize()`. */
  load(data: string): void;
}

const SAVE_FORMAT = 1;

interface SaveData<T extends GameTypes> {
  format: number;
  tick: number;
  accumulator: number;
  world: WorldSnapshot<ComponentsOf<T>, ResourcesOf<T>>;
  rng: Record<string, number>;
  pending: CommandOf<T>[];
}

type AnyHandler<T extends GameTypes> = (ctx: TickContext<T>, command: CommandOf<T>) => void;

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
  const handlers = (options.commands ?? {}) as Record<string, AnyHandler<T> | undefined>;
  const recordCommands = options.recordCommands ?? false;

  const initialResources = structuredClone(options.resources ?? {}) as ResourcesOf<T>;
  const world = new WorldStore<ComponentsOf<T>, ResourcesOf<T>>(initialResources);
  const rng = createRngStreams(options.seed);
  const events = new EventQueue<EventsOf<T>>();

  let tick = 0;
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
    world.beginDeferred();
    try {
      const commands = pending;
      pending = [];
      for (const command of commands) {
        const handler = handlers[command.type];
        if (!handler) throw new Error(`Unknown command "${command.type}"`);
        handler(ctx, command);
        if (recordCommands) commandLog.push({ tick, command });
      }
      world.flushDeferred();

      for (const system of systems) {
        system.run(ctx);
        world.flushDeferred();
      }
    } finally {
      world.endDeferred();
    }

    const completed = tick;
    tick++;
    events.flush(completed);
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
      if (!handlers[command.type]) {
        throw new Error(`Engine.dispatch: no handler for command "${command.type}"`);
      }
      pending.push(structuredClone(command));
    },

    on(type, listener) {
      return events.on(type, listener);
    },

    serialize() {
      const data: SaveData<T> = {
        format: SAVE_FORMAT,
        tick,
        accumulator,
        world: world.snapshot(),
        rng: rng.getState(),
        pending,
      };
      return JSON.stringify(data);
    },

    load(serialized) {
      const data = JSON.parse(serialized) as SaveData<T>;
      if (data.format !== SAVE_FORMAT) {
        throw new Error(`Engine.load: unsupported save format ${String(data.format)}`);
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
