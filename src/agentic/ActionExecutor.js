/**
 * ActionExecutor
 *
 * Executes a batch of tool-call actions emitted by the LLM and
 * returns structured observations.  Handles parallelism, timeouts,
 * retries, and sandboxing constraints.
 */

const ToolRegistry = require('./ToolRegistry');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES    = 2;

class ActionExecutor {
  constructor(opts = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries   = opts.retries   ?? DEFAULT_RETRIES;
    this._hooks    = { before: [], after: [] };
  }

  before(fn) { this._hooks.before.push(fn); return this; }
  after(fn)  { this._hooks.after.push(fn);  return this; }

  /**
   * Execute all tool calls in the batch.
   * Independent calls run in parallel; the result order matches input order.
   *
   * @param {{ name, args, id }[]} calls
   * @param {object} context
   * @returns {Promise<Observation[]>}
   */
  async run(calls = [], context = {}) {
    return Promise.all(calls.map(call => this._execute(call, context)));
  }

  async _execute(call, context) {
    for (const fn of this._hooks.before) await fn(call, context);

    const obs = { callId: call.id, tool: call.name, ok: false, result: null, error: null };
    let attempt = 0;

    while (attempt++ <= this.retries) {
      try {
        obs.result = await this._withTimeout(
          ToolRegistry.call(call.name, call.args ?? {}, context),
          this.timeoutMs,
          call.name,
        );
        obs.ok = true;
        break;
      } catch (err) {
        obs.error = err.message;
        if (attempt > this.retries) break;
        await new Promise(r => setTimeout(r, 200 * attempt));  // back-off
      }
    }

    for (const fn of this._hooks.after) await fn(obs, context);
    return obs;
  }

  _withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Tool "${label}" timed out after ${ms}ms`)),
        ms,
      );
      promise.then(v => { clearTimeout(timer); resolve(v); },
                   e => { clearTimeout(timer); reject(e); });
    });
  }
}

module.exports = new ActionExecutor();
