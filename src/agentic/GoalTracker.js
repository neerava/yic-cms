/**
 * GoalTracker
 *
 * Tracks the lifecycle of an agent run's goals and sub-tasks.
 * Provides progress reporting and abort signalling.
 */

const EventBus = require('../core/EventBus');

const Status = Object.freeze({
  PENDING:  'pending',
  RUNNING:  'running',
  DONE:     'done',
  FAILED:   'failed',
  SKIPPED:  'skipped',
});

class GoalTracker {
  constructor() {
    this._goal    = null;
    this._tasks   = new Map();   // id → { id, description, status, startedAt, doneAt }
    this._aborted = false;
  }

  set(goal, tasks = []) {
    this._goal  = goal;
    this._tasks = new Map(tasks.map(t => [t.id, { ...t, status: Status.PENDING }]));
    this._aborted = false;
    return this;
  }

  markRunning(taskId) {
    this._update(taskId, { status: Status.RUNNING, startedAt: Date.now() });
  }

  markDone(taskId, result = null) {
    this._update(taskId, { status: Status.DONE, doneAt: Date.now(), result });
    EventBus.emit('agent:task:done', { taskId, progress: this.progress });
  }

  markFailed(taskId, error) {
    this._update(taskId, { status: Status.FAILED, error, doneAt: Date.now() });
  }

  skip(taskId, reason = '') {
    this._update(taskId, { status: Status.SKIPPED, reason });
  }

  abort(reason = '') {
    this._aborted = true;
    EventBus.emit('agent:aborted', { goal: this._goal, reason });
  }

  isAborted() { return this._aborted; }

  get progress() {
    const total = this._tasks.size;
    const done  = [...this._tasks.values()].filter(t => t.status === Status.DONE).length;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  get isComplete() {
    return [...this._tasks.values()].every(t =>
      t.status === Status.DONE || t.status === Status.SKIPPED,
    );
  }

  summary() {
    const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0 };
    for (const t of this._tasks.values()) counts[t.status]++;
    return { goal: this._goal, progress: this.progress, aborted: this._aborted, ...counts };
  }

  _update(id, patch) {
    const task = this._tasks.get(id);
    if (task) this._tasks.set(id, { ...task, ...patch });
  }
}

module.exports = GoalTracker;
