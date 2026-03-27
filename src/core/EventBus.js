/**
 * EventBus
 *
 * Lightweight pub/sub event backbone for decoupling CMS subsystems.
 * Supports synchronous and asynchronous listeners, wildcard subscriptions,
 * and a dead-letter queue for unhandled events.
 */

class EventBus {
  constructor() {
    this._listeners = new Map();
    this._wildcards = [];
    this._deadLetterQueue = [];
    this._maxDLQ = 100;
  }

  /**
   * Subscribe to a specific event or a glob pattern (e.g. 'content:*').
   * @param {string} event
   * @param {Function} handler
   * @param {object} [opts]
   * @param {boolean} [opts.once=false]
   * @returns {Function} Unsubscribe function
   */
  on(event, handler, opts = {}) {
    const isGlob = event.includes('*');

    if (isGlob) {
      const pattern = new RegExp('^' + event.replace(/\*/g, '.*') + '$');
      const entry = { pattern, handler, once: opts.once ?? false };
      this._wildcards.push(entry);
      return () => {
        const idx = this._wildcards.indexOf(entry);
        if (idx !== -1) this._wildcards.splice(idx, 1);
      };
    }

    if (!this._listeners.has(event)) this._listeners.set(event, []);
    const entry = { handler, once: opts.once ?? false };
    this._listeners.get(event).push(entry);

    return () => {
      const list = this._listeners.get(event);
      if (!list) return;
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /** Subscribe to an event exactly once. */
  once(event, handler) {
    return this.on(event, handler, { once: true });
  }

  /**
   * Emit an event synchronously. Returns true if at least one handler ran.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    let handled = false;

    const direct = this._listeners.get(event) ?? [];
    const toRemove = [];

    for (const entry of direct) {
      try {
        entry.handler(payload);
        handled = true;
      } catch (err) {
        this._onHandlerError(event, err);
      }
      if (entry.once) toRemove.push(entry);
    }

    for (const entry of toRemove) {
      const list = this._listeners.get(event);
      const idx = list?.indexOf(entry);
      if (idx !== undefined && idx !== -1) list.splice(idx, 1);
    }

    for (const entry of this._wildcards) {
      if (entry.pattern.test(event)) {
        try {
          entry.handler(payload);
          handled = true;
        } catch (err) {
          this._onHandlerError(event, err);
        }
      }
    }

    if (!handled) this._pushDLQ(event, payload);
    return handled;
  }

  /**
   * Emit an event and await all async handlers in parallel.
   */
  async emitAsync(event, payload) {
    const direct = this._listeners.get(event) ?? [];
    const wildcard = this._wildcards.filter(e => e.pattern.test(event));
    const all = [...direct, ...wildcard];

    await Promise.allSettled(all.map(e => Promise.resolve(e.handler(payload))));
  }

  _onHandlerError(event, err) {
    console.error(`[EventBus] Handler error on "${event}":`, err.message);
  }

  _pushDLQ(event, payload) {
    if (this._deadLetterQueue.length >= this._maxDLQ) this._deadLetterQueue.shift();
    this._deadLetterQueue.push({ event, payload, ts: Date.now() });
  }

  get deadLetterQueue() { return [...this._deadLetterQueue]; }
  listenerCount(event) { return (this._listeners.get(event) ?? []).length; }
  removeAll(event) {
    if (event) this._listeners.delete(event);
    else { this._listeners.clear(); this._wildcards.length = 0; }
  }
}

module.exports = new EventBus();
