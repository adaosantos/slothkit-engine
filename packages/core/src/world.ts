export type EntityId = number;

/** Components an entity may carry. Every component is optional on a generic entity. */
export type ComponentInit<C> = { [K in keyof C]?: C[K] };

/** An entity: a numeric id plus any subset of the components in `C`. */
export type Entity<C> = { readonly id: EntityId } & ComponentInit<C>;

/** An entity known to carry the components in `K`. */
export type With<C, K extends keyof C> = Entity<C> & { [P in K]-?: C[P] };

/**
 * The simulation state: entities with components, plus global resources.
 *
 * Everything stored here must be plain data (no classes, functions, or
 * circular references) so the whole world can be saved as JSON.
 */
export interface World<C, R> {
  /** Global state shared by systems, such as timers or counters. */
  readonly resources: R;
  /** Number of live entities. */
  readonly size: number;
  /** Creates an entity with the given components and returns it. */
  spawn(components?: ComponentInit<C>): Entity<C>;
  /**
   * Removes an entity. During a tick, removal is deferred until the current
   * system finishes, so iterating a query while despawning is safe.
   */
  despawn(id: EntityId): void;
  /** Returns a live entity, or `undefined` if it doesn't exist or is being despawned. */
  get(id: EntityId): Entity<C> | undefined;
  /** Whether a live entity with this id exists. */
  has(id: EntityId): boolean;
  /** Adds or replaces a component. Use this instead of assigning a new key directly. */
  add<K extends keyof C>(entity: Entity<C>, key: K, value: C[K]): With<C, K>;
  /** Removes a component. Use this instead of `delete`. */
  remove<K extends keyof C>(entity: Entity<C>, key: K): void;
  /**
   * Entities that carry every component in `keys`, in ascending id order.
   * The returned array is a snapshot: later changes to the world don't modify it.
   */
  query<K extends keyof C>(...keys: K[]): readonly With<C, K>[];
  /** All entities, in ascending id order. */
  entities(): readonly Entity<C>[];
}

export interface WorldSnapshot<C, R> {
  nextId: number;
  entities: Entity<C>[];
  resources: R;
}

type Bag = Record<PropertyKey, unknown>;

/** Internal implementation of `World`, with hooks used by the engine. */
export class WorldStore<C, R> implements World<C, R> {
  #entities: Map<EntityId, Entity<C>> = new Map();
  #nextId = 1;
  #resources: R;
  #deferring = false;
  #pendingDespawn: Set<EntityId> = new Set();
  #queryCache: Map<string, readonly Entity<C>[]> = new Map();

  constructor(resources: R) {
    this.#resources = resources;
  }

  get resources(): R {
    return this.#resources;
  }

  get size(): number {
    return this.#entities.size - this.#pendingDespawn.size;
  }

  spawn(components: ComponentInit<C> = {}): Entity<C> {
    if (Object.hasOwn(components, 'id')) {
      throw new Error('World.spawn: "id" is assigned by the world and cannot be passed in');
    }
    const entity = { id: this.#nextId++, ...components } as Entity<C>;
    this.#entities.set(entity.id, entity);
    this.#invalidate();
    return entity;
  }

  despawn(id: EntityId): void {
    if (!this.#entities.has(id)) return;
    if (this.#deferring) {
      this.#pendingDespawn.add(id);
      return;
    }
    this.#entities.delete(id);
    this.#invalidate();
  }

  get(id: EntityId): Entity<C> | undefined {
    return this.has(id) ? this.#entities.get(id) : undefined;
  }

  has(id: EntityId): boolean {
    return this.#entities.has(id) && !this.#pendingDespawn.has(id);
  }

  add<K extends keyof C>(entity: Entity<C>, key: K, value: C[K]): With<C, K> {
    if (key === 'id') throw new Error('World.add: "id" is not a component');
    if (value === undefined) throw new Error('World.add: use remove() to clear a component');
    if (!this.#entities.has(entity.id)) {
      throw new Error(`World.add: entity ${entity.id} is not in this world`);
    }
    const bag = entity as Bag;
    const isNew = bag[key] === undefined;
    bag[key] = value;
    if (isNew) this.#invalidate();
    return entity as With<C, K>;
  }

  remove<K extends keyof C>(entity: Entity<C>, key: K): void {
    if (key === 'id') throw new Error('World.remove: "id" is not a component');
    const bag = entity as Bag;
    if (bag[key] === undefined) return;
    delete bag[key];
    this.#invalidate();
  }

  query<K extends keyof C>(...keys: K[]): readonly With<C, K>[] {
    const cacheKey = keys.map(String).sort().join('|');
    let result = this.#queryCache.get(cacheKey);
    if (!result) {
      const all = [...this.#entities.values()];
      result =
        keys.length === 0
          ? all
          : all.filter((entity) => keys.every((key) => (entity as Bag)[key] !== undefined));
      this.#queryCache.set(cacheKey, result);
    }
    return result as readonly With<C, K>[];
  }

  entities(): readonly Entity<C>[] {
    return this.query();
  }

  // ---- engine hooks -------------------------------------------------------

  /** Starts deferring despawns (called by the engine at the start of a tick). */
  beginDeferred(): void {
    this.#deferring = true;
  }

  /** Applies pending despawns (called by the engine after each system). */
  flushDeferred(): void {
    if (this.#pendingDespawn.size === 0) return;
    for (const id of this.#pendingDespawn) this.#entities.delete(id);
    this.#pendingDespawn.clear();
    this.#invalidate();
  }

  /** Flushes and stops deferring (called by the engine at the end of a tick). */
  endDeferred(): void {
    this.flushDeferred();
    this.#deferring = false;
  }

  snapshot(): WorldSnapshot<C, R> {
    return {
      nextId: this.#nextId,
      entities: [...this.#entities.values()],
      resources: this.#resources,
    };
  }

  restore(snapshot: WorldSnapshot<C, R>): void {
    const sorted = [...snapshot.entities].sort((a, b) => a.id - b.id);
    const maxId = sorted.length > 0 ? (sorted[sorted.length - 1]?.id ?? 0) : 0;
    if (snapshot.nextId <= maxId) {
      throw new Error('World.restore: nextId must be greater than every entity id');
    }
    this.#entities = new Map(sorted.map((entity) => [entity.id, entity]));
    this.#nextId = snapshot.nextId;
    this.#resources = snapshot.resources;
    this.#pendingDespawn.clear();
    this.#deferring = false;
    this.#invalidate();
  }

  #invalidate(): void {
    this.#queryCache.clear();
  }
}
