/**
 * ContentDelivery
 *
 * High-level API for resolving and rendering content for delivery.
 * Wires together the repository, cache, personalization engine,
 * localization service, and transformer chain to produce a fully
 * resolved content response for any channel.
 */

const CacheService = require('../services/CacheService');
const PersonalizationEngine = require('../services/PersonalizationEngine');
const LocalizationService = require('../services/LocalizationService');
const EventBus = require('../core/EventBus');

class DeliveryContext {
  constructor(opts = {}) {
    this.visitor = opts.visitor ?? null;       // { id, segments, attributes }
    this.locale = opts.locale ?? LocalizationService.defaultLocale;
    this.channel = opts.channel ?? 'web';      // web | mobile | email | voice | kiosk
    this.device = opts.device ?? 'desktop';    // desktop | mobile | tablet
    this.preview = opts.preview ?? false;
    this.bypassCache = opts.bypassCache ?? false;
    this.requestId = opts.requestId ?? `req-${Date.now()}`;
  }
}

class DeliveryResponse {
  constructor() {
    this.content = null;
    this.locale = null;
    this.channel = null;
    this.fromCache = false;
    this.personalized = false;
    this.experimentVariant = null;
    this.cacheTags = [];
    this.meta = {};
    this.duration = 0;
  }
}

class ContentDelivery {
  constructor() {
    this._repository = null;
    this._transformers = [];   // channel-specific transform fns: async (node, ctx) => node
    this._fallbackHandler = null;
  }

  useRepository(repo) { this._repository = repo; return this; }
  addTransformer(fn) { this._transformers.push(fn); return this; }
  onFallback(fn) { this._fallbackHandler = fn; return this; }

  /**
   * Resolve and deliver a content path for a given DeliveryContext.
   * @param {string} path
   * @param {DeliveryContext} ctx
   * @returns {Promise<DeliveryResponse>}
   */
  async deliver(path, ctx = new DeliveryContext()) {
    const t0 = Date.now();
    const response = new DeliveryResponse();
    response.locale = ctx.locale;
    response.channel = ctx.channel;

    // Resolve locale fallback chain
    const localeChain = LocalizationService.getFallbackChain(ctx.locale);
    let node = null;

    for (const locale of localeChain) {
      const cacheKey = `delivery:${ctx.channel}:${locale}:${path}`;

      if (!ctx.bypassCache && !ctx.preview) {
        const cached = await CacheService.get(cacheKey);
        if (cached) {
          response.content = cached;
          response.fromCache = true;
          response.duration = Date.now() - t0;
          return response;
        }
      }

      try {
        node = await this._repository.get(path, { locale });
        if (node) break;
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
      }
    }

    if (!node) {
      if (this._fallbackHandler) {
        node = await this._fallbackHandler(path, ctx);
      }
      if (!node) {
        throw Object.assign(new Error(`Content not found: ${path}`), { status: 404 });
      }
    }

    // Personalization
    if (ctx.visitor && node.variants?.length) {
      const variant = PersonalizationEngine.resolveVariant(ctx.visitor, node.variants, node);
      if (variant !== node) {
        response.personalized = true;
        response.experimentVariant = variant.experimentId ?? null;
        node = { ...node, ...variant };
      }
    }

    // Transform for channel
    for (const transform of this._transformers) {
      node = await transform(node, ctx);
    }

    response.content = node;
    response.cacheTags = this._extractCacheTags(node);

    // Populate cache
    if (!ctx.preview && !ctx.bypassCache) {
      const cacheKey = `delivery:${ctx.channel}:${ctx.locale}:${path}`;
      await CacheService.set(cacheKey, node, { tags: response.cacheTags, ttl: 300 });
    }

    response.duration = Date.now() - t0;
    EventBus.emit('delivery:served', { path, response });
    return response;
  }

  _extractCacheTags(node) {
    const tags = [];
    if (node.id) tags.push(`content:${node.id}`);
    if (node.path) tags.push(`path:${node.path}`);
    if (Array.isArray(node.tags)) tags.push(...node.tags.map(t => `tag:${t}`));
    const refs = node.fragmentRefs ?? [];
    refs.forEach(r => tags.push(`fragment:${r}`));
    return tags;
  }
}

module.exports = { ContentDelivery: new ContentDelivery(), DeliveryContext };
