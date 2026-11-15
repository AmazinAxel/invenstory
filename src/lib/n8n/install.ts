// Detects, installs and upgrades Invenstory inside the user's n8n: data tables, core
// workflows (validate → create → publish), error-workflow wiring and config rows.
// Works on any MCP-like client so the same code runs in the app and in tests.

import { CORE_VERSION, TABLES, TABLE_NAMES, WORKFLOWS, type CoreWorkflow, type TableIds, type TableName } from './core/schema.ts';
import { BUILD_SUMMARY_CODE, SUMMARY_SALES_SINCE, apiWorkflow, errorWorkflow, notifyWorkflow } from './core/templates.ts';
import { extractVapid, signPushCode } from './core/code.ts';
import { MODEL_CHOICES, analyzeDirectWorkflow, analyzeWorkflow, type DirectModel, type ModelChoice } from './core/analyze.ts';

export interface McpLike {
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

export interface InstallInfo {
  base: string;
  projectId: string;
  version: number;
  apiUrl: string;
  tables: TableIds;
  workflows: Partial<Record<CoreWorkflow, string>>;
  origins: string[];
  vapidPublicKey: string;
  /** "Provider: model" of an analysis this device set up on the owner's own model key (display only). */
  analysisModel?: string;
}

export interface Detected {
  projectId: string;
  tables: Partial<TableIds>;
  workflows: Partial<Record<CoreWorkflow, string>>;
}

export type Step = (message: string) => void;

interface WorkflowDetails {
  workflow: { id: string; name: string; active?: boolean; nodes: { name: string; type: string; parameters: Record<string, unknown> }[]; settings?: Record<string, unknown> };
}

const CORE_NAMES = Object.entries(WORKFLOWS) as [CoreWorkflow, string][];

export async function detect(mcp: McpLike): Promise<Detected> {
  const projects = await mcp.call<{ data: { id: string; type: string }[] }>('search_projects', {});
  const project = projects.data.find((p) => p.type === 'personal') ?? projects.data[0];
  if (!project) throw new Error('No n8n project is available to this login.');

  const dts = await mcp.call<{ data: { id: string; name: string; projectId: string }[] }>('search_data_tables', { query: 'inv_', limit: 100 });
  const tables: Partial<TableIds> = {};
  for (const t of dts.data) if ((TABLE_NAMES as string[]).includes(t.name) && t.projectId === project.id) tables[t.name as TableName] = t.id;

  const wfs = await mcp.call<{ data: { id: string; name: string; isArchived?: boolean }[] }>('search_workflows', { query: 'invenstory', limit: 100 });
  const workflows: Partial<Record<CoreWorkflow, string>> = {};
  for (const [key, name] of CORE_NAMES) {
    const w = wfs.data.find((x) => x.name === name && !x.isArchived);
    if (w) workflows[key] = w.id;
  }
  return { projectId: project.id, tables, workflows };
}

/** Reads every row of a table through MCP (pages of 100). */
export async function readRows<T>(mcp: McpLike, projectId: string, tableId: string, extra: Record<string, unknown> = {}): Promise<T[]> {
  const rows: T[] = [];
  for (let skip = 0; ; skip += 100) {
    const res = await mcp.call<{ rows: T[]; count: number }>('get_data_table_rows', { dataTableId: tableId, projectId, limit: 100, skip, ...extra });
    rows.push(...res.rows);
    if (res.rows.length < 100 || rows.length >= res.count) return rows;
  }
}

/** inv_config is append-only: the newest row per key wins. */
export async function readConfig(mcp: McpLike, projectId: string, tableId: string): Promise<Record<string, string>> {
  const rows = await readRows<{ key: string; value: string; id: number }>(mcp, projectId, tableId);
  const out: Record<string, string> = {};
  for (const r of rows.sort((a, b) => a.id - b.id)) out[r.key] = r.value;
  return out;
}

async function appendConfig(mcp: McpLike, d: { projectId: string; tableId: string }, values: Record<string, string>) {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value }));
  if (rows.length) await mcp.call('add_data_table_rows', { dataTableId: d.tableId, projectId: d.projectId, rows });
}

async function createWorkflow(mcp: McpLike, projectId: string, name: string, description: string, code: string): Promise<string> {
  const v = await mcp.call<{ valid: boolean; errors?: unknown[] }>('validate_workflow', { code });
  if (!v.valid) throw new Error(`${name} failed validation: ${JSON.stringify(v.errors ?? v).slice(0, 500)}`);
  const c = await mcp.call<{ workflowId: string }>('create_workflow_from_code', {
    code,
    name,
    description,
    projectId,
    versionName: `Invenstory core v${CORE_VERSION}`,
  });
  await mcp.call('publish_workflow', { workflowId: c.workflowId });
  return c.workflowId;
}

async function setErrorWorkflow(mcp: McpLike, workflowId: string, errorId: string) {
  await mcp.call('update_workflow', { workflowId, operations: [{ type: 'setWorkflowSettings', settings: { errorWorkflow: errorId } }] });
}

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function generateVapid(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64url(raw), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
}

/** Webhook path and allowed origins of an installed invenstory-api workflow. */
export async function apiDetails(mcp: McpLike, workflowId: string): Promise<{ path: string; origins: string[]; hooks: string[] }> {
  const d = await mcp.call<WorkflowDetails>('get_workflow_details', { workflowId });
  const hooks = d.workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  const path = String(hooks[0]?.parameters.path ?? '');
  if (!path) throw new Error('invenstory-api has no webhook path.');
  const opts = (hooks[0]?.parameters.options ?? {}) as { allowedOrigins?: string };
  const origins = String(opts.allowedOrigins ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { path, origins, hooks: hooks.map((h) => h.name) };
}

export interface InstallOptions {
  base: string;
  origin: string;
  baseCurrency: string;
  onStep?: Step;
}

/** Idempotent: creates whatever is missing and reuses everything that exists. */
export async function install(mcp: McpLike, o: InstallOptions): Promise<InstallInfo> {
  const step = o.onStep ?? (() => {});
  step('Checking your n8n…');
  const det = await detect(mcp);
  const { projectId } = det;

  const tables = { ...det.tables } as TableIds;
  for (const name of TABLE_NAMES) {
    if (tables[name]) continue;
    step(`Creating table ${name}…`);
    const cols = Object.entries(TABLES[name]).map(([n, type]) => ({ name: n, type }));
    const t = await mcp.call<{ id: string }>('create_data_table', { projectId, name, columns: cols });
    tables[name] = t.id;
  }
  const cfgTable = { projectId, tableId: tables.inv_config };
  const config = await readConfig(mcp, projectId, tables.inv_config);
  const newConfig: Record<string, string> = {};
  const workflows = { ...det.workflows };

  let vapidPublicKey = config.vapid_public_key ?? '';
  if (!workflows.notify || !vapidPublicKey) {
    step('Installing notifications…');
    const vapid = await generateVapid();
    vapidPublicKey = vapid.publicKey;
    if (workflows.notify) await mcp.call('archive_workflow', { workflowId: workflows.notify });
    workflows.notify = await createWorkflow(
      mcp,
      projectId,
      WORKFLOWS.notify,
      'Invenstory core: records an event and sends a Web Push signal to subscribed devices.',
      notifyWorkflow({ tables, vapidPrivateJwk: vapid.privateJwk, vapidPublicKey }),
    );
    newConfig.vapid_public_key = vapidPublicKey;
  }

  if (!workflows.error) {
    step('Installing failure alerts…');
    workflows.error = await createWorkflow(
      mcp,
      projectId,
      WORKFLOWS.error,
      'Invenstory core: error workflow that logs failures and notifies devices.',
      errorWorkflow({ notifyId: workflows.notify }),
    );
  }

  let path: string;
  let origins: string[];
  if (!workflows.api) {
    step('Installing the dashboard API…');
    path = `inv-${randomHex(16)}`;
    origins = [o.origin];
    workflows.api = await createWorkflow(
      mcp,
      projectId,
      WORKFLOWS.api,
      'Invenstory core: secret-path API for the Invenstory app (reads, item actions, analysis).',
      apiWorkflow({ tables, path, origins }),
    );
    await setErrorWorkflow(mcp, workflows.api, workflows.error);
  } else {
    const d = await apiDetails(mcp, workflows.api);
    path = d.path;
    origins = d.origins;
    if (!origins.includes(o.origin)) {
      step('Allowing this app address…');
      origins = [...origins, o.origin];
      await mcp.call('update_workflow', {
        workflowId: workflows.api,
        operations: d.hooks.map((nodeName) => ({ type: 'setNodeParameter', nodeName, path: '/options/allowedOrigins', value: origins.join(',') })),
      });
      await mcp.call('publish_workflow', { workflowId: workflows.api });
    }
  }

  const installed = Number(config.version || CORE_VERSION);
  // Workflows created above are already current; only the ones that existed get upgraded.
  const existing = { notify: newConfig.vapid_public_key ? undefined : workflows.notify, api: det.workflows.api };
  if (installed < CORE_VERSION && (existing.notify || existing.api)) {
    step('Updating Invenstory…');
    await upgradeCore(mcp, existing, installed);
  }
  if (!config.version || installed < CORE_VERSION) newConfig.version = String(CORE_VERSION);
  if (!config.base_currency) newConfig.base_currency = o.baseCurrency.toUpperCase();
  if (config.notify_workflow_id !== workflows.notify) newConfig.notify_workflow_id = workflows.notify;
  await appendConfig(mcp, cfgTable, newConfig);

  step('Done.');
  return {
    base: o.base,
    projectId,
    version: CORE_VERSION,
    apiUrl: `${o.base}/webhook/${path}`,
    tables,
    workflows,
    origins,
    vapidPublicKey,
  };
}

/** In-place upgrades of installed core workflows (ids and VAPID keys are kept). */
async function upgradeCore(mcp: McpLike, workflows: Partial<Record<CoreWorkflow, string>>, from: number) {
  if (from < 2 && workflows.notify) {
    // v2: Sign Push skips duplicate subscription rows.
    const d = await mcp.call<WorkflowDetails>('get_workflow_details', { workflowId: workflows.notify });
    const node = d.workflow.nodes.find((n) => n.name === 'Sign Push');
    const keys = node && extractVapid(String(node.parameters.jsCode ?? ''));
    if (!keys) throw new Error('Could not upgrade invenstory-notify: signing node not found.');
    await mcp.call('update_workflow', {
      workflowId: workflows.notify,
      operations: [{ type: 'setNodeParameter', nodeName: 'Sign Push', path: '/jsCode', value: signPushCode(keys.privateJwk, keys.publicKey) }],
    });
    await mcp.call('publish_workflow', { workflowId: workflows.notify });
  }
  if (from < 3 && workflows.api) {
    // v3: the summary reads the previous period too and returns per-product sales (revenue heatmap).
    await mcp.call('update_workflow', {
      workflowId: workflows.api,
      operations: [
        { type: 'setNodeParameter', nodeName: 'Summary Sales', path: '/filters/conditions/0/keyValue', value: `=${SUMMARY_SALES_SINCE}` },
        { type: 'setNodeParameter', nodeName: 'Build Summary', path: '/jsCode', value: BUILD_SUMMARY_CODE },
      ],
    });
    await mcp.call('publish_workflow', { workflowId: workflows.api });
  }
}

/** True when everything an install needs already exists (used to skip the install step on a new device). */
export function isComplete(d: Detected): boolean {
  return TABLE_NAMES.every((n) => d.tables[n]) && !!d.workflows.api && !!d.workflows.notify && !!d.workflows.error;
}

// ---------- analysis (needs an LLM credential created in n8n) ----------

export interface CredentialInfo {
  id: string;
  name: string;
  type: string;
}

export async function listCredentials(mcp: McpLike): Promise<CredentialInfo[]> {
  const res = await mcp.call<{ data: Record<string, unknown>[] }>('list_credentials', {});
  return (res.data ?? []).map((c) => ({ id: String(c.id), name: String(c.name ?? c.id), type: String(c.type ?? c.credentialType ?? '') }));
}

/** Credentials Invenstory can run analysis with, best choice first. */
export function analysisChoices(creds: CredentialInfo[]): (CredentialInfo & { choice: ModelChoice })[] {
  return MODEL_CHOICES.flatMap((choice) => creds.filter((c) => c.type === choice.credentialType).map((c) => ({ ...c, choice })));
}

export async function analysisCredentials(mcp: McpLike): Promise<(CredentialInfo & { choice: ModelChoice })[]> {
  return analysisChoices(await listCredentials(mcp));
}

export async function setupAnalysis(
  mcp: McpLike,
  info: InstallInfo,
  credential: CredentialInfo,
  model: string,
  onStep: Step = () => {},
): Promise<InstallInfo> {
  const choice = MODEL_CHOICES.find((c) => c.credentialType === credential.type);
  if (!choice) throw new Error(`Analysis cannot use a ${credential.type} credential.`);
  if (!info.workflows.notify || !info.workflows.error) throw new Error('Install Invenstory first.');
  onStep('Installing analysis…');
  const code = analyzeWorkflow({
    tables: info.tables,
    notifyId: info.workflows.notify,
    choice,
    credential: { id: credential.id, name: credential.name },
    model: model || choice.defaultModel,
  });
  const old = info.workflows.analyze;
  const id = await createWorkflow(mcp, info.projectId, WORKFLOWS.analyze, 'Invenstory core: analyses stock and sales and proposes action items.', code);
  await setErrorWorkflow(mcp, id, info.workflows.error);
  if (old && old !== id) await mcp.call('archive_workflow', { workflowId: old });
  await appendConfig(mcp, { projectId: info.projectId, tableId: info.tables.inv_config }, {
    analyze_workflow_id: id,
    analysis_model: `${choice.label}: ${model || choice.defaultModel || 'n8n default'}`,
  });
  onStep('Analysis ready.');
  return { ...info, workflows: { ...info.workflows, analyze: id } };
}

// ---------- analysis on the owner's OpenRouter login (no n8n credential) ----------

const redact = (text: string, secret: string) => (secret ? text.split(secret).join('[key]') : text);

/**
 * Installs invenstory-analyze so that n8n calls the model itself with the owner's key (see
 * analyzeDirectWorkflow). The key is written into that one workflow and nowhere else: not into
 * inv_config, not into an error message.
 */
export async function setupDirectAnalysis(mcp: McpLike, info: InstallInfo, direct: DirectModel, onStep: Step = () => {}): Promise<InstallInfo> {
  if (!info.workflows.notify || !info.workflows.error) throw new Error('Install Invenstory first.');
  onStep('Installing analysis…');
  try {
    const code = analyzeDirectWorkflow({ tables: info.tables, notifyId: info.workflows.notify, direct });
    const old = info.workflows.analyze;
    const id = await createWorkflow(mcp, info.projectId, WORKFLOWS.analyze, 'Invenstory core: analyses stock and sales and proposes action items.', code);
    await setErrorWorkflow(mcp, id, info.workflows.error);
    if (old && old !== id) await mcp.call('archive_workflow', { workflowId: old });
    const analysisModel = `${direct.label}: ${direct.model}`;
    await appendConfig(mcp, { projectId: info.projectId, tableId: info.tables.inv_config }, { analyze_workflow_id: id, analysis_model: analysisModel });
    onStep('Analysis ready.');
    return { ...info, workflows: { ...info.workflows, analyze: id }, analysisModel };
  } catch (e) {
    // n8n can quote the submitted workflow code in an error message: keep the key out of the UI.
    throw new Error(redact(e instanceof Error ? e.message : String(e), direct.apiKey));
  }
}

/**
 * Uses an analysis workflow that already exists in n8n (set up from another device, or left by
 * a setup that was interrupted) instead of creating a second one. Returns null when there is none.
 */
export async function adoptAnalysis(mcp: McpLike, info: InstallInfo): Promise<InstallInfo | null> {
  const wfs = await mcp.call<{ data: { id: string; name: string; isArchived?: boolean }[] }>('search_workflows', { query: WORKFLOWS.analyze, limit: 20 });
  const found = wfs.data.find((w) => w.name === WORKFLOWS.analyze && !w.isArchived)?.id;
  if (!found) return null;
  const config = await readConfig(mcp, info.projectId, info.tables.inv_config);
  if (config.analyze_workflow_id !== found) {
    // An interrupted setup: finish its last two steps so "run analysis" and failure alerts work.
    if (info.workflows.error) await setErrorWorkflow(mcp, found, info.workflows.error);
    await appendConfig(mcp, { projectId: info.projectId, tableId: info.tables.inv_config }, { analyze_workflow_id: found });
  }
  return { ...info, workflows: { ...info.workflows, analyze: found } };
}
