import { describe, expect, it } from 'vitest';
import { WorldStore } from '../src/world.js';

type C = {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  health: { hp: number };
};

const createWorld = () => new WorldStore<C, Record<never, never>>({});

describe('World', () => {
  it('assigns increasing ids and never reuses them', () => {
    const world = createWorld();
    const a = world.spawn();
    const b = world.spawn();
    world.despawn(a.id);
    const c = world.spawn();
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
  });

  it('rejects an id passed to spawn', () => {
    const world = createWorld();
    expect(() => world.spawn({ id: 5 } as never)).toThrow();
  });

  it('queries entities that have every requested component, in id order', () => {
    const world = createWorld();
    const moving = world.spawn({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 } });
    world.spawn({ position: { x: 5, y: 5 } });
    const movingToo = world.spawn({ position: { x: 1, y: 1 }, velocity: { x: 0, y: 1 } });

    const ids = world.query('position', 'velocity').map((e) => e.id);
    expect(ids).toEqual([moving.id, movingToo.id]);
    expect(world.query('position')).toHaveLength(3);
  });

  it('updates queries when components are added or removed', () => {
    const world = createWorld();
    const entity = world.spawn({ position: { x: 0, y: 0 } });
    expect(world.query('velocity')).toHaveLength(0);

    world.add(entity, 'velocity', { x: 1, y: 1 });
    expect(world.query('velocity')).toHaveLength(1);

    world.remove(entity, 'velocity');
    expect(world.query('velocity')).toHaveLength(0);
    expect(entity.velocity).toBeUndefined();
  });

  it('returns query snapshots that later changes do not modify', () => {
    const world = createWorld();
    world.spawn({ health: { hp: 1 } });
    const before = world.query('health');
    world.spawn({ health: { hp: 2 } });
    expect(before).toHaveLength(1);
    expect(world.query('health')).toHaveLength(2);
  });

  it('removes entities immediately outside a tick', () => {
    const world = createWorld();
    const entity = world.spawn({ health: { hp: 1 } });
    world.despawn(entity.id);
    expect(world.has(entity.id)).toBe(false);
    expect(world.query('health')).toHaveLength(0);
  });

  it('defers despawns during a tick until they are flushed', () => {
    const world = createWorld();
    const a = world.spawn({ health: { hp: 1 } });
    const b = world.spawn({ health: { hp: 2 } });

    world.beginDeferred();
    world.despawn(a.id);
    expect(world.has(a.id)).toBe(false);
    expect(world.get(a.id)).toBeUndefined();
    expect(world.size).toBe(1);

    world.flushDeferred();
    expect(world.query('health').map((e) => e.id)).toEqual([b.id]);
    world.endDeferred();
  });

  it('restores a snapshot', () => {
    const world = createWorld();
    world.spawn({ position: { x: 1, y: 2 } });
    world.spawn({ health: { hp: 3 } });
    const snapshot = JSON.parse(JSON.stringify(world.snapshot()));

    const copy = createWorld();
    copy.restore(snapshot);
    expect(copy.entities()).toEqual(world.entities());
    expect(copy.spawn().id).toBe(3);
  });
});
