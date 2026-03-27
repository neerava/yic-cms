/**
 * ContentModel (Fragment Model / Schema)
 *
 * Defines the field schema for a class of ContentFragments.
 * Analogous to a database table schema or a GraphQL type definition —
 * every ContentFragment references a ContentModel for runtime validation.
 */

const FIELD_TYPES = new Set([
  'text', 'multiline-text', 'rich-text',
  'number', 'boolean', 'date', 'date-time',
  'reference', 'reference-array',
  'enumeration', 'tags',
  'json', 'content-reference', 'asset-reference',
]);

class ContentModelField {
  constructor(def) {
    if (!def.name) throw new Error('Field must have a name');
    if (!FIELD_TYPES.has(def.type)) throw new Error(`Unknown field type: ${def.type}`);

    this.name = def.name;
    this.type = def.type;
    this.label = def.label ?? def.name;
    this.required = def.required ?? false;
    this.multiple = def.multiple ?? false;
    this.defaultValue = def.defaultValue ?? null;
    this.validation = def.validation ?? null;  // { min, max, pattern, enum: [...] }
    this.translatable = def.translatable ?? true;
    this.metadata = def.metadata ?? {};
  }

  validate(value) {
    if (this.required && (value === null || value === undefined || value === '')) {
      return `Field "${this.name}" is required`;
    }

    if (value === null || value === undefined) return null;

    if (this.type === 'number' && typeof value !== 'number') return `"${this.name}" must be a number`;
    if (this.type === 'boolean' && typeof value !== 'boolean') return `"${this.name}" must be a boolean`;

    if (this.validation) {
      const v = this.validation;
      if (v.min !== undefined && value < v.min) return `"${this.name}" must be >= ${v.min}`;
      if (v.max !== undefined && value > v.max) return `"${this.name}" must be <= ${v.max}`;
      if (v.pattern && !new RegExp(v.pattern).test(value)) return `"${this.name}" does not match required pattern`;
      if (v.enum && !v.enum.includes(value)) return `"${this.name}" must be one of: ${v.enum.join(', ')}`;
      if (v.minLength && String(value).length < v.minLength) return `"${this.name}" must be at least ${v.minLength} characters`;
      if (v.maxLength && String(value).length > v.maxLength) return `"${this.name}" must be at most ${v.maxLength} characters`;
    }

    return null;
  }
}

class ContentModel {
  constructor(data = {}) {
    this.id = data.id ?? null;
    this.path = data.path;                    // e.g. /content/dam/cfm/models/article
    this.name = data.name;
    this.description = data.description ?? '';
    this.icon = data.icon ?? 'content-fragment';
    this.fields = (data.fields ?? []).map(f => new ContentModelField(f));
    this.createdAt = data.createdAt ?? new Date().toISOString();
    this.updatedAt = data.updatedAt ?? new Date().toISOString();
  }

  getField(name) {
    return this.fields.find(f => f.name === name) ?? null;
  }

  addField(def) {
    if (this.fields.some(f => f.name === def.name)) {
      throw new Error(`Field "${def.name}" already exists in model "${this.name}"`);
    }
    this.fields.push(new ContentModelField(def));
    this.updatedAt = new Date().toISOString();
    return this;
  }

  removeField(name) {
    const idx = this.fields.findIndex(f => f.name === name);
    if (idx === -1) return false;
    this.fields.splice(idx, 1);
    this.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Validate a fields object against this model's schema.
   * @param {object} fields
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(fields = {}) {
    const errors = [];
    for (const field of this.fields) {
      const error = field.validate(fields[field.name] ?? null);
      if (error) errors.push(error);
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Return field defaults as a plain object (useful for initializing new fragments).
   */
  defaults() {
    return Object.fromEntries(
      this.fields
        .filter(f => f.defaultValue !== null)
        .map(f => [f.name, f.defaultValue])
    );
  }

  toJSON() {
    return {
      id: this.id,
      path: this.path,
      name: this.name,
      description: this.description,
      fields: this.fields,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = { ContentModel, ContentModelField, FIELD_TYPES };
