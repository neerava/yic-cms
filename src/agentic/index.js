/**
 * YIC Agentic Subsystem
 *
 * Exports for the AI orchestration layer.
 * Agents are wired together by the AgentOrchestrator using a
 * ReasoningLoop per role, coordinated through shared memory and tools.
 *
 * Quickstart:
 *
 *   const { AgentOrchestrator, ToolRegistry } = require('./src/agentic');
 *
 *   const orch = new AgentOrchestrator();
 *   orch.register('author',   { tools: ['cms.savePage', 'web.fetch'] });
 *   orch.register('seo',      { tools: ['cms.getPage',  'cms.savePage'] });
 *   orch.register('publisher',{ tools: ['cms.publish'] });
 *
 *   const result = await orch.run('Write and publish a product launch page for /products/cloud');
 */

module.exports = {
  AgentOrchestrator: require('./AgentOrchestrator'),
  ReasoningLoop:     require('./ReasoningLoop'),
  TaskPlanner:       require('./TaskPlanner'),
  ToolRegistry:      require('./ToolRegistry'),
  ActionExecutor:    require('./ActionExecutor'),
  MemoryStore:       require('./MemoryStore'),
  GoalTracker:       require('./GoalTracker'),
  PromptBuilder:     require('./PromptBuilder'),
};
