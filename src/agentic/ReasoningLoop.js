/**
 * ReasoningLoop
 *
 * The core think → act → observe cycle for a single agent.
 * Each step: build a prompt, call the LLM, parse the response,
 * dispatch any tool calls, and feed observations back into the next turn.
 */

const PromptBuilder  = require('./PromptBuilder');
const ToolRegistry   = require('./ToolRegistry');
const ActionExecutor = require('./ActionExecutor');

const MAX_TOOL_ROUNDS = 6;

class ReasoningLoop {
  constructor(opts = {}) {
    this.role      = opts.role ?? 'assistant';
    this.tools     = opts.tools ?? [];
    this._history  = [];   // { role, content }[]
  }

  /**
   * Run one reasoning step.
   * @param {{ task, context, memory }} opts
   * @returns {{ output, observations, shouldStop }}
   */
  async step({ task, context = {}, memory = {} }) {
    const systemPrompt = PromptBuilder.system({
      role:    this.role,
      context,
      memory,
      tools:   ToolRegistry.describe(this.tools),
    });

    this._history.push({ role: 'user', content: task });

    let round = 0;
    let response;

    // Tool-use loop: keep calling the LLM until it produces a final answer
    while (round++ < MAX_TOOL_ROUNDS) {
      response = await this._callLLM(systemPrompt, this._history);

      if (!response.toolCalls?.length) break;

      // Execute each tool call and append observations
      const observations = await ActionExecutor.run(response.toolCalls, context);
      for (const obs of observations) {
        this._history.push({ role: 'tool', content: JSON.stringify(obs) });
      }
    }

    const assistantMessage = response?.content ?? '(no response)';
    this._history.push({ role: 'assistant', content: assistantMessage });

    return {
      output:      this._parseOutput(assistantMessage),
      observations: this._history.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)),
      shouldStop:  assistantMessage.includes('[DONE]'),
    };
  }

  reset() { this._history = []; }
  get history() { return [...this._history]; }

  // ── Stub: replace with real LLM client ───────────────────────────────────────

  async _callLLM(system, messages) {
    // PSEUDO: const response = await llmClient.chat({ system, messages, tools: ... });
    return { content: 'PSEUDO_RESPONSE [DONE]', toolCalls: [] };
  }

  _parseOutput(text) {
    // Try to extract a structured JSON block from the model reply
    const match = text.match(/```json\n([\s\S]*?)\n```/);
    if (match) {
      try { return JSON.parse(match[1]); } catch { /* fall through */ }
    }
    return { text };
  }
}

module.exports = ReasoningLoop;
