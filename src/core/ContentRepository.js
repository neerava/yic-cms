/**
 * ContentRepository
 *
 * Central storage abstraction for all content nodes in the YIC content graph.
 * Provides CRUD operations with optimistic locking, conflict detection,
 * and automatic versioning on every mutation.
 */

const EventBus = require('./EventBus');
const VersionManager = require('../utils/VersionManager');
const { NotFoundError, ConflictError } = require('../utils/errors');

class ContentRepository {
  constructor(adapter, options = {}) {
    this._adapter = adapter;
    this._cache = new Map();
    this._locks = new Map();
    this._options = {
      ttl: options.ttl ?? 300_000,
      maxCacheSize: options.maxCacheSize ?? 5_000,
      autoVersion: options.autoVersion ?? true,
    };
  }

  /**
   * Retrieve a content node by path or UUID.
   * @param {string} id - Content path or UUID
   * @param {object} [opts]
   * @param {boolean} [opts.bypassCache=false]
   * @param {string}  [opts.locale]
   * @returns {Promise<ContentNode>}
   */
  async get(id, opts = {}) {
    const cacheKey = opts.locale ? `${id}::${opts.locale}` : id;

    if (!opts.bypassCache && this._cache.has(cacheKey)) {
      const entry = this._cache.get(cacheKey);
      if (Date.now() - entry.ts < this._options.ttl) return entry.value;
    }

    const node = await this._adapter.findOne(id, opts);
    if (!node) throw new NotFoundError(`Content node not found: ${id}`);

    this._setCache(cacheKey, node);
    return node;
  }

  /**
   * Persist a new or updated content node.
   * Triggers versioning and fires lifecycle events on the EventBus.
   */
  async save(node, opts = {}) {
    const lockKey = node.id ?? node.path;
    if (this._locks.has(lockKey)) throw new ConflictError(`Node is locked: ${lockKey}`);

    this._locks.set(lockKey, true);
    try {
      if (this._options.autoVersion && node.id) {
        await VersionManager.snapshot(node);
      }

      const saved = await this._adapter.upsert(node);
      this._invalidateCache(lockKey);
      EventBus.emit('content:saved', { node: saved, actor: opts.actor });
      return saved;
    } finally {
      this._locks.delete(lockKey);
    }
  }

  /**
   * Remove a content node. Soft-deletes by default.
   */
  async delete(id, opts = { soft: true }) {
    const node = await this.get(id, { bypassCache: true });
    if (opts.soft) {
      node.status = 'deleted';
      node.deletedAt = new Date().toISOString();
      return this.save(node, opts);
    }

    await this._adapter.remove(id);
    this._invalidateCache(id);
    EventBus.emit('content:deleted', { id, actor: opts.actor });
  }

  /**
   * Execute a structured query against the content store.
   * @param {ContentQuery} query
   * @returns {Promise<ContentNode[]>}
   */
  async query(query) {
    return this._adapter.find(query);
  }

  // ── Cache helpers ────────────────────────────────────────────────────────────

  _setCache(key, value) {
    if (this._cache.size >= this._options.maxCacheSize) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, { value, ts: Date.now() });
  }

  _invalidateCache(keyPrefix) {
    for (const key of this._cache.keys()) {
      if (key === keyPrefix || key.startsWith(`${keyPrefix}::`)) {
        this._cache.delete(key);
      }
    }
  }

  get cacheSize() { return this._cache.size; }
  flushCache() { this._cache.clear(); }
}

module.exports = ContentRepository;
