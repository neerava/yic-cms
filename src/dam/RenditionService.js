/**
 * RenditionService
 *
 * Generates and manages image renditions for assets in the YIC DAM.
 * Supports smart-crop via focal point, format conversion (AVIF/WebP/JPEG),
 * and responsive image sets. Delegates actual image processing to a
 * pluggable ImageProcessor adapter.
 */

const EventBus = require('../core/EventBus');

const DEFAULT_BREAKPOINTS = [320, 480, 640, 768, 1024, 1280, 1440, 1920];

const FORMAT_QUALITY = {
  avif: 60,
  webp: 82,
  jpeg: 85,
  png: 9,   // compression level 0-9
};

class RenditionJob {
  constructor(data) {
    this.id = `rend-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.assetId = data.assetId;
    this.assetPath = data.assetPath;
    this.width = data.width ?? null;
    this.height = data.height ?? null;
    this.format = data.format ?? 'webp';
    this.quality = data.quality ?? FORMAT_QUALITY[data.format ?? 'webp'];
    this.focalPoint = data.focalPoint ?? { x: 0.5, y: 0.5 };
    this.fit = data.fit ?? 'cover';   // cover | contain | fill | inside | outside
    this.status = 'pending';          // pending | processing | done | failed
    this.createdAt = new Date().toISOString();
    this.completedAt = null;
    this.result = null;
    this.error = null;
  }

  get name() {
    const dims = [this.width, this.height].filter(Boolean).join('x');
    return `${dims}_${this.format}_q${this.quality}`;
  }
}

class RenditionService {
  constructor() {
    this._processor = null;
    this._assetManager = null;
    this._concurrency = 4;
    this._queue = [];
    this._active = 0;
  }

  useProcessor(processor) {
    if (typeof processor.process !== 'function') {
      throw new TypeError('Image processor must implement process(job): Promise<{buffer, width, height, url}>');
    }
    this._processor = processor;
    return this;
  }

  useAssetManager(manager) {
    this._assetManager = manager;
    return this;
  }

  setConcurrency(n) { this._concurrency = n; return this; }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Generate a single rendition for an asset.
   * Returns a job handle immediately; processing is async.
   */
  enqueue(opts) {
    const job = new RenditionJob(opts);
    this._queue.push(job);
    this._drain();
    return job;
  }

  /**
   * Generate a full responsive set of renditions for an asset.
   * @param {object} asset   AssetModel instance
   * @param {number[]} [breakpoints]
   * @param {string[]} [formats]
   * @returns {RenditionJob[]}
   */
  generateResponsiveSet(asset, breakpoints = DEFAULT_BREAKPOINTS, formats = ['avif', 'webp']) {
    if (!asset.isImage) throw new Error(`Asset is not an image: ${asset.id}`);

    const jobs = [];
    for (const format of formats) {
      for (const width of breakpoints) {
        // Skip widths larger than the source image
        if (asset.dimensions?.width && width > asset.dimensions.width) continue;

        jobs.push(this.enqueue({
          assetId: asset.id,
          assetPath: asset.path,
          width,
          format,
          focalPoint: asset.focalPoint,
        }));
      }
    }

    return jobs;
  }

  /**
   * Generate an on-demand crop rendition at a specific aspect ratio.
   * @param {object} asset
   * @param {number} aspectRatio  e.g. 16/9
   * @param {number} width
   * @param {string} [format='webp']
   */
  generateCrop(asset, aspectRatio, width, format = 'webp') {
    const height = Math.round(width / aspectRatio);
    return this.enqueue({
      assetId: asset.id,
      assetPath: asset.path,
      width, height, format,
      focalPoint: asset.focalPoint,
      fit: 'cover',
    });
  }

  // ── Queue draining ────────────────────────────────────────────────────────────

  async _drain() {
    while (this._active < this._concurrency && this._queue.length) {
      const job = this._queue.shift();
      this._active++;
      this._processJob(job).finally(() => {
        this._active--;
        this._drain();
      });
    }
  }

  async _processJob(job) {
    if (!this._processor) { job.status = 'failed'; job.error = 'No image processor configured'; return; }

    job.status = 'processing';
    EventBus.emit('rendition:started', { job });

    try {
      const result = await this._processor.process(job);
      job.result = result;
      job.status = 'done';
      job.completedAt = new Date().toISOString();

      // Register rendition on the asset
      if (this._assetManager) {
        const asset = await this._assetManager._get?.(job.assetId).catch(() => null);
        if (asset) {
          asset.addRendition(job.name, {
            url: result.url,
            width: result.width,
            height: result.height,
            format: job.format,
            size: result.size ?? 0,
          });
        }
      }

      EventBus.emit('rendition:completed', { job });
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      job.completedAt = new Date().toISOString();
      EventBus.emit('rendition:failed', { job, error: err });
    }
  }

  get queueDepth() { return this._queue.length + this._active; }
  get activeCount() { return this._active; }
}

module.exports = new RenditionService();
