/**
 * CacheService
 *
 * Multi-tier caching layer for YIC CMS delivery.
 * Tier 1: in-process LRU (microsecond latency)
 * Tier 2: shared distributed cache (Redis adapter)
 * Tier 3: CDN edge cache (via surrogate key purging)
 *
 * Supports tag-based invalidation so that entire subtrees
 * (e.g. all pages referencing a fragment) can be purged atomically.
 */

class LRUCache {
  constructor(maxSize = 1000) {
    this._maxSize = maxSize;
    this._map = new Map();  // Map preserves insertion order in V8
  }

  get(key) {
    if (!this._map.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this._map.get(key);
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this._map.has(key)) this._map.delete(key);
    else if (this._map.size >= this._maxSize) {
      // Evict LRU (first inserted = least recently used)
      this._map.delete(this._map.keys().next().value);
    }
    this._map.set(key, value);
  }

  delete(key) { return this._map.delete(key); }
  has(key) { return this._map.has(key); }
  clear() { this._map.clear(); }
  get size() { return this._map.size; }

  keys() { return [...this._map.keys()]; }
}

class CacheService {
  constructor(opts = {}) {
    this._l1 = new LRUCache(opts.l1Size ?? 2_000);
    this._l2 = null;       // set via useDistributedCache()
    this._cdnAdapter = null;
    this._defaultTTL = opts.defaultTTL ?? 300;  // seconds
    this._tagIndex = new Map(); // tag → Set<cacheKey>
  }

  /** Connect a distributed cache adapter (must implement get/set/del/flush). */
  useDistributedCache(adapter) { this._l2 = adapter; return this; }

  /** Connect a CDN adapter for edge purging. */
  useCDNAdapter(adapter) { this._cdnAdapter = adapter; return this; }

  /**
   * Retrieve a value from the cache, checking tiers in order.
   * @param {string} key
   * @returns {Promise<*>}
   */
  async get(key) {
    // Tier 1
    const l1 = this._l1.get(key);
    if (l1 !== undefined) {
      if (!this._isExpired(l1)) return l1.value;
      this._l1.delete(key);
    }

    // Tier 2
    if (this._l2) {
      const l2 = await this._l2.get(key);
      if (l2 !== undefined) {
        this._l1.set(key, this._wrap(l2.value, l2.expiresAt));
        return l2.value;
      }
    }

    return undefined;
  }

  /**
   * Store a value in all configured cache tiers.
   * @param {string} key
   * @param {*} value
   * @param {object} [opts]
   * @param {number} [opts.ttl]       Seconds; uses default if omitted
   * @param {string[]} [opts.tags]    Surrogate tags for group invalidation
   */
  async set(key, value, opts = {}) {
    const ttl = opts.ttl ?? this._defaultTTL;
    const expiresAt = Date.now() + ttl * 1_000;
    const entry = this._wrap(value, expiresAt);

    this._l1.set(key, entry);

    if (this._l2) await this._l2.set(key, { value, expiresAt }, ttl);

    if (opts.tags) {
      for (const tag of opts.tags) {
        if (!this._tagIndex.has(tag)) this._tagIndex.set(tag, new Set());
        this._tagIndex.get(tag).add(key);
      }
    }
  }

  /**
   * Invalidate a specific cache key across all tiers.
   */
  async invalidate(key) {
    this._l1.delete(key);
    if (this._l2) await this._l2.del(key);
  }

  /**
   * Invalidate all cache entries associated with a tag.
   * This is the primary mechanism for cascade invalidation
   * when a fragment or asset changes.
   * @param {string} tag
   */
  async invalidateByTag(tag) {
    const keys = this._tagIndex.get(tag);
    if (!keys) return;

    const purgePromises = [...keys].map(k => this.invalidate(k));
    await Promise.all(purgePromises);

    // CDN edge purge
    if (this._cdnAdapter) {
      await this._cdnAdapter.purgeByTag(tag);
    }

    this._tagIndex.delete(tag);
  }

  /**
   * Wrap-through helper: attempt cache get, call loader on miss, populate cache.
   */
  async getOrSet(key, loader, opts = {}) {
    const cached = await this.get(key);
    if (cached !== undefined) return cached;

    const value = await loader();
    await this.set(key, value, opts);
    return value;
  }

  async flush() {
    this._l1.clear();
    this._tagIndex.clear();
    if (this._l2) await this._l2.flush();
  }

  _wrap(value, expiresAt) { return { value, expiresAt }; }
  _isExpired(entry) { return entry.expiresAt != null && Date.now() > entry.expiresAt; }

  stats() {
    return { l1Size: this._l1.size, tagCount: this._tagIndex.size };
  }
}

module.exports = new CacheService();
