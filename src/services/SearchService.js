/**
 * SearchService
 *
 * Full-text and faceted search facade for YIC content.
 * Abstracts over any backend (Elasticsearch, Algolia, OpenSearch)
 * via an adapter pattern. Adds query pre-processing, spell correction,
 * synonym expansion, and result boosting.
 */

class SearchQuery {
  constructor(raw = '') {
    this.text = raw;
    this.filters = {};        // { field: value | value[] }
    this.facets = [];         // field names to aggregate
    this.sort = null;         // { field, direction: 'asc'|'desc' }
    this.page = 0;
    this.pageSize = 20;
    this.locale = 'en';
    this.boost = {};          // { field: weight }
    this.highlight = [];      // fields to highlight in results
  }

  where(field, value) { this.filters[field] = value; return this; }
  withFacets(...fields) { this.facets.push(...fields); return this; }
  sortBy(field, direction = 'asc') { this.sort = { field, direction }; return this; }
  paginate(page, size) { this.page = page; this.pageSize = size; return this; }
  inLocale(locale) { this.locale = locale; return this; }
  boostField(field, weight) { this.boost[field] = weight; return this; }
  withHighlight(...fields) { this.highlight.push(...fields); return this; }
}

class SearchResult {
  constructor(data) {
    this.total = data.total ?? 0;
    this.hits = data.hits ?? [];          // array of content nodes with score + highlights
    this.facets = data.facets ?? {};      // { field: [{ value, count }] }
    this.took = data.took ?? 0;           // ms
    this.page = data.page ?? 0;
    this.pageSize = data.pageSize ?? 20;
  }

  get pageCount() {
    return this.pageSize > 0 ? Math.ceil(this.total / this.pageSize) : 0;
  }

  get isEmpty() {
    return this.hits.length === 0;
  }

  /** Map over hits, stripping search metadata. */
  getItems() {
    return this.hits.map(h => h._source ?? h);
  }
}

class SearchService {
  constructor() {
    this._adapter = null;
    this._synonyms = new Map();
    this._stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for']);
    this._queryMiddleware = [];
    this._resultMiddleware = [];
  }

  /** Attach a backend adapter (e.g. ElasticsearchAdapter). */
  useAdapter(adapter) {
    if (typeof adapter.search !== 'function') {
      throw new TypeError('Adapter must implement search(query): Promise<SearchResult>');
    }
    this._adapter = adapter;
    return this;
  }

  /**
   * Register a synonym mapping. Terms are case-insensitive.
   * @param {string[]} terms  e.g. ['car', 'automobile', 'vehicle']
   */
  addSynonyms(terms) {
    for (const term of terms) {
      this._synonyms.set(term.toLowerCase(), terms.filter(t => t !== term));
    }
    return this;
  }

  /** Add a query middleware: fn(query) => query */
  useQueryMiddleware(fn) { this._queryMiddleware.push(fn); return this; }

  /** Add a result middleware: fn(result, query) => result */
  useResultMiddleware(fn) { this._resultMiddleware.push(fn); return this; }

  /**
   * Execute a search.
   * @param {string | SearchQuery} input
   * @returns {Promise<SearchResult>}
   */
  async search(input) {
    if (!this._adapter) throw new Error('No search adapter configured');

    let query = input instanceof SearchQuery ? input : new SearchQuery(input);

    // Apply query middleware (synonym expansion, stop word removal, etc.)
    query = this._preProcess(query);
    for (const mw of this._queryMiddleware) query = await mw(query);

    const raw = await this._adapter.search(query);
    let result = raw instanceof SearchResult ? raw : new SearchResult(raw);

    // Apply result middleware (personalisation re-ranking, deduplication, etc.)
    for (const mw of this._resultMiddleware) result = await mw(result, query);

    return result;
  }

  /**
   * Suggest search completions for a partial query (type-ahead).
   */
  async suggest(prefix, opts = {}) {
    if (!this._adapter?.suggest) return [];
    return this._adapter.suggest(prefix, opts);
  }

  /**
   * Index a content node into the search backend.
   */
  async index(node) {
    if (!this._adapter?.index) throw new Error('Adapter does not support indexing');
    return this._adapter.index(node);
  }

  /**
   * Remove a content node from the index.
   */
  async deindex(id) {
    if (!this._adapter?.deindex) throw new Error('Adapter does not support deindexing');
    return this._adapter.deindex(id);
  }

  _preProcess(query) {
    // Stop word removal
    const words = query.text.split(/\s+/).filter(w => !this._stopWords.has(w.toLowerCase()));

    // Synonym expansion
    const expanded = new Set(words);
    for (const word of words) {
      const synonyms = this._synonyms.get(word.toLowerCase()) ?? [];
      synonyms.forEach(s => expanded.add(s));
    }

    query.text = [...expanded].join(' ');
    return query;
  }

  /** Build a fluent SearchQuery object for chaining. */
  query(text = '') {
    return new SearchQuery(text);
  }
}

module.exports = { SearchService: new SearchService(), SearchQuery, SearchResult };
