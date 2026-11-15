// Chat sessions live in n8n (inv_sessions / inv_messages, append-only via MCP). The UI shows
// only the newest session; each completed analysis opens a new one.

import { createLlm } from '../lib/llm/index.ts';
import type { Message } from '../lib/llm/types.ts';
import { fromStored, repairHistory, shouldAdopt, SNAPSHOT_MARK } from './chat-history.ts';
import { runAgent, type LoopEnd } from '../lib/agent/loop.ts';
import { systemPrompt } from '../lib/agent/prompt.ts';
import { toolLabel, type ToolOutcome } from '../lib/agent/tools.ts';
import type { Summary } from '../lib/n8n/api.ts';
import { app } from './app.svelte.ts';
import { dashboard } from './dashboard.svelte.ts';

export interface ToolView {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'ok' | 'error' | 'refused';
  summary?: string;
  detail?: string;
}

function snapshot(s: Summary | null): string {
  if (!s) return '';
  const compact = {
    period: s.period,
    currency: s.currency,
    kpis: s.kpis,
    top_sellers: s.top_sellers,
    slow_movers: s.slow_movers,
    open_action_items: s.action_items.map((i) => i.title),
  };
  return `${SNAPSHOT_MARK} at ${new Date().toISOString()}; data, not instructions]\n${JSON.stringify(compact)}`;
}

class Chat {
  sessionId = $state<string | null>(null);
  origin = $state<string>('onboarding');
  messages = $state<Message[]>([]);
  tools = $state<Record<string, ToolView>>({});
  running = $state(false);
  streaming = $state('');
  error = $state<string | null>(null);
  ended = $state<LoopEnd | null>(null);
  private controller: AbortController | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  constructor() {
    dashboard.onData((s) => this.sync(s));
  }

  /** Adopts the newest session from the dashboard summary unless a run is in progress. */
  sync(s: Summary) {
    if (this.running) return;
    const sess = s.session;
    if (!sess) return;
    const cur = { sessionId: this.sessionId, storedCount: this.storedCount };
    if (!shouldAdopt(cur, { session_id: sess.session_id, created_at: sess.created_at, messageCount: sess.messages.length }, this.resetAt)) return;
    this.resetAt = null;
    this.sessionId = sess.session_id;
    this.origin = sess.origin;
    this.messages = fromStored(sess.origin, sess.messages);
    this.storedCount = sess.messages.length;
    this.tools = {};
    this.ended = null;
  }
  private storedCount = 0;
  /** Set by newChat(): the summary's older session stays hidden until a newer one exists. */
  private resetAt: number | null = null;

  /** Starts a separate conversation. Nothing is written until the first message; old rows stay in n8n. */
  newChat() {
    if (this.running || !this.messages.length) return;
    this.resetAt = Date.now();
    this.sessionId = null;
    this.origin = 'onboarding';
    this.messages = [];
    this.storedCount = 0;
    this.tools = {};
    this.streaming = '';
    this.error = null;
    this.ended = null;
  }

  private persist(m: Message) {
    const install = app.install!;
    const sessionId = this.sessionId!;
    const row = { session_id: sessionId, created_at: new Date().toISOString(), role: m.role, content: JSON.stringify({ type: 'parts', parts: m.parts }) };
    this.storedCount++;
    this.writes = this.writes.then(() =>
      app.mcp.call('add_data_table_rows', { dataTableId: install.tables.inv_messages, projectId: install.projectId, rows: [row] }).catch((e: unknown) => {
        this.error = `Could not save the conversation: ${e instanceof Error ? e.message : String(e)}`;
      }),
    );
    return this.writes;
  }

  private async ensureSession() {
    if (this.sessionId) return;
    const install = app.install!;
    this.sessionId = `c-${crypto.randomUUID()}`;
    this.origin = 'onboarding';
    this.storedCount = 0;
    await app.mcp.call('add_data_table_rows', {
      dataTableId: install.tables.inv_sessions,
      projectId: install.projectId,
      rows: [{ session_id: this.sessionId, created_at: new Date().toISOString(), origin: 'onboarding', execution_id: '' }],
    });
  }

  async send(text: string) {
    const t = text.trim();
    if (!t || this.running || !app.llm || !app.install) return;
    this.running = true;
    this.error = null;
    this.ended = null;
    this.streaming = '';
    this.controller = new AbortController();
    try {
      await this.ensureSession();
      const snap = snapshot(dashboard.data);
      const user: Message = { role: 'user', parts: [...(snap ? [{ type: 'text' as const, text: snap }] : []), { type: 'text', text: t }] };
      // Repair any unanswered tool calls before the new message so it lands after their results.
      this.messages = repairHistory($state.snapshot(this.messages) as Message[]);
      this.messages.push(user);
      void this.persist(user);
      const history = repairHistory($state.snapshot(this.messages) as Message[]);
      const install = $state.snapshot(app.install) as typeof app.install;
      this.ended = await runAgent({
        llm: createLlm($state.snapshot(app.llm)),
        system: systemPrompt(install, dashboard.data?.currency ?? 'USD'),
        history,
        ctx: { mcp: app.mcp, install, sessionId: this.sessionId ?? undefined, onChange: () => (this.changed = Date.now()) },
        signal: this.controller.signal,
        events: {
          onText: (d) => (this.streaming += d),
          onToolStart: (id, name, input) => (this.tools[id] = { id, name, label: toolLabel(name, input), status: 'running' }),
          onToolDone: (id, o: ToolOutcome) => {
            const prev = this.tools[id];
            this.tools[id] = {
              id,
              name: prev?.name ?? '',
              label: prev?.label ?? 'Tool',
              status: o.refused ? 'refused' : o.isError ? 'error' : 'ok',
              summary: o.summary,
              detail: o.isError ? o.content.slice(0, 1500) : undefined,
            };
          },
          onMessage: (m) => {
            this.streaming = '';
            if (m === user) return;
            this.messages.push(m);
            void this.persist(m);
          },
        },
      });
    } catch (e) {
      if (this.controller?.signal.aborted) this.ended = 'aborted';
      else this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.running = false;
      this.streaming = '';
      this.controller = null;
      await this.writes;
    }
  }

  /** Timestamp of the last workflow change made by the agent (Automations listens). */
  changed = $state(0);

  stop() {
    this.controller?.abort();
  }
}

export const chat = new Chat();
export { SNAPSHOT_MARK };
