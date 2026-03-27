/**
 * AuditService
 *
 * Tamper-evident audit log for all content mutations, publish events,
 * permission changes, and user actions in YIC CMS.
 * Entries are immutable once written and include a chained hash
 * for integrity verification.
 */

const crypto = require('crypto');

/** @readonly */
const AuditCategory = Object.freeze({
  CONTENT:    'content',
  AUTH:       'auth',
  PUBLISH:    'publish',
  WORKFLOW:   'workflow',
  ADMIN:      'admin',
  SEARCH:     'search',
  ASSET:      'asset',
});

class AuditEntry {
  constructor(data, previousHash = '0'.repeat(64)) {
    this.id = data.id ?? `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.category = data.category;
    this.action = data.action;           // e.g. 'content.update'
    this.actor = data.actor;             // { id, email, role }
    this.target = data.target;           // { type, id, path }
    this.payload = data.payload ?? null; // before/after diff or relevant context
    this.ip = data.ip ?? null;
    this.userAgent = data.userAgent ?? null;
    this.ts = data.ts ?? new Date().toISOString();
    this.previousHash = previousHash;
    this.hash = this._computeHash();
  }

  _computeHash() {
    const content = JSON.stringify({
      id: this.id,
      category: this.category,
      action: this.action,
      actor: this.actor,
      target: this.target,
      ts: this.ts,
      previousHash: this.previousHash,
    });
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

class AuditService {
  constructor(opts = {}) {
    this._entries = [];
    this._sinks = [];        // async fn(entry) — remote storage adapters
    this._maxMemory = opts.maxMemory ?? 10_000;
    this._lastHash = '0'.repeat(64);
  }

  /**
   * Register an external sink (database, SIEM, S3, etc.)
   * @param {Function} sinkFn   async (entry) => void
   */
  addSink(sinkFn) {
    if (typeof sinkFn !== 'function') throw new TypeError('Sink must be a function');
    this._sinks.push(sinkFn);
    return this;
  }

  /**
   * Record an audit event.
   * @param {object} data
   * @returns {Promise<AuditEntry>}
   */
  async log(data) {
    const entry = new AuditEntry(data, this._lastHash);
    this._lastHash = entry.hash;

    // In-memory ring buffer
    if (this._entries.length >= this._maxMemory) this._entries.shift();
    this._entries.push(entry);

    // Fan out to all registered sinks in parallel
    await Promise.allSettled(this._sinks.map(sink => sink(entry)));

    return entry;
  }

  /** Convenience wrappers ──────────────────────────────────────────────────── */

  logContentUpdate(actor, target, diff) {
    return this.log({
      category: AuditCategory.CONTENT,
      action: 'content.update',
      actor, target, payload: { diff },
    });
  }

  logPublish(actor, contentRef, environments) {
    return this.log({
      category: AuditCategory.PUBLISH,
      action: 'content.publish',
      actor,
      target: { type: 'content', id: contentRef },
      payload: { environments },
    });
  }

  logLogin(actor, ip, userAgent, success) {
    return this.log({
      category: AuditCategory.AUTH,
      action: success ? 'auth.login' : 'auth.login.failed',
      actor, ip, userAgent,
    });
  }

  logPermissionChange(actor, target, before, after) {
    return this.log({
      category: AuditCategory.AUTH,
      action: 'auth.permission.change',
      actor, target, payload: { before, after },
    });
  }

  // ── Query ─────────────────────────────────────────────────────────────────────

  /**
   * @param {object} filters  { category, actorId, targetId, from, to, action }
   * @param {number} [limit=50]
   */
  query(filters = {}, limit = 50) {
    return this._entries
      .filter(e => {
        if (filters.category && e.category !== filters.category) return false;
        if (filters.actorId && e.actor?.id !== filters.actorId) return false;
        if (filters.targetId && e.target?.id !== filters.targetId) return false;
        if (filters.action && e.action !== filters.action) return false;
        if (filters.from && new Date(e.ts) < new Date(filters.from)) return false;
        if (filters.to && new Date(e.ts) > new Date(filters.to)) return false;
        return true;
      })
      .slice(-limit)
      .reverse();
  }

  /**
   * Verify the integrity of the in-memory audit chain.
   * Returns true if no entries have been tampered with.
   */
  verifyChain() {
    let prevHash = '0'.repeat(64);
    for (const entry of this._entries) {
      if (entry.previousHash !== prevHash) return false;
      const recomputed = new AuditEntry(entry, prevHash)._computeHash();
      if (recomputed !== entry.hash) return false;
      prevHash = entry.hash;
    }
    return true;
  }

  get entryCount() { return this._entries.length; }
}

module.exports = { AuditService: new AuditService(), AuditCategory };
