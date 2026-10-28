# CLAUDE.md

Context for Claude Code when working in this repository.

## Working with the maintainer

- Talk to the maintainer in **Portuguese (pt-BR)**. Write code, comments, docs, commit messages, and PR descriptions in **English**.
- The maintainer is a backend/platform engineer. Skip basics about servers, databases, and infra; spend the detail on game-engine concepts.
- Discuss design decisions before implementing anything that changes a public API. Record decisions that span packages in `docs/architecture.md`.

## What Slothkit is

A headless TypeScript engine for auto-hunting idle RPGs (inspired by PokeIdle): a party walks a bounded map instance, fights creatures automatically, earns XP and loot, uses potions, and returns to town to sell and restock. It must support both a creature-collector setup (a trainer with a team of creatures, each with its own stats, HP, level, and XP) and a solo RPG (one character), through configuration.

- Repo: https://github.com/adaosantos/slothkit
- npm scope: `@slothkit-engine/*` (the `@slothkit` org belongs to someone else)
- License: MIT
- Status: pre-alpha. Only `@slothkit-engine/core` exists.

Read `README.md` (design target and API vision), `docs/architecture.md` (online architecture), and `CONTRIBUTING.md` (rules) before larger changes.

## Commands

```bash
pnpm install
pnpm lint        # biome check .
pnpm format      # biome check --write . (fixes formatting and safe lint issues)
pnpm typecheck
pnpm test        # vitest run
pnpm build       # tsdown, per package
pnpm changeset   # needed for changes to published packages
```

Run `pnpm format`, then `pnpm lint`, `pnpm typecheck`, and `pnpm test` before considering a change done. CI runs lint, typecheck, test, and build.

## Toolchain notes

- **pnpm 12**, pinned in `packageManager`. The CI pins the same version explicitly in `pnpm/action-setup@v6`, because that action doesn't always honor `packageManager`. Keep both in sync.
- **Node**: `.nvmrc` is 26, `engines` is `>=22.13`.
- **TypeScript 7** with `isolatedDeclarations: true`. TS 7 has no classic compiler API yet, so tsdown emits `.d.ts` through Oxc, which requires explicit types on everything exported (including function return types). Since TS 6, `types` defaults to `[]`, so `@types/node` isn't included automatically (the packages don't need it).
- **Biome 2.6** formats JS/TS, JSON, Markdown, and YAML. The linter uses `"preset": "recommended"` (the old `"recommended": true` is deprecated). `pnpm-lock.yaml` and `CHANGELOG.md` files are excluded.
- **Vitest 5**, **tsdown 0.23**, **Changesets 3** (config schema `@changesets/config@4.0.1`).
- Packages are ESM-only.

## Repository layout

```
packages/core/
  src/
    index.ts    public API: re-exports only. WorldStore and EventQueue stay internal.
    engine.ts   createEngine: clock, tick cycle, commands, events, serialize/load
    world.ts    WorldStore: entities, components, cached queries, deferred despawn
    events.ts   EventQueue: per-tick queue, listeners after the tick
    rng.ts      mulberry32 createRng + named streams (createRngStreams)
  test/         *.test.ts (Vitest)
docs/architecture.md
examples/       empty for now
```

## Core design (implemented)

- **Entities are plain objects** with optional components (`{ id, position, health, ... }`), not a typed-array ECS. Ids are incremental and never reused. Components that an entity doesn't have yet must be added with `world.add` (direct assignment isn't tracked by queries). `world.remove` removes them.
- **Queries** return entities in ascending id order (required for determinism after load) as snapshot arrays. Any structural change clears the whole query cache. This is intentional at idle-game scale.
- **Despawn is deferred during a tick** and flushed after each system, so a later system never sees an entity despawned by an earlier one. Data a later system needs (e.g., for loot) must travel in the event payload.
- **Fixed timestep**: default 10 Hz, configurable (`tickRate`). `advance(ms)` uses an accumulator, caps ticks per call (`maxTicksPerAdvance`, default one minute of ticks), and reports `droppedMs`. `step(n)` runs exact ticks. `engine.tick` is the number of completed ticks; `ctx.tick` is the 0-based index of the running tick.
- **Tick cycle**: apply queued commands in dispatch order → flush → run systems in registration order (flush after each) → `tick++` → deliver queued events to listeners.
- **Events are queued per tick**: systems later in the same tick can `read()` them; external listeners (`engine.on`) receive them only after the tick completes.
- **Commands** are declared as a plain handler function (trusted only) or as `{ validate, handle }` (also accepted from untrusted sources). Command types are looked up in a `Map`, never on a plain object, so `{ type: 'toString' }` can't reach `Object.prototype`. Commands are applied at the start of the next tick and optionally recorded in `commandLog`; `drainCommandLog()` returns and clears the entries since the last drain.
- **Two dispatch paths.** `dispatch(command)` is for trusted, typed code: it throws on unknown types, skips `validate`, and ignores the queue limit. `tryDispatch(input: unknown)` is for socket input and never throws: it returns `{ ok: true }` or `{ ok: false, reason }` with `reason` one of `queue-full` (checked first, cheapest under flood), `malformed` (not a cloneable object with a string `type`), `unknown-command` (unknown, or declared without `validate`), or `invalid` (`validate` returned anything but `true`, or threw). It `structuredClone`s first and validates the clone, so getters or later mutation can't swap the payload. `validate` checks shape only and never sees the state, since the state can change before the command is applied; game rules belong in `handle`. `maxQueuedCommands` (default 16) caps pending commands; `dispatch` counts toward it. The field is `handle`, not `apply`: a union with a function type would merge with `Function.prototype.apply` and break contextual typing.
- **RNG**: never use `Math.random()`. Systems draw from named streams (`ctx.rng('loot')`), derived from the engine seed, so one system's random calls don't shift another's.
- **Game types** are declared in one type (`{ components, events, commands, resources }`, all optional) and passed as `createEngine<Game>()` / `defineSystem<Game>()`. `commands` and `resources` options become required when the game declares them.
- **serialize()** returns a JSON string with `format`, `tick`, `accumulator`, world (`nextId`, entities, resources), RNG stream states, and pending commands. The engine never stores it anywhere: the caller decides (localStorage, database). `load()` restores in place, so references to `engine.world` stay valid.
- The determinism test (1000 ticks → save → load → 1000 ticks must equal 2000 straight ticks, byte for byte) is the most important test in the package. Keep it passing.

## Rules

From `CONTRIBUTING.md`, condensed:

- The simulation is deterministic: no `Math.random()`, no clock reads inside a tick (time comes from `dt`), no order-dependent iteration over unordered collections.
- No transcendental math (`Math.sin`, `Math.exp`, `Math.log`, non-integer `Math.pow`) in logic that decides outcomes and could run on more than one JS engine. Server-only code (the offline estimator) may use them.
- Systems are synchronous. Nothing async inside a tick.
- Packages are runtime-agnostic (no `node:*`, `process`, `Bun`, `Deno` in `src`) and headless (no DOM, no rendering).
- `@slothkit-engine/core` has zero runtime dependencies.
- All state is plain JSON-serializable data. Systems are stateless; state they need between ticks lives in `world.resources` or components.
- Content (creatures, items, maps, rules) is data; mechanics are systems.
- Never break a save: shape changes need a migration and a test.
- Examples use original names and art only (no Pokémon or other franchise IP).
- Conventional Commits (`feat(core): ...`). Before 1.0, breaking changes are `minor` changesets.

## Architecture decisions (online games)

Full detail in `docs/architecture.md`. Summary:

- **Server-authoritative.** The server runs one engine per player; every hunt is a private instance (players don't see each other). The browser only renders: it receives scene state and events over a socket, interpolates between ticks, and sends commands. Seeds never leave the server.
- **Session lifecycle.** On disconnect, the server saves and stops the engine. Back within the grace period (default 10 min): run the missed ticks with `step(n)`, which is identical to live simulation. Back later: offline estimator. Offline progress is capped at 24 h (configurable): a player away longer gets exactly 24 h of rewards, and the hunt ends with the party in town. Time away is measured with the server clock.
- **State tiers.** Persistent (party units, inventory, gold, current map, rules) is saved. Transient (positions, live wild creatures, targets, cooldowns) is never saved and is regenerated by spawners when a session starts.
- **Persistence policy** belongs to the game server: valuable changes are written immediately, accumulated gains in periodic checkpoints, everything on disconnect. Snapshot + command log enables exact crash recovery.
- **Loot.** Rolled per kill (`rng.next() < chance`). No expected-value shortcuts, no pity timers, no variable per-hunt rates: luck must matter, so a 10% drop over 100 kills can land 5 or 12 times. Offline, drop counts are sampled from the binomial distribution, exactly (geometric skipping, cost proportional to hits), switching to a normal approximation only when both expected hits and misses exceed ~1000, as a performance guard.

## Next steps

Do these in order.

### 1. Persistent and transient state tiers in `core` (next)

- A way to mark entities as transient (e.g., a `transient` marker component or a spawn option).
- A persistent save that excludes transient entities and other scene-only state.
- `resetScene()` that removes transient entities so spawners can repopulate.
- Tests: persistent save → load → reset → continue.

### 2. Vertical slice (`examples/critter-hunt`), online from the start

- Node server: one engine per player, WebSocket transport.
- Minimal mechanics: one map, one spawner, one enemy species, one player creature that seeks the nearest target, locks into a timer-driven fight, kills, and earns XP.
- Canvas client: receives state, interpolates, draws, and sends one command.
- Session: disconnect and reconnect within the grace period using `step(n)`.
- Mechanics start inside the example and are extracted into packages (`world`, `combat`, `units`, `net`) once they stabilize.

### 3. After the slice

Loot and inventory → potions and hunting rules → town and shop → multi-unit party → offline estimator with the 24 h cap → `net` package → balance simulator.

### Open issue to remember

On the server, many engines share a process. An error in one player's system must not affect others: the game server should catch it, mark that engine as failed, and reload it from the last save. `core` may expose an explicit failed state later.
