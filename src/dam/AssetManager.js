/**
 * AssetManager
 *
 * Orchestrates the Digital Asset Management subsystem of YIC CMS.
 * Handles asset ingestion, metadata extraction, rendition queuing,
 * usage tracking, and rights expiry enforcement.
 */

const EventBus = require('../core/EventBus');
const AssetModel = require('../models/AssetModel');

class AssetManager {
  constructor() {
    this._store = null;         // persistence adapter
    this._renditionQueue = [];  // pending rendition jobs
    this._metadataExtractors = new Map();  // mimeType → fn(buffer) => metadata
    this._storageAdapters = new Map();     // name → { upload, download, delete }
    this._defaultStorage = null;
  }

  useStore(store) { this._store = store; return this; }
  useStorage(name, adapter, isDefault = false) {
    this._storageAdapters.set(name, adapter);
    if (isDefault || !this._defaultStorage) this._defaultStorage = name;
    return this;
  }

  addMetadataExtractor(mimeType, fn) {
    this._metadataExtractors.set(mimeType, fn);
    return this;
  }

  // ── Ingestion ─────────────────────────────────────────────────────────────────

  /**
   * Ingest a new asset into the DAM.
   * @param {object} upload   { filename, mimeType, buffer, path, actor }
   * @returns {Promise<AssetModel>}
   */
  async ingest(upload) {
    if (!this._defaultStorage) throw new Error('No storage adapter configured');

    // Extract metadata if extractor registered
    const extractor = this._metadataExtractors.get(upload.mimeType);
    const extractedMeta = extractor ? await extractor(upload.buffer) : {};

    const asset = new AssetModel({
      filename: upload.filename,
      mimeType: upload.mimeType,
      size: upload.buffer?.length ?? 0,
      path: upload.path,
      checksum: this._checksum(upload.buffer),
      dimensions: extractedMeta.dimensions,
      altText: extractedMeta.altText ?? '',
      smartTags: extractedMeta.tags ?? [],
      status: 'processing',
    });

    // Upload to storage backend
    const adapter = this._storageAdapters.get(this._defaultStorage);
    const storageResult = await adapter.upload(upload.path, upload.buffer, {
      contentType: upload.mimeType,
      metadata: { assetId: asset.id },
    });
    asset.storageUrl = storageResult.url;
    asset.storageKey = storageResult.key;

    // Persist
    if (this._store) await this._store.save(asset);

    // Queue rendition generation
    this._enqueueRenditions(asset);

    asset.status = 'active';
    EventBus.emit('asset:ingested', { asset, actor: upload.actor });
    return asset;
  }

  /**
   * Move an asset to a new DAM path.
   */
  async move(id, newPath, actor) {
    const asset = await this._get(id);
    const oldPath = asset.path;
    asset.path = newPath;
    asset.updatedAt = new Date().toISOString();
    if (this._store) await this._store.save(asset);
    EventBus.emit('asset:moved', { asset, oldPath, actor });
    return asset;
  }

  /**
   * Soft-delete an asset. Refuses if the asset still has active usage references.
   */
  async delete(id, opts = { force: false }) {
    const asset = await this._get(id);

    if (asset.usageCount > 0 && !opts.force) {
      throw new Error(
        `Asset ${id} is still referenced by ${asset.usageCount} content items. Use force:true to override.`
      );
    }

    asset.status = 'deleted';
    asset.updatedAt = new Date().toISOString();
    if (this._store) await this._store.save(asset);
    EventBus.emit('asset:deleted', { asset });
    return asset;
  }

  /**
   * Update usage references when content is saved or deleted.
   * @param {string} assetId
   * @param {string} contentRef
   * @param {'add'|'remove'} op
   */
  async trackUsage(assetId, contentRef, op) {
    const asset = await this._get(assetId);
    if (op === 'add') asset.addUsageRef(contentRef);
    else asset.removeUsageRef(contentRef);
    if (this._store) await this._store.save(asset);
  }

  // ── Rights enforcement ─────────────────────────────────────────────────────────

  /**
   * Check for assets with expiring or expired rights and emit warnings.
   * Typically called by a scheduled job.
   */
  async auditRights(warningDaysAhead = 30) {
    if (!this._store) return;
    const now = Date.now();
    const warnThreshold = now + warningDaysAhead * 86_400_000;
    const assets = await this._store.query({ status: 'active' });

    const expiring = [];
    const expired = [];

    for (const asset of assets) {
      if (!asset.rights?.expiresAt) continue;
      const expiresAt = new Date(asset.rights.expiresAt).getTime();
      if (expiresAt < now) expired.push(asset);
      else if (expiresAt < warnThreshold) expiring.push(asset);
    }

    if (expired.length) EventBus.emit('asset:rights:expired', { assets: expired });
    if (expiring.length) EventBus.emit('asset:rights:expiring', { assets: expiring, daysAhead: warningDaysAhead });

    return { expired: expired.length, expiring: expiring.length };
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  async _get(id) {
    if (!this._store) throw new Error('No store configured');
    const asset = await this._store.get(id);
    if (!asset) throw Object.assign(new Error(`Asset not found: ${id}`), { status: 404 });
    return asset;
  }

  _enqueueRenditions(asset) {
    if (!asset.isImage) return;
    const sizes = [320, 640, 1024, 1440, 1920];
    for (const w of sizes) {
      this._renditionQueue.push({ assetId: asset.id, width: w, format: 'webp' });
      this._renditionQueue.push({ assetId: asset.id, width: w, format: 'avif' });
    }
    EventBus.emit('asset:renditions:queued', { assetId: asset.id, count: this._renditionQueue.length });
  }

  _checksum(buffer) {
    if (!buffer) return null;
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}

module.exports = new AssetManager();
