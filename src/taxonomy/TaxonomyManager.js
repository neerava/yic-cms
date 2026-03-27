/**
 * TaxonomyManager
 *
 * Manages hierarchical tag taxonomies in YIC CMS.
 * Supports multiple named taxonomies (e.g. 'topics', 'industries', 'regions'),
 * nested category trees, synonym mapping, and slug generation.
 */

class TaxonomyNode {
  constructor(data) {
    this.id = data.id;
    this.slug = data.slug ?? this._slugify(data.label);
    this.label = data.label;
    this.description = data.description ?? '';
    this.synonyms = data.synonyms ?? [];
    this.metadata = data.metadata ?? {};
    this.children = new Map();
    this.parent = null;
  }

  _slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  get path() {
    const parts = [];
    let cur = this;
    while (cur) { parts.unshift(cur.slug); cur = cur.parent; }
    return '/' + parts.join('/');
  }

  get depth() {
    let d = 0;
    let cur = this.parent;
    while (cur) { d++; cur = cur.parent; }
    return d;
  }

  toJSON() {
    return {
      id: this.id,
      slug: this.slug,
      label: this.label,
      description: this.description,
      synonyms: this.synonyms,
      path: this.path,
      depth: this.depth,
      childCount: this.children.size,
    };
  }
}

class Taxonomy {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.description = def.description ?? '';
    this._roots = new Map();   // slug → TaxonomyNode
    this._index = new Map();   // id → TaxonomyNode
    this._slugIndex = new Map(); // slug → TaxonomyNode (all levels)
  }

  /**
   * Add a node to the taxonomy.
   * @param {object} data   { id, label, slug?, parentId?, synonyms?, metadata? }
   */
  add(data) {
    const node = new TaxonomyNode(data);

    if (this._index.has(node.id)) throw new Error(`Duplicate taxonomy node: ${node.id}`);

    if (data.parentId) {
      const parent = this._index.get(data.parentId);
      if (!parent) throw new Error(`Parent node not found: ${data.parentId}`);
      node.parent = parent;
      parent.children.set(node.id, node);
    } else {
      this._roots.set(node.id, node);
    }

    this._index.set(node.id, node);
    this._slugIndex.set(node.slug, node);
    return this;
  }

  getById(id) { return this._index.get(id) ?? null; }
  getBySlug(slug) { return this._slugIndex.get(slug) ?? null; }
  roots() { return [...this._roots.values()]; }

  /**
   * Return all ancestors of a node (root first).
   */
  ancestors(id) {
    const node = this._index.get(id);
    if (!node) return [];
    const chain = [];
    let cur = node.parent;
    while (cur) { chain.unshift(cur); cur = cur.parent; }
    return chain;
  }

  /**
   * Return all descendants of a node (BFS order).
   */
  descendants(id) {
    const root = this._index.get(id);
    if (!root) return [];
    const result = [];
    const queue = [...root.children.values()];
    while (queue.length) {
      const node = queue.shift();
      result.push(node);
      queue.push(...node.children.values());
    }
    return result;
  }

  /**
   * Resolve a tag string to the canonical taxonomy node, checking
   * the label, slug, and synonyms.
   */
  resolve(term) {
    const lower = term.toLowerCase();
    for (const node of this._index.values()) {
      if (node.label.toLowerCase() === lower) return node;
      if (node.slug === lower) return node;
      if (node.synonyms.some(s => s.toLowerCase() === lower)) return node;
    }
    return null;
  }

  /** Flat list of all nodes. */
  all() { return [...this._index.values()]; }
  get size() { return this._index.size; }
}

class TaxonomyManager {
  constructor() {
    this._taxonomies = new Map();
  }

  create(def) {
    const taxonomy = new Taxonomy(def);
    this._taxonomies.set(taxonomy.id, taxonomy);
    return taxonomy;
  }

  get(id) { return this._taxonomies.get(id) ?? null; }
  list() { return [...this._taxonomies.values()]; }

  /**
   * Resolve a set of raw tag strings across all registered taxonomies.
   * Returns an array of { taxonomy, node } matches.
   */
  resolveAll(tags = []) {
    const results = [];
    for (const tag of tags) {
      for (const taxonomy of this._taxonomies.values()) {
        const node = taxonomy.resolve(tag);
        if (node) results.push({ taxonomy: taxonomy.id, node });
      }
    }
    return results;
  }
}

module.exports = new TaxonomyManager();
