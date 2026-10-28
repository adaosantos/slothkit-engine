---

## '@slothkit-engine/core': minor

Add safe command intake for untrusted input. Commands can be declared as `{ validate, handle }`; `engine.tryDispatch(input)` accepts only those, never throws, and returns `{ ok: true }` or `{ ok: false, reason }` (`malformed`, `unknown-command`, `invalid`, `queue-full`). New `maxQueuedCommands` option (default 16) and `engine.drainCommandLog()`. Command lookup no longer falls through to `Object.prototype`, so `{ type: 'toString' }` is rejected.
