/**
 * PluginRegistry
 *
 * Central registry for all first-party and third-party YIC CMS plugins.
 * Plugins may extend any subsystem by hooking into named extension points,
 * contributing route handlers, adding field types, or registering services.
 *
 * Plugin lifecycle: registered → initialized → active → deactivated
 */

const EventBus = require('../core/EventBus');

const EXTENSION_POINTS = new Set([
  'content:field-type',
  'content:validator',
  'delivery:transformer',
  'delivery:channel',
  'auth:provider',
  'search:adapter',
  'workflow:step-type',
  'dam:metadata-extractor',
  'dam:storage-adapter',
  'ui:sidebar-panel',
  'ui:toolbar-action',
  'ui:preview-renderer',
]);

class Plugin {
  constructor(manifest) {
    if (!manifest.id) throw new Error('Plugin must have an id');
    if (!manifest.version) throw new Error('Plugin must declare a version');

    this.id = manifest.id;
    this.name = manifest.name ?? manifest.id;
    this.version = manifest.version;
    this.description = manifest.description ?? '';
    this.author = manifest.author ?? null;
    this.dependencies = manifest.dependencies ?? {};
    this.extensionPoints = manifest.extensionPoints ?? [];
    this._hooks = manifest.hooks ?? {};
    this._status = 'registered';
  }

  get status() { return this._status; }
  get isActive() { return this._status === 'active'; }
}

class PluginRegistry {
  constructor() {
    this._plugins = new Map();
    this._extensions = new Map(); // extensionPoint → [{ pluginId, implementation }]
    this._hooks = new Map();      // hookName → [fn]
  }

  /**
   * Register a plugin manifest.
   * @param {object} manifest
   * @param {object} implementation  { hooks, extensions }
   */
  register(manifest, implementation = {}) {
    if (this._plugins.has(manifest.id)) {
      throw new Error(`Plugin already registered: ${manifest.id}`);
    }

    const plugin = new Plugin(manifest);
    this._plugins.set(plugin.id, plugin);

    // Register extension points
    for (const [point, impl] of Object.entries(implementation.extensions ?? {})) {
      if (!EXTENSION_POINTS.has(point)) {
        console.warn(`[PluginRegistry] Unknown extension point: ${point}`);
      }
      if (!this._extensions.has(point)) this._extensions.set(point, []);
      this._extensions.get(point).push({ pluginId: plugin.id, implementation: impl });
    }

    // Register hooks
    for (const [hookName, fn] of Object.entries(implementation.hooks ?? {})) {
      if (!this._hooks.has(hookName)) this._hooks.set(hookName, []);
      this._hooks.get(hookName).push({ pluginId: plugin.id, fn });
    }

    EventBus.emit('plugin:registered', { plugin });
    return this;
  }

  async activate(pluginId) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
    if (plugin.isActive) return;

    // Check dependency resolution
    for (const [dep, requiredVersion] of Object.entries(plugin.dependencies)) {
      const depPlugin = this._plugins.get(dep);
      if (!depPlugin) throw new Error(`Plugin "${pluginId}" requires "${dep}" which is not registered`);
      if (!depPlugin.isActive) await this.activate(dep);
    }

    plugin._status = 'active';
    EventBus.emit('plugin:activated', { plugin });
  }

  async deactivate(pluginId) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin || !plugin.isActive) return;

    // Check no active plugins depend on this one
    for (const p of this._plugins.values()) {
      if (p.isActive && p.dependencies[pluginId]) {
        throw new Error(`Cannot deactivate "${pluginId}" — "${p.id}" depends on it`);
      }
    }

    plugin._status = 'deactivated';
    EventBus.emit('plugin:deactivated', { plugin });
  }

  /**
   * Retrieve all active implementations for an extension point.
   */
  getExtensions(point) {
    return (this._extensions.get(point) ?? [])
      .filter(e => this._plugins.get(e.pluginId)?.isActive)
      .map(e => e.implementation);
  }

  /**
   * Invoke all registered hooks for a given name in registration order.
   * @param {string} hookName
   * @param {*} payload
   * @returns {Promise<*>}  Final payload after all hooks ran
   */
  async callHook(hookName, payload) {
    const handlers = this._hooks.get(hookName) ?? [];
    let result = payload;
    for (const { pluginId, fn } of handlers) {
      if (!this._plugins.get(pluginId)?.isActive) continue;
      result = await fn(result) ?? result;
    }
    return result;
  }

  get(id) { return this._plugins.get(id) ?? null; }
  list() { return [...this._plugins.values()]; }
  listActive() { return [...this._plugins.values()].filter(p => p.isActive); }
  listExtensionPoints() { return [...EXTENSION_POINTS]; }
}

module.exports = new PluginRegistry();
