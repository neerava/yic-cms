/**
 * ContentGraph
 *
 * Represents the directed acyclic graph of content relationships within YIC.
 * Nodes are content items; edges encode semantic relationships such as
 * "references", "inherits", "translates", "fragments-into", etc.
 *
 * Used by the AI Orchestration Engine for dependency resolution,
 * cascade invalidation, and cross-channel impact analysis.
 */

class ContentGraph {
  constructor() {
    /** @type {Map<string, Set<string>>} adjacency list (outgoing edges) */
    this._edges = new Map();
    /** @type {Map<string, Set<string>>} reverse adjacency (incoming edges) */
    this._reverseEdges = new Map();
    /** @type {Map<string, object>} edge metadata keyed by `${from}:${to}` */
    this._edgeMeta = new Map();
    /** @type {Map<string, object>} node metadata */
    this._nodes = new Map();
  }

  /** Register a node with optional metadata. Idempotent. */
  addNode(id, meta = {}) {
    if (!this._nodes.has(id)) {
      this._nodes.set(id, meta);
      this._edges.set(id, new Set());
      this._reverseEdges.set(id, new Set());
    }
    return this;
  }

  /**
   * Create a directed edge from `from` → `to`.
   * @param {string} from
   * @param {string} to
   * @param {object} [meta]   e.g. { type: 'references', weight: 1 }
   */
  addEdge(from, to, meta = {}) {
    this.addNode(from);
    this.addNode(to);
    this._edges.get(from).add(to);
    this._reverseEdges.get(to).add(from);
    this._edgeMeta.set(`${from}:${to}`, { ...meta, createdAt: Date.now() });
    return this;
  }

  removeEdge(from, to) {
    this._edges.get(from)?.delete(to);
    this._reverseEdges.get(to)?.delete(from);
    this._edgeMeta.delete(`${from}:${to}`);
  }

  /** Direct dependencies of a node (what it points to). */
  dependenciesOf(id) {
    return [...(this._edges.get(id) ?? [])];
  }

  /** Nodes that depend on the given node (reverse lookup). */
  dependentsOf(id) {
    return [...(this._reverseEdges.get(id) ?? [])];
  }

  /**
   * Compute the full transitive closure of dependencies for a node.
   * Returns nodes in topological order (leaves first).
   * @param {string} id
   * @returns {string[]}
   */
  transitiveDependencies(id) {
    const visited = new Set();
    const order = [];

    const dfs = (node) => {
      if (visited.has(node)) return;
      visited.add(node);
      for (const dep of this.dependenciesOf(node)) dfs(dep);
      order.push(node);
    };

    dfs(id);
    return order.filter(n => n !== id);
  }

  /**
   * Return all nodes affected if `id` changes (cascade invalidation set).
   * Uses BFS on the reverse graph.
   */
  cascadeSet(id) {
    const visited = new Set();
    const queue = [id];

    while (queue.length) {
      const node = queue.shift();
      if (visited.has(node)) continue;
      visited.add(node);
      for (const dep of this.dependentsOf(node)) queue.push(dep);
    }

    visited.delete(id);
    return [...visited];
  }

  /**
   * Detect cycles using DFS. Returns the first cycle found, or null.
   * @returns {string[] | null}
   */
  detectCycle() {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map([...this._nodes.keys()].map(k => [k, WHITE]));
    const parent = new Map();

    const dfs = (node) => {
      color.set(node, GRAY);
      for (const neighbor of this._edges.get(node) ?? []) {
        if (color.get(neighbor) === GRAY) {
          // Reconstruct cycle path
          const cycle = [neighbor];
          let cur = node;
          while (cur !== neighbor) { cycle.unshift(cur); cur = parent.get(cur); }
          cycle.unshift(neighbor);
          return cycle;
        }
        if (color.get(neighbor) === WHITE) {
          parent.set(neighbor, node);
          const result = dfs(neighbor);
          if (result) return result;
        }
      }
      color.set(node, BLACK);
      return null;
    };

    for (const node of this._nodes.keys()) {
      if (color.get(node) === WHITE) {
        const cycle = dfs(node);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  get nodeCount() { return this._nodes.size; }
  get edgeCount() { return this._edgeMeta.size; }

  toJSON() {
    const nodes = [...this._nodes.entries()].map(([id, meta]) => ({ id, ...meta }));
    const edges = [...this._edgeMeta.entries()].map(([key, meta]) => {
      const [from, to] = key.split(':');
      return { from, to, ...meta };
    });
    return { nodes, edges };
  }
}

module.exports = ContentGraph;
