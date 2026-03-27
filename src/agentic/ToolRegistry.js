/**
 * ToolRegistry
 *
 * Central catalogue of tools agents can call.
 * Each tool has a JSON-Schema input spec so the LLM can construct
 * valid calls without hallucinating argument shapes.
 */

class Tool {
  constructor(def) {
    if (!def.name)     throw new Error('Tool must have a name');
    if (!def.execute)  throw new Error(`Tool "${def.name}" must have an execute fn`);

    this.name        = def.name;
    this.description = def.description ?? '';
    this.inputSchema = def.inputSchema ?? { type: 'object', properties: {} };
    this.execute     = def.execute;   // async (args, context) => result
    this._calls      = 0;
    this._errors     = 0;
  }

  async call(args, context = {}) {
    this._calls++;
    try {
      return await this.execute(args, context);
    } catch (err) {
      this._errors++;
      throw err;
    }
  }

  get stats() { return { calls: this._calls, errors: this._errors }; }

  /** Serialised descriptor passed to the LLM function-calling API. */
  toSpec() {
    return {
      type: 'function',
      function: {
        name:        this.name,
        description: this.description,
        parameters:  this.inputSchema,
      },
    };
  }
}

class ToolRegistry {
  constructor() {
    this._tools = new Map();
    this._registerBuiltins();
  }

  register(def) {
    const tool = new Tool(def);
    this._tools.set(tool.name, tool);
    return this;
  }

  get(name) { return this._tools.get(name) ?? null; }

  /** Return specs for a subset (or all) tools — passed to the LLM. */
  describe(names = []) {
    const set = names.length
      ? names.map(n => this._tools.get(n)).filter(Boolean)
      : [...this._tools.values()];
    return set.map(t => t.toSpec());
  }

  async call(name, args, context = {}) {
    const tool = this._tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.call(args, context);
  }

  stats() {
    return Object.fromEntries([...this._tools.entries()].map(([k, v]) => [k, v.stats]));
  }

  _registerBuiltins() {
    this.register({
      name: 'cms.getPage',
      description: 'Retrieve a CMS page by path.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      execute: async ({ path }, ctx) => ctx.repository?.get(path) ?? { path, status: 'not-found' },
    });

    this.register({
      name: 'cms.savePage',
      description: 'Create or update a CMS page.',
      inputSchema: {
        type: 'object', required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'object' } },
      },
      execute: async ({ path, content }, ctx) => ctx.repository?.save({ path, ...content }) ?? { path, saved: true },
    });

    this.register({
      name: 'cms.search',
      description: 'Full-text search over published content.',
      inputSchema: {
        type: 'object', required: ['query'],
        properties: { query: { type: 'string' }, locale: { type: 'string' } },
      },
      execute: async ({ query }, ctx) => ctx.search?.search(query) ?? { hits: [], total: 0 },
    });

    this.register({
      name: 'cms.publish',
      description: 'Publish a content path to the live environment.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      execute: async ({ path }, ctx) => ({ path, published: true, ts: new Date().toISOString() }),
    });

    this.register({
      name: 'web.fetch',
      description: 'Fetch external URL content for research or enrichment.',
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } },
      execute: async ({ url }) => ({ url, body: `PSEUDO_FETCH(${url})`, status: 200 }),
    });
  }
}

module.exports = new ToolRegistry();
