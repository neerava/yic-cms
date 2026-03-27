/**
 * WorkflowEngine
 *
 * Drives the content lifecycle automation in YIC CMS. Workflows are
 * defined as directed graphs of Steps, with conditional branching,
 * parallel execution tracks, SLA timers, and escalation paths.
 *
 * Typical workflow: Draft → Review → Legal Check → Approval → Publish
 */

const EventBus = require('../core/EventBus');

const StepStatus = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  ESCALATED: 'escalated',
});

class WorkflowStep {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.type = def.type ?? 'manual';      // manual | automated | approval | notification
    this.assignees = def.assignees ?? [];  // user IDs or role names
    this.slaHours = def.slaHours ?? null;
    this.onComplete = def.onComplete ?? null; // next step ID or conditional { if, then, else }
    this.onEscalate = def.onEscalate ?? null;
    this.automated = def.automated ?? null;   // async fn(context) => void, for 'automated' type
    this.status = StepStatus.PENDING;
    this.startedAt = null;
    this.completedAt = null;
    this.comments = [];
  }

  start() {
    this.status = StepStatus.ACTIVE;
    this.startedAt = new Date().toISOString();
  }

  complete(outcome = 'approved', actor = null) {
    this.status = StepStatus.COMPLETED;
    this.completedAt = new Date().toISOString();
    this.outcome = outcome;
    this.completedBy = actor;
  }

  isSlaBreached() {
    if (!this.slaHours || !this.startedAt) return false;
    const elapsed = (Date.now() - new Date(this.startedAt).getTime()) / 3_600_000;
    return elapsed > this.slaHours;
  }
}

class WorkflowInstance {
  constructor(definition, context) {
    this.id = `wf-${Date.now()}`;
    this.definitionId = definition.id;
    this.contentRef = context.contentRef;
    this.actor = context.actor;
    this.steps = definition.steps.map(s => new WorkflowStep(s));
    this._stepMap = new Map(this.steps.map(s => [s.id, s]));
    this.currentStepId = definition.steps[0]?.id ?? null;
    this.status = 'running'; // running | completed | aborted
    this.startedAt = new Date().toISOString();
    this.completedAt = null;
    this.history = [];
  }

  get currentStep() {
    return this._stepMap.get(this.currentStepId) ?? null;
  }

  _recordHistory(event) {
    this.history.push({ ...event, ts: new Date().toISOString() });
  }
}

class WorkflowEngine {
  constructor() {
    this._definitions = new Map();
    this._instances = new Map();
    this._timers = new Map();
  }

  /** Register a workflow definition. */
  define(definition) {
    if (!definition.id || !Array.isArray(definition.steps)) {
      throw new Error('Workflow definition requires id and steps[]');
    }
    this._definitions.set(definition.id, definition);
    return this;
  }

  /**
   * Start a new workflow instance for a piece of content.
   * @param {string} definitionId
   * @param {object} context  { contentRef, actor, payload }
   * @returns {WorkflowInstance}
   */
  async start(definitionId, context) {
    const def = this._definitions.get(definitionId);
    if (!def) throw new Error(`Workflow definition not found: ${definitionId}`);

    const instance = new WorkflowInstance(def, context);
    this._instances.set(instance.id, instance);

    EventBus.emit('workflow:started', { instance });
    await this._activateStep(instance, instance.currentStepId);

    return instance;
  }

  /**
   * Advance a workflow step with a given outcome.
   * @param {string} instanceId
   * @param {string} outcome   e.g. 'approved', 'rejected', 'revision-requested'
   * @param {object} [opts]    { actor, comment }
   */
  async advance(instanceId, outcome, opts = {}) {
    const instance = this._instances.get(instanceId);
    if (!instance) throw new Error(`Workflow instance not found: ${instanceId}`);

    const step = instance.currentStep;
    if (!step || step.status !== StepStatus.ACTIVE) {
      throw new Error(`Step is not active: ${step?.id}`);
    }

    if (opts.comment) step.comments.push({ actor: opts.actor, text: opts.comment, ts: new Date().toISOString() });
    step.complete(outcome, opts.actor);
    instance._recordHistory({ stepId: step.id, outcome, actor: opts.actor });

    EventBus.emit('workflow:step:completed', { instance, step, outcome });

    const nextStepId = this._resolveNextStep(step, outcome);
    if (!nextStepId) return this._complete(instance);

    instance.currentStepId = nextStepId;
    await this._activateStep(instance, nextStepId);
  }

  async _activateStep(instance, stepId) {
    const step = instance._stepMap.get(stepId);
    if (!step) return this._complete(instance);

    step.start();
    EventBus.emit('workflow:step:started', { instance, step });

    // Register SLA timer
    if (step.slaHours) {
      const timer = setTimeout(() => this._escalate(instance, step), step.slaHours * 3_600_000);
      this._timers.set(`${instance.id}:${step.id}`, timer);
    }

    // Auto-execute automated steps
    if (step.type === 'automated' && typeof step.automated === 'function') {
      try {
        await step.automated({ instance, step });
        await this.advance(instance.id, 'completed', { actor: 'system' });
      } catch (err) {
        step.status = StepStatus.FAILED;
        EventBus.emit('workflow:step:failed', { instance, step, error: err });
      }
    }
  }

  _escalate(instance, step) {
    step.status = StepStatus.ESCALATED;
    EventBus.emit('workflow:step:escalated', { instance, step });

    if (step.onEscalate) {
      instance.currentStepId = step.onEscalate;
      this._activateStep(instance, step.onEscalate);
    }
  }

  _resolveNextStep(step, outcome) {
    if (!step.onComplete) return null;
    if (typeof step.onComplete === 'string') return step.onComplete;
    // Conditional: { if: 'approved', then: 'publish', else: 'revision' }
    const cond = step.onComplete;
    return outcome === cond.if ? cond.then : cond.else;
  }

  _complete(instance) {
    instance.status = 'completed';
    instance.completedAt = new Date().toISOString();
    EventBus.emit('workflow:completed', { instance });
  }

  getInstance(id) { return this._instances.get(id) ?? null; }
  listInstances(contentRef) {
    return [...this._instances.values()].filter(i => i.contentRef === contentRef);
  }
}

module.exports = new WorkflowEngine();
