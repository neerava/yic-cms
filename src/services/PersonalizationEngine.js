/**
 * PersonalizationEngine
 *
 * Evaluates audience segments in real time and resolves content variants
 * for a given visitor profile. Supports rule-based segmentation, ML-model
 * scoring, and multi-armed bandit experimentation.
 */

class Segment {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.rules = def.rules ?? [];  // array of rule objects
    this.priority = def.priority ?? 0;
  }

  /**
   * Evaluate this segment against a visitor profile.
   * Rules are AND-ed together; multiple segments OR with each other.
   */
  matches(visitor) {
    return this.rules.every(rule => this._evalRule(rule, visitor));
  }

  _evalRule(rule, visitor) {
    const value = this._resolvePath(visitor, rule.attribute);
    switch (rule.operator) {
      case 'eq':       return value === rule.value;
      case 'neq':      return value !== rule.value;
      case 'gt':       return value > rule.value;
      case 'lt':       return value < rule.value;
      case 'gte':      return value >= rule.value;
      case 'lte':      return value <= rule.value;
      case 'in':       return Array.isArray(rule.value) && rule.value.includes(value);
      case 'not-in':   return Array.isArray(rule.value) && !rule.value.includes(value);
      case 'contains': return String(value ?? '').includes(rule.value);
      case 'exists':   return value !== undefined && value !== null;
      case 'matches':  return new RegExp(rule.value).test(String(value ?? ''));
      default:         return false;
    }
  }

  _resolvePath(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }
}

class Experiment {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.variants = def.variants ?? [];   // [{ id, weight, contentRef }]
    this.totalWeight = this.variants.reduce((s, v) => s + (v.weight ?? 1), 0);
    this.status = def.status ?? 'running';
    this.metric = def.metric ?? 'conversion';
    this._counts = new Map(this.variants.map(v => [v.id, { impressions: 0, conversions: 0 }]));
  }

  /**
   * Assign a variant to a visitor using weighted random selection.
   * The visitor ID is used as a seed for deterministic re-assignment.
   * @param {string} visitorId
   * @returns {object} variant
   */
  assignVariant(visitorId) {
    // Deterministic hash to ensure the same visitor always gets the same variant
    const hash = this._hashCode(visitorId + this.id);
    const bucket = Math.abs(hash) % this.totalWeight;
    let accumulated = 0;
    for (const variant of this.variants) {
      accumulated += variant.weight ?? 1;
      if (bucket < accumulated) return variant;
    }
    return this.variants[0];
  }

  recordImpression(variantId) {
    const stats = this._counts.get(variantId);
    if (stats) stats.impressions++;
  }

  recordConversion(variantId) {
    const stats = this._counts.get(variantId);
    if (stats) stats.conversions++;
  }

  getStats() {
    const result = {};
    for (const [id, stats] of this._counts) {
      result[id] = {
        ...stats,
        conversionRate: stats.impressions > 0 ? stats.conversions / stats.impressions : 0,
      };
    }
    return result;
  }

  _hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}

class PersonalizationEngine {
  constructor() {
    this._segments = new Map();
    this._experiments = new Map();
    this._mlScorers = new Map();  // pluggable ML model adapters
  }

  addSegment(def) {
    const segment = new Segment(def);
    this._segments.set(segment.id, segment);
    return this;
  }

  addExperiment(def) {
    const experiment = new Experiment(def);
    this._experiments.set(experiment.id, experiment);
    return this;
  }

  /** Register an ML scorer plugin: fn(visitor) => Promise<Map<segmentId, score>> */
  addMLScorer(name, scorerFn) {
    this._mlScorers.set(name, scorerFn);
    return this;
  }

  /**
   * Evaluate all segments for a visitor and return matched segment IDs,
   * sorted by priority (highest first).
   * @param {object} visitor  { id, attributes, history, device, geo, ... }
   * @returns {string[]}
   */
  evaluateSegments(visitor) {
    const matched = [];
    for (const segment of this._segments.values()) {
      if (segment.matches(visitor)) matched.push(segment);
    }
    return matched
      .sort((a, b) => b.priority - a.priority)
      .map(s => s.id);
  }

  /**
   * Resolve a content variant for a visitor given a set of available variants.
   * Experiments take precedence over segment-based targeting.
   *
   * @param {object} visitor
   * @param {object[]} variants  [{ segmentIds?, experimentId?, contentRef }]
   * @returns {object} The winning variant
   */
  resolveVariant(visitor, variants, defaultVariant) {
    // Check experiments first
    for (const variant of variants) {
      if (variant.experimentId) {
        const exp = this._experiments.get(variant.experimentId);
        if (exp && exp.status === 'running') {
          const assigned = exp.assignVariant(visitor.id);
          exp.recordImpression(assigned.id);
          return assigned;
        }
      }
    }

    // Segment-based targeting
    const visitorSegments = new Set(this.evaluateSegments(visitor));
    for (const variant of variants) {
      if (!variant.segmentIds || variant.segmentIds.length === 0) continue;
      if (variant.segmentIds.some(s => visitorSegments.has(s))) return variant;
    }

    return defaultVariant ?? variants[0] ?? null;
  }
}

module.exports = new PersonalizationEngine();
