/**
 * ConfigManager
 *
 * Hierarchical configuration store for YIC CMS.
 * Supports environment-based overrides, secret resolution via provider
 * plugins, and hot-reload via file watchers in development.
 *
 * Resolution order (highest wins):
 *   runtime overrides → environment variables → config files → defaults
 */

const path = require('path');
const fs = require('fs');

class ConfigManager {
  constructor() {
    this._layers = {
      defaults: {},
      file: {},
      env: {},
      runtime: {},
    };
    this._secretProviders = [];
    this._watchers = new Map();
    this._resolved = null; // merged config cache
  }

  /**
   * Load a JSON or JS config file and merge into the `file` layer.
   * @param {string} filePath  Absolute path
   */
  loadFile(filePath) {
    if (!fs.existsSync(filePath)) return this;

    const ext = path.extname(filePath);
    let data;

    if (ext === '.json') {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } else if (ext === '.js') {
      data = require(filePath);
    } else {
      throw new Error(`Unsupported config format: ${ext}`);
    }

    this._layers.file = this._merge(this._layers.file, data);
    this._resolved = null;
    return this;
  }

  /** Overlay environment variables using a prefix filter. */
  loadEnv(prefix = 'YIC_') {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith(prefix)) continue;
      const normalized = key.slice(prefix.length).toLowerCase().replace(/_/g, '.');
      this._setPath(env, normalized, this._coerce(value));
    }
    this._layers.env = this._merge(this._layers.env, env);
    this._resolved = null;
    return this;
  }

  /** Set default values (lowest priority). */
  defaults(values) {
    this._layers.defaults = this._merge(this._layers.defaults, values);
    this._resolved = null;
    return this;
  }

  /** Override at runtime (highest priority). */
  set(keyPath, value) {
    this._setPath(this._layers.runtime, keyPath, value);
    this._resolved = null;
    return this;
  }

  /**
   * Retrieve a config value by dot-separated key path.
   * @param {string} keyPath  e.g. 'delivery.cdn.endpoint'
   * @param {*} [fallback]
   */
  get(keyPath, fallback) {
    if (!this._resolved) this._resolved = this._buildResolved();
    const value = keyPath.split('.').reduce((obj, key) => obj?.[key], this._resolved);
    return value !== undefined ? value : fallback;
  }

  /** Returns the entire merged configuration object. */
  getAll() {
    if (!this._resolved) this._resolved = this._buildResolved();
    return JSON.parse(JSON.stringify(this._resolved)); // deep clone
  }

  /** Register a secret provider plugin (e.g. AWS Secrets Manager adapter). */
  addSecretProvider(provider) {
    if (typeof provider.resolve !== 'function') {
      throw new TypeError('Secret provider must implement resolve(key): Promise<string>');
    }
    this._secretProviders.push(provider);
    return this;
  }

  /** Resolve a secret via registered providers (first match wins). */
  async resolveSecret(key) {
    for (const provider of this._secretProviders) {
      const value = await provider.resolve(key);
      if (value !== null && value !== undefined) return value;
    }
    throw new Error(`Secret not found: ${key}`);
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  _buildResolved() {
    return [
      this._layers.defaults,
      this._layers.file,
      this._layers.env,
      this._layers.runtime,
    ].reduce((acc, layer) => this._merge(acc, layer), {});
  }

  _merge(target, source) {
    const out = { ...target };
    for (const [k, v] of Object.entries(source)) {
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object')
        ? this._merge(out[k], v)
        : v;
    }
    return out;
  }

  _setPath(obj, dotPath, value) {
    const parts = dotPath.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts.at(-1)] = value;
  }

  _coerce(str) {
    if (str === 'true') return true;
    if (str === 'false') return false;
    const n = Number(str);
    return Number.isFinite(n) ? n : str;
  }
}

module.exports = new ConfigManager();
