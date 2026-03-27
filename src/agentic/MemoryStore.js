/**
 * MemoryStore
 *
 * Dual-tier memory for a single agent session.
 *
 * • Working memory  — key/value scratchpad for the current reasoning step.
 *   Wiped between runs.
 * • Episodic memory — timestamped log of past observations and decisions.
 *   Persists across steps; capped at maxEpisodes to avoid context bloat.
 * • Semantic memory — facts injected once at init (domain knowledge, user
 *   profile, project metadata).  Read-only during a run.
 */

class MemoryStore {
  constructor(opts = {}) {
    this.namespace   = opts.namespace ?? 'default';
    this.maxEpisodes = opts.maxEpisodes ?? 40;

    this._working  = new Map();   // key → value
    this._episodic = [];          // { key, value, ts }[]
    this._semantic = new Map();   // key → value  (read-only after init)
  }

  // ── Working memory ────────────────────────────────────────────────────────────

  write(key, value) {
    this._working.set(key, value);
    this._episodic.push({ key, value, ts: Date.now() });
    if (this._episodic.length > this.maxEpisodes) this._episodic.shift();
    return this;
  }

  read(key) {
    return this._working.get(key) ?? this._semantic.get(key) ?? null;
  }

  forget(key) {
    this._working.delete(key);
  }

  // ── Semantic memory ───────────────────────────────────────────────────────────

  /** Load static facts once (domain knowledge, CMS site context, etc.). */
  seed(facts = {}) {
    for (const [k, v] of Object.entries(facts)) this._semantic.set(k, v);
    return this;
  }

  // ── Bulk access ───────────────────────────────────────────────────────────────

  readAll() {
    return {
      working:  Object.fromEntries(this._working),
      semantic: Object.fromEntries(this._semantic),
      recent:   this._episodic.slice(-10),
    };
  }

  /**
   * Compress episodic memory for insertion into an LLM context window.
   * Returns a plain-text summary capped at ~maxTokens characters.
   */
  summarise(maxTokens = 800) {
    const lines = this._episodic
      .slice(-20)
      .map(e => `[${new Date(e.ts).toISOString()}] ${e.key}: ${JSON.stringify(e.value).slice(0, 120)}`);

    let out = '';
    for (const line of lines.reverse()) {
      if ((out + line).length > maxTokens) break;
      out = line + '\n' + out;
    }
    return out.trim();
  }

  clear(tier = 'working') {
    if (tier === 'working' || tier === 'all') this._working.clear();
    if (tier === 'episodic' || tier === 'all') this._episodic.length = 0;
  }

  get workingSize()  { return this._working.size; }
  get episodeCount() { return this._episodic.length; }
}

module.exports = MemoryStore;
