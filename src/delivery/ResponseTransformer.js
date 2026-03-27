/**
 * ResponseTransformer
 *
 * A pipeline of transformation steps applied to resolved content nodes
 * before they are serialized and sent to the client.
 *
 * Built-in transforms: image URL rewriting, rich-text sanitization,
 * asset rendition selection, link rewriting, and output format shaping.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'hr', 'span',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'width', 'height']);

class ResponseTransformer {
  constructor() {
    this._steps = [];
    this._imageBaseUrl = '';
    this._linkRewriteRules = [];
  }

  // ── Configuration ─────────────────────────────────────────────────────────────

  setImageBaseUrl(url) { this._imageBaseUrl = url.replace(/\/$/, ''); return this; }

  addLinkRewriteRule(pattern, replacement) {
    this._linkRewriteRules.push({
      pattern: typeof pattern === 'string' ? new RegExp(pattern) : pattern,
      replacement,
    });
    return this;
  }

  /** Add a custom transform step: async fn(node, ctx) => node */
  use(fn) { this._steps.push(fn); return this; }

  // ── Transform pipeline ────────────────────────────────────────────────────────

  async transform(node, ctx) {
    let n = this._deepClone(node);

    n = this._transformImages(n, ctx);
    n = this._sanitizeRichText(n);
    n = this._rewriteLinks(n, ctx);
    n = this._selectRenditions(n, ctx);
    n = this._stripInternalFields(n);

    for (const step of this._steps) {
      n = await step(n, ctx);
    }

    return n;
  }

  _transformImages(node, ctx) {
    if (!node.fields) return node;

    for (const [key, value] of Object.entries(node.fields)) {
      if (typeof value === 'string' && value.startsWith('/content/dam/')) {
        node.fields[key] = this._imageBaseUrl + value;
      }
    }

    return node;
  }

  _sanitizeRichText(node) {
    if (!node.fields) return node;

    for (const [key, value] of Object.entries(node.fields)) {
      if (typeof value === 'string' && value.includes('<')) {
        node.fields[key] = this._sanitizeHTML(value);
      }
    }

    return node;
  }

  /**
   * Basic allowlist-based HTML sanitizer.
   * For production, pair with DOMPurify or similar.
   */
  _sanitizeHTML(html) {
    // Remove script and style blocks entirely
    let clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');

    // Strip disallowed tags (keep content)
    clean = clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (match, tag, attrs) => {
      if (!ALLOWED_TAGS.has(tag.toLowerCase())) return '';

      // Filter attributes
      const filteredAttrs = attrs.replace(
        /\s+([a-zA-Z-]+)(?:="([^"]*)")?/g,
        (attrMatch, name, value) => {
          if (!ALLOWED_ATTRS.has(name.toLowerCase())) return '';
          // Block javascript: URLs
          if ((name === 'href' || name === 'src') && /javascript:/i.test(value ?? '')) return '';
          return attrMatch;
        }
      );

      return `<${tag}${filteredAttrs}>`;
    });

    return clean;
  }

  _rewriteLinks(node, ctx) {
    if (!node.fields || !this._linkRewriteRules.length) return node;

    const applyRules = (text) => {
      for (const rule of this._linkRewriteRules) {
        text = text.replace(rule.pattern, rule.replacement);
      }
      return text;
    };

    for (const [key, value] of Object.entries(node.fields)) {
      if (typeof value === 'string') {
        node.fields[key] = applyRules(value);
      }
    }

    return node;
  }

  _selectRenditions(node, ctx) {
    if (!node.assets) return node;

    for (const asset of node.assets) {
      if (!asset._renditions) continue;
      const targetWidth = ctx.device === 'mobile' ? 768 : ctx.device === 'tablet' ? 1024 : 1920;
      const rendition = asset.getBestRendition?.(targetWidth);
      if (rendition) asset.deliveryUrl = rendition.url;
    }

    return node;
  }

  _stripInternalFields(node) {
    const INTERNAL = new Set(['_locks', '_variations', '_renditions', '__v', '_id']);
    const strip = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(strip);
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (INTERNAL.has(k)) continue;
        out[k] = strip(v);
      }
      return out;
    };
    return strip(node);
  }

  _deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); }
    catch { return { ...obj }; }
  }
}

module.exports = new ResponseTransformer();
