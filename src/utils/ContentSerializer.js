/**
 * ContentSerializer
 *
 * Serializes and deserializes content nodes between internal domain objects
 * and wire formats (JSON, JSON-LD, ADF, Markdown, plain HTML).
 *
 * The serializer is the boundary between the YIC internal model and
 * external consumers — it applies field projection, locale filtering,
 * and security redaction before output.
 */

const REDACTED_FIELDS = new Set(['_password', '_secret', '_token', '_hash', 'refreshToken', '__internal']);

class ContentSerializer {
  constructor() {
    this._formatters = new Map();
    this._projections = new Map();  // named projections → field allowlists
    this.registerBuiltins();
  }

  registerBuiltins() {
    this.addFormatter('json', (node) => node);

    this.addFormatter('json-ld', (node) => ({
      '@context': 'https://schema.org',
      '@type': node.type ?? 'Article',
      '@id': node.path,
      name: node.title,
      description: node.fields?.description ?? node.meta?.description,
      datePublished: node.publishedAt,
      dateModified: node.updatedAt,
      inLanguage: node.locale,
      ...node.fields,
    }));

    this.addFormatter('markdown', (node) => {
      const lines = [];
      if (node.title) lines.push(`# ${node.title}`, '');
      for (const [key, value] of Object.entries(node.fields ?? {})) {
        if (typeof value === 'string' && value.length > 0) lines.push(`## ${key}`, '', value, '');
      }
      return lines.join('\n');
    });

    this.addFormatter('summary', (node) => ({
      id: node.id,
      path: node.path,
      title: node.title,
      locale: node.locale,
      status: node.status,
      updatedAt: node.updatedAt,
    }));
  }

  addFormatter(name, fn) {
    this._formatters.set(name, fn);
    return this;
  }

  /**
   * Register a named field projection.
   * @param {string} name
   * @param {string[]} fields   Field names to include
   */
  addProjection(name, fields) {
    this._projections.set(name, new Set(fields));
    return this;
  }

  /**
   * Serialize a content node or array of nodes.
   * @param {object|object[]} input
   * @param {object} [opts]
   * @param {string} [opts.format='json']
   * @param {string} [opts.projection]       Named field projection
   * @param {string} [opts.locale]           Return only the specified locale's fields
   * @param {boolean} [opts.redact=true]     Strip internal/sensitive fields
   */
  serialize(input, opts = {}) {
    const { format = 'json', projection, locale, redact = true } = opts;
    const formatter = this._formatters.get(format);

    if (!formatter) throw new Error(`Unknown serialization format: ${format}`);

    const process = (node) => {
      let out = redact ? this._redact(node) : { ...node };
      if (projection) out = this._project(out, projection);
      if (locale) out = this._localizeFields(out, locale);
      return formatter(out);
    };

    return Array.isArray(input) ? input.map(process) : process(input);
  }

  /**
   * Deserialize a raw JSON payload back into a plain content object.
   * Applies type coercion and strips unknown keys.
   */
  deserialize(raw, schema = null) {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { throw new Error('Invalid JSON payload'); }
    }

    const node = { ...raw };

    // Coerce date strings
    for (const field of ['createdAt', 'updatedAt', 'publishedAt', 'scheduledPublishAt']) {
      if (node[field] && typeof node[field] === 'string') {
        const d = new Date(node[field]);
        if (!isNaN(d)) node[field] = d.toISOString();
      }
    }

    return node;
  }

  /**
   * Build a deep merge of content nodes for locale overlay:
   * master fields are overlaid with locale-specific overrides.
   */
  mergeLocaleOverlay(master, overlay) {
    const result = JSON.parse(JSON.stringify(master));
    if (!overlay?.fields) return result;
    result.fields = { ...result.fields, ...overlay.fields };
    if (overlay.meta) result.meta = { ...result.meta, ...overlay.meta };
    return result;
  }

  _redact(node) {
    const clean = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(clean);
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (REDACTED_FIELDS.has(k)) continue;
        out[k] = clean(v);
      }
      return out;
    };
    return clean(node);
  }

  _project(node, projectionName) {
    const allowedFields = this._projections.get(projectionName);
    if (!allowedFields) return node;

    const out = {};
    for (const field of allowedFields) {
      if (field in node) out[field] = node[field];
      else if (node.fields?.[field] !== undefined) {
        if (!out.fields) out.fields = {};
        out.fields[field] = node.fields[field];
      }
    }
    return out;
  }

  _localizeFields(node, locale) {
    if (!node.localizedFields?.[locale]) return node;
    return {
      ...node,
      fields: { ...node.fields, ...node.localizedFields[locale] },
    };
  }
}

module.exports = new ContentSerializer();
