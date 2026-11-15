// Dashboard data: refreshed only on events (open, focus, push, own action completing).

import { Api, type ActionItem, type Period, type Summary } from '../lib/n8n/api.ts';
import { draftUrl } from '../lib/draft.ts';
import { app } from './app.svelte.ts';

const FOCUS_MIN_GAP = 15_000;

class Dashboard {
  period = $state<Period>('30d');
  data = $state<Summary | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  busy = $state<Record<string, 'run' | 'draft' | 'dismiss'>>({});
  results = $state<Record<string, { ok: boolean; text: string }>>({});
  analysing = $state(false);
  private last = 0;
  private seq = 0;
  /** Listeners (e.g. chat) that want to know when fresh data arrived. */
  private listeners = new Set<(s: Summary) => void>();

  get api(): Api {
    if (!app.install) throw new Error('Not installed.');
    return new Api(app.install.apiUrl);
  }

  onData(fn: (s: Summary) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async refresh(reason: 'open' | 'focus' | 'push' | 'action' | 'period' | 'manual' = 'manual') {
    if (reason === 'focus' && Date.now() - this.last < FOCUS_MIN_GAP) return;
    if (!app.install) return;
    const seq = ++this.seq;
    this.loading = true;
    this.last = Date.now();
    try {
      const s = await this.api.summary(this.period);
      if (seq !== this.seq) return;
      this.data = s;
      this.error = null;
      if (s.session?.origin === 'analysis') this.analysing = false;
      for (const fn of this.listeners) fn(s);
    } catch (e) {
      if (seq === this.seq) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (seq === this.seq) this.loading = false;
    }
  }

  setPeriod(p: Period) {
    if (p === this.period) return;
    this.period = p;
    void this.refresh('period');
  }

  private finish(item: ActionItem) {
    if (this.data) this.data.action_items = this.data.action_items.filter((i) => i.item_id !== item.item_id);
    delete this.busy[item.item_id];
  }

  /** One tap: run the registered workflow, or open the draft in the user's app and mark done. */
  async act(item: ActionItem) {
    if (this.busy[item.item_id]) return;
    if (item.kind === 'draft') {
      this.busy[item.item_id] = 'draft';
      window.open(draftUrl({ channel: item.draft_channel ?? 'email', to: item.draft_to, subject: item.draft_subject, body: item.draft_body }), '_blank', 'noopener');
      try {
        await this.api.done(item.item_id);
        this.finish(item);
      } catch (e) {
        delete this.busy[item.item_id];
        this.results[item.item_id] = { ok: false, text: e instanceof Error ? e.message : String(e) };
      }
      return;
    }
    this.busy[item.item_id] = 'run';
    try {
      const r = await this.api.run(item.item_id);
      this.results[item.item_id] = { ok: true, text: `Done · ${r.output.length} result${r.output.length === 1 ? '' : 's'}` };
      this.finish(item);
      void this.refresh('action');
    } catch (e) {
      delete this.busy[item.item_id];
      this.results[item.item_id] = { ok: false, text: e instanceof Error ? e.message : String(e) };
    }
  }

  async dismiss(item: ActionItem) {
    if (this.busy[item.item_id]) return;
    this.busy[item.item_id] = 'dismiss';
    try {
      await this.api.dismiss(item.item_id);
      this.finish(item);
    } catch (e) {
      delete this.busy[item.item_id];
      this.results[item.item_id] = { ok: false, text: e instanceof Error ? e.message : String(e) };
    }
  }

  async analyze() {
    this.analysing = true;
    try {
      await this.api.analyze();
    } catch (e) {
      this.analysing = false;
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

export const dashboard = new Dashboard();
