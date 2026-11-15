// Guided setup after install: the dashboard stays hidden until there is stock data and at least
// one active Invenstory automation. Checked on open, when returning to the tab, and after chat runs.

import { kv, K } from '../lib/kv.ts';
import { listCredentials, type CredentialInfo } from '../lib/n8n/install.ts';
import { NAME_PREFIX } from '../lib/agent/tools.ts';
import { setupComplete, type Flow } from '../lib/setup.ts';
import { app } from './app.svelte.ts';
import { dashboard } from './dashboard.svelte.ts';

class Setup {
  /** null until the stored flag has been read. */
  done = $state<boolean | null>(null);
  creds = $state<CredentialInfo[]>([]);
  flows = $state<Flow[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  private checking: Promise<void> | null = null;

  async load() {
    this.done = (await kv.get<boolean>(K.setupDone)) ?? false;
    if (!this.done) await this.check();
  }

  check(): Promise<void> {
    this.checking ??= this.run().finally(() => (this.checking = null));
    return this.checking;
  }

  private async run() {
    if (!app.install) return;
    this.loading = true;
    try {
      const mcp = app.mcp;
      const [creds, w] = await Promise.all([
        listCredentials(mcp),
        mcp.call<{ data: (Flow & { isArchived?: boolean })[] }>('search_workflows', { query: 'Invenstory', limit: 100 }),
        dashboard.refresh('manual'),
      ]);
      this.creds = creds;
      this.flows = w.data.filter((f) => f.name.startsWith(NAME_PREFIX) && !f.isArchived);
      const k = dashboard.data?.kpis;
      if (k && setupComplete(k.products, k.units_sold, this.flows)) {
        await kv.set(K.setupDone, true);
        this.done = true;
      }
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}

export const setup = new Setup();
