# Contributing to Slothkit

Thanks for your interest in Slothkit! This guide covers how to set up the project, the rules the codebase follows, and how to get a change merged.

Slothkit is **pre-alpha**. The most valuable contributions right now are feedback on the API, bug reports, and small focused PRs. If you're planning something bigger, please open an issue first so we can agree on the approach before you spend time on it.

## Ways to contribute

- **Report a bug.** Open an issue with what you expected, what happened, and the smallest code that reproduces it. If the bug involves the simulation, include the seed.
- **Discuss the API.** Open a discussion or comment on an existing one. Concrete examples ("I tried to model X and couldn't") are especially helpful.
- **Improve the docs.** Typos, unclear explanations, and missing examples are all welcome as PRs without an issue.
- **Write code.** Pick an issue labeled `good first issue` or `help wanted`, or open one describing what you'd like to build.

## Setup

You need:

- **Node.js 22.13 or newer.** The repo pins the version in `.nvmrc`, so `nvm use` or `fnm use` picks the right one.
- **pnpm**, at the version pinned in the `packageManager` field of `package.json`.

```bash
git clone https://github.com/adaosantos/slothkit.git
cd slothkit
pnpm install
```

Then check that everything works:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Project structure

```
packages/       one folder per published package (@slothkit/core, ...)
  core/
    src/        source code
    test/       tests (*.test.ts)
examples/       example games built with Slothkit
.changeset/     pending changelog entries
```

## Scripts

- `pnpm test` runs all tests once. `pnpm test:watch` keeps them running while you work.
- `pnpm typecheck` type-checks every package.
- `pnpm lint` checks formatting and lint rules with Biome.
- `pnpm format` fixes formatting and safe lint issues automatically.
- `pnpm build` builds every package into its `dist/` folder.
- `pnpm changeset` records a changelog entry for your change.

Installing the Biome extension for your editor and enabling format on save will save you most lint round-trips.

## Engine rules

These rules keep Slothkit predictable for everyone who builds on it. PRs that break them will be asked to change, so it's worth reading them before you start.

### 1. The simulation is deterministic

The same seed and the same commands must always produce the same state.

- Never use `Math.random()`. Use the engine's `Rng`.
- Never read the clock (`Date.now()`, `performance.now()`) inside the simulation. Time comes in as `dt`.
- Never iterate over something with an unstable order when the order affects the result.
- Every system that changes state needs a determinism test: run it twice with the same seed and inputs, and assert the resulting states are equal.

### 2. Systems are synchronous

A tick runs every system in order, synchronously. No `async`, no `await`, no promises inside a tick. Anything asynchronous (network, storage, asset loading) happens outside the loop and reaches the simulation through a queue or a command.

### 3. Packages are runtime-agnostic and headless

Slothkit runs in browsers, Node, Deno, and Bun.

- Don't use runtime-specific APIs (`node:fs`, `process`, `Bun.*`, `Deno.*`) in `packages/*/src`.
- Don't draw anything or touch the DOM. The engine exposes state and events; rendering belongs to the game.
- `@slothkit/core` has **zero runtime dependencies**. Other packages should avoid them too. If you think one is needed, raise it in an issue first.

### 4. Exported functions have explicit types

The packages are built with `isolatedDeclarations`, so everything exported needs an explicit type, including function return types. TypeScript will tell you when one is missing.

```ts
// ✗ return type is inferred
export function createRng(seed: number) { /* ... */ }

// ✓ return type is explicit
export function createRng(seed: number): Rng { /* ... */ }
```

### 5. Content is data, mechanics are systems

Creatures, items, maps, and rules are declared as plain data. Behavior lives in systems. If a feature needs a special case for a specific creature or item, it probably needs a new piece of data or a new system instead.

### 6. Saves never break

Any change to the shape of saved state needs a save migration and a test that loads a save from the previous version.

## Tests

- Tests live in `packages/<name>/test/` and end with `.test.ts`.
- Test behavior through the public API whenever possible, rather than internal helpers.
- Use fixed seeds in tests. A test that depends on chance should either be deterministic or check a property that holds for every seed you try.
- Bug fixes should include a test that fails without the fix.

## Changesets

Every PR that changes a published package needs a changeset:

```bash
pnpm changeset
```

Choose the affected packages, the type of bump, and write a one-line summary for users of the package. While Slothkit is below `1.0`, breaking changes are `minor` bumps and everything else is `patch`.

Changes that don't affect published packages (docs, examples, CI, tests) don't need a changeset.

## Commits and pull requests

- Keep each PR focused on one change. Several small PRs are easier to review than one large one.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(core): add event bus`, `fix(combat): stop units attacking after death`, `docs: clarify offline progress`.
- Fill in the PR description: what changed, why, and how you tested it.
- Make sure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass locally. CI runs the same checks.
- Update the docs and the README when you change public API.

## Examples and assets

Examples must use **original content**: original creature names, sprites, and sounds. Please don't submit names, art, or other material from existing games or franchises.

If you add assets made by someone else, check that their license allows redistribution, and credit them in a `CREDITS.md` file next to the example.

## License

Slothkit is licensed under the [MIT License](./LICENSE). By submitting a contribution, you agree that it will be released under the same license.