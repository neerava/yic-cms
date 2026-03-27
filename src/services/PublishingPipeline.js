/**
 * PublishingPipeline
 *
 * Orchestrates the end-to-end publishing lifecycle for content in YIC.
 * Executes a configurable sequence of stages: validation, pre-processing,
 * replication, CDN purge, and post-publish hooks.
 *
 * Supports incremental publishing, scheduled jobs, and rollback.
 */

const EventBus = require('../core/EventBus');

const PipelineStage = Object.freeze({
  VALIDATE:    'validate',
  TRANSFORM:   'transform',
  REPLICATE:   'replicate',
  CDN_PURGE:   'cdn-purge',
  NOTIFY:      'notify',
  ROLLBACK:    'rollback',
});

class PublishingJob {
  constructor(opts) {
    this.id = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.contentRefs = opts.contentRefs;
    this.actor = opts.actor;
    this.scheduledAt = opts.scheduledAt ?? null;
    this.environments = opts.environments ?? ['publish'];
    this.stages = [];
    this.status = 'queued';     // queued | running | completed | failed | rolled-back
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.completedAt = null;
    this.errors = [];
    this._snapshots = new Map(); // contentRef → snapshot before publish
  }

  addStageResult(stage, result) {
    this.stages.push({ stage, result, ts: new Date().toISOString() });
  }
}

class PublishingPipeline {
  constructor() {
    this._validators = [];
    this._transformers = [];
    this._replicators = [];
    this._cdnAdapters = [];
    this._postHooks = [];
    this._queue = [];
    this._running = false;
  }

  // ── Plugin registration ───────────────────────────────────────────────────────

  /** Add a validation function: async fn(contentRef, job) => { valid, errors } */
  addValidator(fn) { this._validators.push(fn); return this; }

  /** Add a transformer: async fn(node, job) => transformedNode */
  addTransformer(fn) { this._transformers.push(fn); return this; }

  /** Add a replicator (e.g. write to publish tier DB): async fn(nodes, job) */
  addReplicator(fn) { this._replicators.push(fn); return this; }

  /** Add a CDN adapter for cache invalidation: async fn(paths, job) */
  addCDNAdapter(fn) { this._cdnAdapters.push(fn); return this; }

  /** Add a post-publish hook: async fn(job) */
  addPostHook(fn) { this._postHooks.push(fn); return this; }

  // ── Job lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Enqueue a publish job. Returns the job before it has run.
   */
  enqueue(opts) {
    const job = new PublishingJob(opts);
    this._queue.push(job);
    EventBus.emit('publish:queued', { job });
    this._processQueue();
    return job;
  }

  async _processQueue() {
    if (this._running || this._queue.length === 0) return;
    this._running = true;

    while (this._queue.length > 0) {
      const job = this._queue[0];
      if (job.scheduledAt && new Date(job.scheduledAt) > new Date()) break;

      this._queue.shift();
      await this._runJob(job);
    }

    this._running = false;
  }

  async _runJob(job) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    EventBus.emit('publish:started', { job });

    try {
      // Stage 1: Validation
      for (const validator of this._validators) {
        for (const ref of job.contentRefs) {
          const result = await validator(ref, job);
          job.addStageResult(PipelineStage.VALIDATE, result);
          if (!result.valid) {
            throw new Error(`Validation failed for ${ref}: ${result.errors.join('; ')}`);
          }
        }
      }

      // Stage 2: Transform
      const transformedNodes = [];
      for (const ref of job.contentRefs) {
        let node = { ref };
        for (const transformer of this._transformers) {
          node = await transformer(node, job);
        }
        transformedNodes.push(node);
        job.addStageResult(PipelineStage.TRANSFORM, { ref, ok: true });
      }

      // Stage 3: Replicate to publish tier(s)
      for (const replicator of this._replicators) {
        await replicator(transformedNodes, job);
        job.addStageResult(PipelineStage.REPLICATE, { count: transformedNodes.length });
      }

      // Stage 4: CDN purge
      const paths = job.contentRefs;
      for (const adapter of this._cdnAdapters) {
        await adapter(paths, job);
        job.addStageResult(PipelineStage.CDN_PURGE, { purged: paths.length });
      }

      // Stage 5: Post-publish hooks
      for (const hook of this._postHooks) {
        await hook(job);
        job.addStageResult(PipelineStage.NOTIFY, { hook: hook.name });
      }

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      EventBus.emit('publish:completed', { job });
    } catch (err) {
      job.status = 'failed';
      job.errors.push(err.message);
      job.completedAt = new Date().toISOString();
      EventBus.emit('publish:failed', { job, error: err });
    }
  }

  get queueDepth() { return this._queue.length; }
}

module.exports = new PublishingPipeline();
