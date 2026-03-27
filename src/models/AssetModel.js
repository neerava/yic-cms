/**
 * AssetModel
 *
 * Domain model for digital assets managed by the YIC DAM subsystem.
 * Tracks renditions, focal points, usage references, expiry, and
 * rights/licensing metadata alongside the core binary descriptor.
 */

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml',
  'image/gif', 'video/mp4', 'video/webm', 'application/pdf',
  'font/woff2', 'font/woff', 'application/zip',
]);

class AssetModel {
  constructor(data = {}) {
    this.id = data.id ?? null;
    this.path = data.path;                 // DAM path, e.g. /content/dam/brand/hero.jpg
    this.filename = data.filename ?? '';
    this.mimeType = data.mimeType ?? 'application/octet-stream';
    this.size = data.size ?? 0;            // bytes
    this.checksum = data.checksum ?? null; // sha256 hex

    /** Pixel dimensions (images/videos) */
    this.dimensions = {
      width: data.dimensions?.width ?? null,
      height: data.dimensions?.height ?? null,
      duration: data.dimensions?.duration ?? null, // seconds, for video
    };

    /** Focal point for smart cropping (normalized 0–1 coords) */
    this.focalPoint = data.focalPoint ?? { x: 0.5, y: 0.5 };

    /** Generated renditions keyed by name, e.g. 'thumbnail', 'webp-1280' */
    this._renditions = new Map(Object.entries(data.renditions ?? {}));

    /** Rights and licensing */
    this.rights = {
      owner: data.rights?.owner ?? null,
      license: data.rights?.license ?? null,
      expiresAt: data.rights?.expiresAt ?? null,
      restrictions: data.rights?.restrictions ?? [],
    };

    /** AI-generated smart tags and alt text */
    this.smartTags = data.smartTags ?? [];
    this.altText = data.altText ?? '';
    this.caption = data.caption ?? '';

    /** Where this asset is used across the content graph */
    this.usageRefs = new Set(data.usageRefs ?? []);

    this.status = data.status ?? 'active'; // active | processing | expired | deleted
    this.createdAt = data.createdAt ?? new Date().toISOString();
    this.updatedAt = data.updatedAt ?? new Date().toISOString();
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  get isSupported() {
    return SUPPORTED_MIME_TYPES.has(this.mimeType);
  }

  get isExpired() {
    if (!this.rights.expiresAt) return false;
    return Date.now() > new Date(this.rights.expiresAt).getTime();
  }

  get isImage() {
    return this.mimeType.startsWith('image/');
  }

  get isVideo() {
    return this.mimeType.startsWith('video/');
  }

  get aspectRatio() {
    const { width, height } = this.dimensions;
    if (!width || !height) return null;
    return +(width / height).toFixed(4);
  }

  // ── Renditions ───────────────────────────────────────────────────────────────

  /**
   * @param {string} name
   * @param {object} descriptor  { url, width, height, format, size }
   */
  addRendition(name, descriptor) {
    this._renditions.set(name, { ...descriptor, generatedAt: new Date().toISOString() });
    this.updatedAt = new Date().toISOString();
    return this;
  }

  getRendition(name) {
    return this._renditions.get(name) ?? null;
  }

  /**
   * Best rendition for a given target width using fit-width strategy.
   * @param {number} targetWidth
   */
  getBestRendition(targetWidth) {
    const candidates = [...this._renditions.values()]
      .filter(r => r.width != null)
      .sort((a, b) => a.width - b.width);

    return candidates.find(r => r.width >= targetWidth) ?? candidates.at(-1) ?? null;
  }

  listRenditions() {
    return Object.fromEntries(this._renditions);
  }

  // ── Usage tracking ───────────────────────────────────────────────────────────

  addUsageRef(ref) { this.usageRefs.add(ref); return this; }
  removeUsageRef(ref) { this.usageRefs.delete(ref); return this; }
  get usageCount() { return this.usageRefs.size; }

  // ── Serialization ─────────────────────────────────────────────────────────────

  toJSON() {
    return {
      id: this.id,
      path: this.path,
      filename: this.filename,
      mimeType: this.mimeType,
      size: this.size,
      checksum: this.checksum,
      dimensions: this.dimensions,
      focalPoint: this.focalPoint,
      renditions: this.listRenditions(),
      rights: this.rights,
      smartTags: this.smartTags,
      altText: this.altText,
      caption: this.caption,
      usageRefs: [...this.usageRefs],
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = AssetModel;
