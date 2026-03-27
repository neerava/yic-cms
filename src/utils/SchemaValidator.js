/**
 * SchemaValidator
 *
 * JSON Schema-compatible validator for content payloads in YIC CMS.
 * Supports a subset of JSON Schema draft-07 with custom YIC extensions
 * for content references, rich-text validation, and locale constraints.
 */

class ValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

class SchemaValidator {
  constructor() {
    this._schemas = new Map();
    this._customKeywords = new Map();
  }

  /**
   * Register a reusable schema by ID for use in $ref resolution.
   */
  addSchema(id, schema) {
    this._schemas.set(id, schema);
    return this;
  }

  /**
   * Register a custom validation keyword.
   * @param {string} keyword
   * @param {Function} validator  (value, schemaValue, ctx) => string|null (null = valid)
   */
  addKeyword(keyword, validator) {
    this._customKeywords.set(keyword, validator);
    return this;
  }

  /**
   * Validate a value against a schema.
   * @param {*} value
   * @param {object} schema
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(value, schema) {
    const errors = [];
    this._validate(value, schema, '#', errors);
    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate and throw if invalid.
   */
  assert(value, schema, context = '') {
    const result = this.validate(value, schema);
    if (!result.valid) {
      throw new ValidationError(
        `Validation failed${context ? ' for ' + context : ''}`,
        result.errors
      );
    }
  }

  _validate(value, schema, path, errors) {
    if (!schema || typeof schema !== 'object') return;

    // $ref resolution
    if (schema.$ref) {
      const refSchema = this._resolveRef(schema.$ref);
      if (refSchema) this._validate(value, refSchema, path, errors);
      return;
    }

    // Null check
    if (value === null || value === undefined) {
      if (schema.required || !schema.nullable) {
        if (schema.required) errors.push(`${path}: value is required`);
      }
      return;
    }

    // Type check
    if (schema.type) {
      const jsType = typeof value;
      const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
      const typeOk = expectedTypes.some(t => {
        if (t === 'array') return Array.isArray(value);
        if (t === 'null') return value === null;
        if (t === 'integer') return Number.isInteger(value);
        return jsType === t;
      });
      if (!typeOk) errors.push(`${path}: expected ${expectedTypes.join('|')}, got ${Array.isArray(value) ? 'array' : jsType}`);
    }

    // Enum
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path}: must be one of [${schema.enum.join(', ')}]`);
    }

    // String constraints
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength)
        errors.push(`${path}: minimum length is ${schema.minLength}`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        errors.push(`${path}: maximum length is ${schema.maxLength}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value))
        errors.push(`${path}: does not match pattern ${schema.pattern}`);
      if (schema.format) this._validateFormat(value, schema.format, path, errors);
    }

    // Number constraints
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum is ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum is ${schema.maximum}`);
      if (schema.multipleOf && value % schema.multipleOf !== 0) errors.push(`${path}: must be multiple of ${schema.multipleOf}`);
    }

    // Object constraints
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (schema.required) {
        for (const req of schema.required) {
          if (!(req in value)) errors.push(`${path}: missing required property "${req}"`);
        }
      }
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in value) this._validate(value[key], propSchema, `${path}.${key}`, errors);
        }
      }
      if (schema.additionalProperties === false) {
        const allowed = new Set(Object.keys(schema.properties ?? {}));
        for (const key of Object.keys(value)) {
          if (!allowed.has(key)) errors.push(`${path}: additional property not allowed: "${key}"`);
        }
      }
    }

    // Array constraints
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems)
        errors.push(`${path}: minimum ${schema.minItems} items required`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        errors.push(`${path}: maximum ${schema.maxItems} items allowed`);
      if (schema.items) {
        value.forEach((item, i) => this._validate(item, schema.items, `${path}[${i}]`, errors));
      }
      if (schema.uniqueItems && new Set(value.map(i => JSON.stringify(i))).size !== value.length) {
        errors.push(`${path}: items must be unique`);
      }
    }

    // Custom keywords
    for (const [keyword, validator] of this._customKeywords) {
      if (keyword in schema) {
        const err = validator(value, schema[keyword], { path, schema });
        if (err) errors.push(err);
      }
    }
  }

  _validateFormat(value, format, path, errors) {
    const checks = {
      'email': /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      'uri': /^https?:\/\/.+/,
      'date': /^\d{4}-\d{2}-\d{2}$/,
      'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      'uuid': /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'content-path': /^\/[a-zA-Z0-9/_-]+$/,
    };
    const regex = checks[format];
    if (regex && !regex.test(value)) errors.push(`${path}: invalid format "${format}"`);
  }

  _resolveRef(ref) {
    const id = ref.replace(/^#\//, '').replace(/\//g, '.');
    return this._schemas.get(id) ?? this._schemas.get(ref) ?? null;
  }
}

module.exports = { SchemaValidator: new SchemaValidator(), ValidationError };
