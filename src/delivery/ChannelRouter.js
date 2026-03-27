/**
 * ChannelRouter
 *
 * Routes incoming delivery requests to the correct content path and
 * DeliveryContext based on channel, device, and request metadata.
 *
 * Supports URL-pattern matching, channel fingerprinting, device detection,
 * and preview mode activation via signed tokens.
 */

const { DeliveryContext } = require('./ContentDelivery');

class Route {
  constructor(def) {
    this.pattern = typeof def.pattern === 'string'
      ? new RegExp('^' + def.pattern.replace(/:[^/]+/g, '([^/]+)').replace(/\*/g, '.*') + '$')
      : def.pattern;
    this.channel = def.channel ?? 'web';
    this.handler = def.handler;
    this.middleware = def.middleware ?? [];
    this.name = def.name ?? null;
  }

  matches(path) {
    return this.pattern.test(path);
  }

  extractParams(path) {
    const match = path.match(this.pattern);
    return match ? match.slice(1) : [];
  }
}

class ChannelRouter {
  constructor() {
    this._routes = [];
    this._channelDetectors = [];
    this._previewSecret = null;
  }

  /**
   * Register a route for a given URL pattern.
   * @param {string|RegExp} pattern
   * @param {Function} handler   async (req, ctx) => DeliveryResponse
   * @param {object} [opts]
   */
  route(pattern, handler, opts = {}) {
    this._routes.push(new Route({ pattern, handler, ...opts }));
    return this;
  }

  /** Shorthand for web routes. */
  web(pattern, handler, opts = {}) {
    return this.route(pattern, handler, { ...opts, channel: 'web' });
  }

  /** Shorthand for mobile API routes. */
  mobile(pattern, handler, opts = {}) {
    return this.route(pattern, handler, { ...opts, channel: 'mobile' });
  }

  /** Register a channel detector: fn(req) => channel string or null */
  addChannelDetector(fn) {
    this._channelDetectors.push(fn);
    return this;
  }

  setPreviewSecret(secret) {
    this._previewSecret = secret;
    return this;
  }

  /**
   * Resolve a DeliveryContext from an incoming HTTP request object.
   * @param {object} req  { headers, query, cookies, ip, url }
   */
  buildContext(req) {
    const ctx = new DeliveryContext({
      locale: this._resolveLocale(req),
      channel: this._resolveChannel(req),
      device: this._resolveDevice(req),
      preview: this._resolvePreview(req),
      bypassCache: req.query?.['cache'] === 'bypass',
      requestId: req.headers?.['x-request-id'],
    });

    ctx.visitor = this._resolveVisitor(req);
    return ctx;
  }

  /**
   * Find a matching route and execute it.
   * @param {string} path
   * @param {object} req
   * @returns {Promise<*>}
   */
  async dispatch(path, req) {
    const ctx = this.buildContext(req);

    for (const route of this._routes) {
      if (route.channel !== ctx.channel && route.channel !== '*') continue;
      if (!route.matches(path)) continue;

      // Run middleware chain
      for (const mw of route.middleware) {
        const result = await mw(req, ctx);
        if (result === false) return null; // halted
      }

      return route.handler(req, ctx, route.extractParams(path));
    }

    return null; // No route matched
  }

  _resolveLocale(req) {
    return req.query?.locale
      ?? req.cookies?.['yic-locale']
      ?? (req.headers?.['accept-language'] ?? '').split(',')[0]?.trim()?.split(';')[0]
      ?? 'en';
  }

  _resolveChannel(req) {
    for (const detector of this._channelDetectors) {
      const channel = detector(req);
      if (channel) return channel;
    }

    const ua = (req.headers?.['user-agent'] ?? '').toLowerCase();
    if (req.headers?.['x-channel']) return req.headers['x-channel'];
    if (req.headers?.['x-requested-with'] === 'XMLHttpRequest') return 'api';
    if (/mobile|android|iphone|ipad/i.test(ua)) return 'mobile';
    return 'web';
  }

  _resolveDevice(req) {
    const ua = (req.headers?.['user-agent'] ?? '').toLowerCase();
    if (/ipad|tablet/i.test(ua)) return 'tablet';
    if (/mobile|android|iphone/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  _resolvePreview(req) {
    if (!this._previewSecret) return false;
    const token = req.query?.['preview-token'] ?? req.cookies?.['yic-preview'];
    if (!token) return false;

    try {
      const [payload, sig] = token.split('.');
      const crypto = require('crypto');
      const expected = crypto.createHmac('sha256', this._previewSecret).update(payload).digest('hex');
      return sig === expected;
    } catch {
      return false;
    }
  }

  _resolveVisitor(req) {
    const visitorId = req.cookies?.['yic-visitor'] ?? req.headers?.['x-visitor-id'];
    if (!visitorId) return null;
    return {
      id: visitorId,
      attributes: {},
      segments: (req.cookies?.['yic-segments'] ?? '').split(',').filter(Boolean),
    };
  }
}

module.exports = new ChannelRouter();
