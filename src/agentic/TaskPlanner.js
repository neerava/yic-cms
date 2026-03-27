/**
 * TaskPlanner
 *
 * Decomposes a high-level goal into an ordered list of concrete sub-tasks,
 * each assigned to a specific agent role.  Optionally requests a dependency
 * graph so the orchestrator can parallelise independent branches.
 */

let _taskSeq = 0;
const mkId = () => `task-${++_taskSeq}`;

class Task {
  constructor(data) {
    this.id            = data.id ?? mkId();
    this.description   = data.description;
    this.assignedRole  = data.assignedRole ?? 'default';
    this.dependsOn     = data.dependsOn ?? [];   // task IDs that must finish first
    this.acceptanceCriteria = data.acceptanceCriteria ?? null;
    this.status        = 'pending';   // pending | running | done | failed | skipped
  }
}

class Plan {
  constructor(goal, tasks) {
    this.goal  = goal;
    this.tasks = tasks;
    this.createdAt = new Date().toISOString();
  }

  /** Topological sort — returns tasks in an executable order. */
  ordered() {
    const done    = new Set();
    const result  = [];
    const pending = [...this.tasks];

    let passes = 0;
    while (pending.length && passes++ < this.tasks.length * 2) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const t = pending[i];
        if (t.dependsOn.every(id => done.has(id))) {
          result.push(t);
          done.add(t.id);
          pending.splice(i, 1);
        }
      }
    }

    // Any remaining tasks have unresolvable dependencies; append as-is
    return [...result, ...pending];
  }
}

class TaskPlanner {
  constructor() {
    this._strategies = new Map();
    this._registerBuiltins();
  }

  /**
   * Decompose a goal into a Plan.
   * Uses an LLM strategy if registered, falls back to the heuristic strategy.
   *
   * @param {string} goal
   * @param {{ agents: string[], context: object }} opts
   * @returns {Promise<Plan>}
   */
  async decompose(goal, opts = {}) {
    const strategy = this._strategies.get('llm') ?? this._strategies.get('heuristic');
    const rawTasks = await strategy(goal, opts);
    const tasks    = rawTasks.map(t => new Task(t));
    return new Plan(goal, tasks);
  }

  /** Register a planning strategy: async (goal, opts) => Task[] */
  useStrategy(name, fn) {
    this._strategies.set(name, fn);
    return this;
  }

  _registerBuiltins() {
    // Heuristic: split by newline markers the LLM is expected to emit
    this._strategies.set('heuristic', async (goal, { agents = [] }) => {
      // PSEUDO: const lines = await llm.plan(goal, agents);
      // For now, produce a single catch-all task per registered agent role
      if (!agents.length) return [{ description: goal, assignedRole: 'default' }];
      return agents.map((role, i) => ({
        description:  `${role}: handle the "${role}" aspect of: ${goal}`,
        assignedRole: role,
        dependsOn:    i > 0 ? [`task-${_taskSeq - agents.length + i}`] : [],
      }));
    });
  }
}

module.exports = new TaskPlanner();
