// Top-level app state: connection, LLM config and install info, persisted in IndexedDB.

import { kv, K } from '../lib/kv.ts';
import { Mcp } from '../lib/n8n/mcp.ts';
import { completeLogin, logout, type Connection } from '../lib/n8n/oauth.ts';
import type { LlmConfig } from '../lib/llm/types.ts';
import { completeOpenRouterLogin } from '../lib/llm/openrouter.ts';
import type { InstallInfo } from '../lib/n8n/install.ts';
import { CORE_VERSION } from '../lib/n8n/core/schema.ts';

class AppState {
  ready = $state(false);
  conn = $state<Connection | null>(null);
  llm = $state<LlmConfig | null>(null);
  install = $state<InstallInfo | null>(null);
  error = $state<string | null>(null);
  private mcpClient: Mcp | null = null;

  readonly onboarded = $derived(!!(this.conn && this.llm && this.install));

  async init() {
    try {
      const fromOpenRouter = await completeOpenRouterLogin();
      if (fromOpenRouter) await kv.set(K.llm, fromOpenRouter);
      const fromLogin = await completeLogin();
      this.conn = fromLogin ?? (await kv.get<Connection>(K.n8nConn)) ?? null;
      this.llm = (await kv.get<LlmConfig>(K.llm)) ?? null;
      this.install = (await kv.get<InstallInfo>(K.install)) ?? null;
      if (this.install && this.conn && this.install.base !== this.conn.base) this.install = null;
      // Older core: rerun install, which upgrades the workflows in place (ids and keys are kept).
      if (this.install && this.install.version < CORE_VERSION) this.install = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.ready = true;
    }
  }

  get mcp(): Mcp {
    if (!this.conn) throw new Error('Not connected to n8n.');
    if (!this.mcpClient || this.mcpClient.conn.base !== this.conn.base) this.mcpClient = new Mcp($state.snapshot(this.conn) as Connection);
    return this.mcpClient;
  }

  async saveLlm(cfg: LlmConfig) {
    await kv.set(K.llm, cfg);
    this.llm = cfg;
  }

  async saveInstall(info: InstallInfo) {
    await kv.set(K.install, info);
    await kv.set(K.api, { url: info.apiUrl });
    this.install = info;
  }

  async disconnect() {
    await logout();
    await Promise.all([kv.del(K.install), kv.del(K.api), kv.del(K.setupDone)]);
    this.conn = null;
    this.install = null;
    this.mcpClient = null;
  }
}

export const app = new AppState();
