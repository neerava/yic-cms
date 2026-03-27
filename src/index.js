/**
 * YIC CMS — Core Module Index
 *
 * Exports the fully wired YIC subsystem.
 * Import from this file to access the live singleton instances of
 * every core service.
 *
 * Example:
 *   const { WorkflowEngine, PublishingPipeline } = require('./src');
 */

module.exports = {
  // ── Core ───────────────────────────────────────────────────────────────────
  EventBus:           require('./core/EventBus'),
  ConfigManager:      require('./core/ConfigManager'),
  ContentGraph:       require('./core/ContentGraph'),

  // ── Models ─────────────────────────────────────────────────────────────────
  ContentFragment:    require('./models/ContentFragment'),
  ContentPage:        require('./models/ContentPage'),
  AssetModel:         require('./models/AssetModel'),
  ContentModel:       require('./models/ContentModel'),

  // ── Services ───────────────────────────────────────────────────────────────
  WorkflowEngine:     require('./services/WorkflowEngine'),
  PersonalizationEngine: require('./services/PersonalizationEngine'),
  PublishingPipeline: require('./services/PublishingPipeline'),
  SearchService:      require('./services/SearchService').SearchService,
  CacheService:       require('./services/CacheService'),
  LocalizationService: require('./services/LocalizationService'),
  AuditService:       require('./services/AuditService').AuditService,

  // ── Delivery ───────────────────────────────────────────────────────────────
  ContentDelivery:    require('./delivery/ContentDelivery').ContentDelivery,
  ChannelRouter:      require('./delivery/ChannelRouter'),
  ResponseTransformer: require('./delivery/ResponseTransformer'),

  // ── Auth ───────────────────────────────────────────────────────────────────
  AuthManager:        require('./auth/AuthManager'),
  RoleManager:        require('./auth/RoleManager'),

  // ── Taxonomy ───────────────────────────────────────────────────────────────
  TaxonomyManager:    require('./taxonomy/TaxonomyManager'),

  // ── DAM ────────────────────────────────────────────────────────────────────
  AssetManager:       require('./dam/AssetManager'),
  RenditionService:   require('./dam/RenditionService'),

  // ── Plugins ────────────────────────────────────────────────────────────────
  PluginRegistry:     require('./plugins/PluginRegistry'),

  // ── Utils ──────────────────────────────────────────────────────────────────
  VersionManager:     require('./utils/VersionManager'),
  SchemaValidator:    require('./utils/SchemaValidator').SchemaValidator,
  ContentSerializer:  require('./utils/ContentSerializer'),
  errors:             require('./utils/errors'),
};
