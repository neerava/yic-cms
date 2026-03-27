/**
 * PromptBuilder
 *
 * Assembles system prompts for each agent role, injecting
 * memory summaries, tool specs, and CMS context into the
 * appropriate slots of the LLM message format.
 */

const ROLE_PERSONAS = {
  default:  'You are a helpful AI assistant embedded in the YIC CMS platform.',
  author:   'You are a professional content author. Write clear, engaging, on-brand copy.',
  seo:      'You are an SEO specialist. Optimise titles, meta descriptions, and keyword density.',
  reviewer: 'You are a meticulous content reviewer. Check for accuracy, tone, and brand compliance.',
  publisher:'You are a publishing coordinator. Validate content is ready and trigger the pipeline.',
  researcher:'You are a research agent. Gather facts and synthesise information from external sources.',
};

class PromptBuilder {
  constructor() {
    this._partials = new Map();   // named snippets for reuse
  }

  addPartial(name, text) {
    this._partials.set(name, text);
    return this;
  }

  /**
   * Build a system prompt for the given role.
   *
   * @param {{ role, context, memory, tools }} opts
   * @returns {string}
   */
  system({ role = 'default', context = {}, memory = {}, tools = [] }) {
    const persona = ROLE_PERSONAS[role] ?? ROLE_PERSONAS.default;

    const sections = [
      `## Role\n${persona}`,
      this._contextSection(context),
      this._memorySection(memory),
      this._toolsSection(tools),
      this._rulesSection(),
    ].filter(Boolean);

    return sections.join('\n\n');
  }

  /**
   * Build a user-facing task message, optionally injecting
   * a structured output schema requirement.
   */
  task(description, opts = {}) {
    let msg = description;
    if (opts.outputSchema) {
      msg += `\n\nRespond ONLY with a JSON block matching this schema:\n\`\`\`json\n${JSON.stringify(opts.outputSchema, null, 2)}\n\`\`\``;
    }
    return msg;
  }

  // ── Sections ──────────────────────────────────────────────────────────────────

  _contextSection(ctx) {
    if (!ctx || !Object.keys(ctx).length) return null;
    const lines = Object.entries(ctx)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    if (!lines.length) return null;
    return `## Current Context\n${lines.join('\n')}`;
  }

  _memorySection(memory) {
    const recent = memory.recent;
    if (!recent?.length) return null;
    const lines = recent
      .slice(-6)
      .map(e => `- [${e.key}] ${JSON.stringify(e.value).slice(0, 80)}`);
    return `## Recent Memory\n${lines.join('\n')}`;
  }

  _toolsSection(tools) {
    if (!tools?.length) return null;
    const names = tools.map(t => `- \`${t.function?.name}\`: ${t.function?.description}`);
    return `## Available Tools\n${names.join('\n')}\nCall tools by emitting a tool_call block. Do not hallucinate tool names.`;
  }

  _rulesSection() {
    return [
      '## Rules',
      '- Be concise and factual.',
      '- Only call tools when necessary; prefer using context already provided.',
      '- Emit `[DONE]` at the end of your final response to signal completion.',
      '- Never invent CMS paths or content IDs; retrieve them via tools.',
    ].join('\n');
  }
}

module.exports = new PromptBuilder();
