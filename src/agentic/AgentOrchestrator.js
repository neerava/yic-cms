/**
 * AgentOrchestrator
 *
 * Spins up, routes, and supervises specialised sub-agents for a given goal.
 * Agents collaborate through a shared MessageBus; the orchestrator
 * arbitrates conflicts and decides when the goal is satisfied.
 */

const ReasoningLoop  = require('./ReasoningLoop');
const TaskPlanner    = require('./TaskPlanner');
const MemoryStore    = require('./MemoryStore');
const GoalTracker    = require('./GoalTracker');
const EventBus       = require('../core/EventBus');

class AgentOrchestrator {
  constructor(opts = {}) {
    this.id       = `orch-${Date.now()}`;
    this.maxSteps = opts.maxSteps ?? 20;
    this.agents   = new Map();   // agentId → { loop, role }
    this.memory   = new MemoryStore({ namespace: this.id });
    this.goals    = new GoalTracker();
  }

  /** Register a specialised agent role (e.g. 'author', 'seo', 'reviewer'). */
  register(role, agentDef) {
    const loop = new ReasoningLoop({ role, tools: agentDef.tools ?? [] });
    this.agents.set(role, { loop, role, ...agentDef });
    return this;
  }

  /**
   * Run a multi-agent pipeline for a high-level goal string.
   * Returns the final aggregated result.
   */
  async run(goal, context = {}) {
    EventBus.emit('agent:orchestration:start', { goal, orchestratorId: this.id });

    // 1. Plan — decompose the goal into ordered sub-tasks
    const plan = await TaskPlanner.decompose(goal, {
      agents: [...this.agents.keys()],
      context,
    });

    this.goals.set(goal, plan.tasks);
    this.memory.write('plan', plan);

    let accumulated = { ...context };

    // 2. Execute each task, routing to the appropriate agent
    for (const task of plan.tasks) {
      if (this.goals.isAborted()) break;

      const agent = this.agents.get(task.assignedRole) ?? this.agents.get('default');
      if (!agent) throw new Error(`No agent registered for role: ${task.assignedRole}`);

      EventBus.emit('agent:task:start', { task, role: task.assignedRole });

      const result = await agent.loop.step({
        task:    task.description,
        memory:  this.memory.readAll(),
        context: accumulated,
      });

      accumulated = { ...accumulated, ...result.output };
      this.memory.write(`task:${task.id}`, result);
      this.goals.markDone(task.id);

      EventBus.emit('agent:task:done', { task, result });

      if (result.shouldStop) break;
    }

    const summary = await this._summarise(accumulated, goal);
    EventBus.emit('agent:orchestration:done', { goal, summary });
    return summary;
  }

  async _summarise(accumulated, goal) {
    // Ask the default agent to write a short summary of what was accomplished
    const agent = this.agents.get('default') ?? [...this.agents.values()][0];
    if (!agent) return accumulated;
    return agent.loop.step({
      task:    `Summarise what was done to achieve: "${goal}"`,
      context: accumulated,
      memory:  this.memory.readAll(),
    });
  }
}

module.exports = AgentOrchestrator;
