// Analysis without a hand-made n8n credential. When the owner is connected through OpenRouter,
// invenstory-analyze is installed by itself with that key, so insights and notifications keep
// coming while the app is closed. Other connections keep the credential picker in Automations.

import { directModel } from '../lib/n8n/core/analyze.ts';
import { adoptAnalysis, setupDirectAnalysis, type InstallInfo } from '../lib/n8n/install.ts';
import type { LlmConfig } from '../lib/llm/types.ts';
import { app } from './app.svelte.ts';
import { dashboard } from './dashboard.svelte.ts';

class Analysis {
  busy = $state(false);
  step = $state('');
  error = $state<string | null>(null);
  private running: Promise<void> | null = null;

  /** The owner's OpenRouter connection when n8n may call it for analysis, otherwise null. */
  readonly direct = $derived(directModel(app.llm));
  readonly installed = $derived(!!app.install?.workflows.analyze);

  /**
   * Sets analysis up when it is missing and needs nothing from the owner. Cheap to call often:
   * it does nothing once installed, and never retries a failure by itself (n8n rate-limits MCP).
   */
  ensure(): Promise<void> {
    if (this.installed || !this.direct || this.error || !app.install || !app.conn) return Promise.resolve();
    return this.start(undefined, false);
  }

  /** Installs again with the current connection: after a failure, a new login, or to change the model. */
  setup(model?: string): Promise<void> {
    return this.start(model, true);
  }

  private start(model: string | undefined, fresh: boolean): Promise<void> {
    this.running ??= this.run(model, fresh).finally(() => (this.running = null));
    return this.running;
  }

  private async run(model: string | undefined, fresh: boolean) {
    const install = app.install ? ($state.snapshot(app.install) as InstallInfo) : null;
    const direct = directModel(app.llm ? ($state.snapshot(app.llm) as LlmConfig) : null);
    if (!install || !direct) return;
    this.busy = true;
    this.error = null;
    this.step = '';
    try {
      const mcp = app.mcp;
      // Another device may already have set analysis up: use that one instead of making a second.
      const adopted = fresh ? null : await adoptAnalysis(mcp, install);
      const info = adopted ?? (await setupDirectAnalysis(mcp, install, model?.trim() ? { ...direct, model: model.trim() } : direct, (m) => (this.step = m)));
      await app.saveInstall(info);
      void dashboard.refresh('action');
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
      this.step = '';
    }
  }
}

export const analysis = new Analysis();
