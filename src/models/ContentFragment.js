/**
 * ContentFragment
 *
 * Atomic unit of structured content in YIC. A fragment is a strongly-typed,
 * schema-bound content object — analogous to a row in a typed database — that
 * can be referenced across any number of pages, channels, and contexts.
 *
 * Fragments support multi-locale variations, rich-text fields, nested fragment
 * references, and automatic diff-based versioning.
 */

const { v4: uuid } = require('crypto');

class ContentFragment {
  /**
   * @param {object} data
   * @param {string} [data.id]
   * @param {string} data.modelPath      - Path to the CF model (schema)
   * @param {string} data.title
   * @param {object} data.fields         - Key-value map of field values
   * @param {string} [data.locale='en']
   * @param {string} [data.status='draft']
   */
  constructor(data = {}) {
    this.id = data.id ?? `cf-${uuid().slice(0, 8)}`;
    this.modelPath = data.modelPath;
    this.title = data.title ?? 'Untitled Fragment';
    this.fields = { ...(data.fields ?? {}) };
    this.locale = data.locale ?? 'en';
    this.status = data.status ?? 'draft'; // draft | review | approved | published | archived
    this.tags = data.tags ?? [];
    this.createdAt = data.createdAt ?? new Date().toISOString();
    this.updatedAt = data.updatedAt ?? new Date().toISOString();
    this.publishedAt = data.publishedAt ?? null;
    this.version = data.version ?? 1;
    this._variations = new Map();
  }

  // ── Field access ─────────────────────────────────────────────────────────────

  getField(name, fallback = null) {
    return this.fields[name] !== undefined ? this.fields[name] : fallback;
  }

  setField(name, value) {
    this.fields[name] = value;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  setFields(patch) {
    Object.assign(this.fields, patch);
    this.updatedAt = new Date().toISOString();
    return this;
  }

  // ── Variations ───────────────────────────────────────────────────────────────

  /**
   * Add or update a named variation (e.g. for A/B testing or channel-specific copy).
   * @param {string} name
   * @param {object} fieldOverrides
   */
  setVariation(name, fieldOverrides) {
    this._variations.set(name, {
      name,
      fields: { ...this.fields, ...fieldOverrides },
      createdAt: new Date().toISOString(),
    });
    return this;
  }

  getVariation(name) {
    if (!this._variations.has(name)) {
      throw new Error(`Variation "${name}" does not exist on fragment ${this.id}`);
    }
    return this._variations.get(name);
  }

  listVariations() {
    return [...this._variations.keys()];
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  publish(actor) {
    if (this.status !== 'approved') {
      throw new Error(`Fragment must be in "approved" status before publishing (current: ${this.status})`);
    }
    this.status = 'published';
    this.publishedAt = new Date().toISOString();
    this.updatedAt = this.publishedAt;
    this._lastPublishedBy = actor;
    return this;
  }

  unpublish() {
    this.status = 'archived';
    this.publishedAt = null;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  approve(actor) {
    if (!['draft', 'review'].includes(this.status)) {
      throw new Error(`Cannot approve fragment in status: ${this.status}`);
    }
    this.status = 'approved';
    this._approvedBy = actor;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  // ── Serialization ────────────────────────────────────────────────────────────

  toJSON() {
    return {
      id: this.id,
      modelPath: this.modelPath,
      title: this.title,
      fields: this.fields,
      locale: this.locale,
      status: this.status,
      tags: this.tags,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      publishedAt: this.publishedAt,
      variations: Object.fromEntries(this._variations),
    };
  }

  static fromJSON(data) {
    const frag = new ContentFragment(data);
    if (data.variations) {
      for (const [name, variation] of Object.entries(data.variations)) {
        frag._variations.set(name, variation);
      }
    }
    return frag;
  }
}

module.exports = ContentFragment;
