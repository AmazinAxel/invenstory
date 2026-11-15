// Safety gate: every LLM-built workflow is checked node by node after each create/update
// and before every publish, test, execute or registration. Workflows never send messages
// or emails; writes to business systems are allowed.

import { BUSINESS_NODES, CODE_NETWORK, CORE_NODES, MESSAGING_NODES, READ_VERB, REFUSED_NODES, SEND_VERB } from './policy.ts';

export interface GateNode {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  disabled?: boolean;
}

export interface GateWorkflow {
  id: string;
  name: string;
  nodes: GateNode[];
}

export interface Violation {
  node: string;
  type: string;
  reason: string;
}

export interface GateContext {
  /** Workflow ids that may be called as sub-workflows without further checks (core analyze/notify). */
  trustedTargets: Set<string>;
  /** Loads another workflow so a sub-workflow target can be gated too. */
  load: (id: string) => Promise<GateWorkflow>;
}

const isExpr = (v: unknown) => typeof v === 'string' && v.trim().startsWith('=');

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Resource-locator or plain id of an Execute Sub-workflow target, or null if dynamic/unknown. */
export function subWorkflowTarget(p: Record<string, unknown>): string | null {
  if (p.source && p.source !== 'database') return null;
  const w = p.workflowId;
  if (typeof w === 'string') return isExpr(w) || !w ? null : w;
  if (w && typeof w === 'object') {
    const v = (w as { value?: unknown }).value;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string' && v && !isExpr(v)) return v;
  }
  return null;
}

/** Checks one node; sub-workflow targets are returned for the caller to follow. */
export function checkNode(n: GateNode): { violation?: string; target?: string | null } {
  const t = n.type;
  const p = n.parameters ?? {};
  if (REFUSED_NODES.has(t)) return { violation: 'this node type is never allowed in Invenstory workflows' };

  if (t === 'n8n-nodes-base.code' || t === '@n8n/n8n-nodes-langchain.toolCode') {
    const src = [p.jsCode, p.pythonCode, p.code].map(str).join('\n');
    const hit = CODE_NETWORK.find((re) => re.test(src));
    return hit ? { violation: `Code may not load modules or reach the network (matched ${hit.source})` } : {};
  }

  if (t === 'n8n-nodes-base.httpRequest' || t === 'n8n-nodes-base.httpRequestTool') {
    const method = p.method === undefined ? 'GET' : p.method;
    if (method !== 'GET') return { violation: `HTTP Request must use GET (found ${isExpr(method) ? 'an expression' : String(method)})` };
    return {};
  }

  if (t === 'n8n-nodes-base.executeWorkflow' || t === '@n8n/n8n-nodes-langchain.toolWorkflow') {
    const target = subWorkflowTarget(p);
    if (!target) return { violation: 'Execute Sub-workflow must name a fixed workflow id (no expressions, files or inline JSON)' };
    return { target };
  }

  if (CORE_NODES.has(t)) return {};

  const op = str(p.operation);
  const resource = str(p.resource);
  if (BUSINESS_NODES.has(t)) {
    if (t.endsWith('Trigger')) return {};
    if (isExpr(p.operation) || isExpr(p.resource)) return { violation: 'operation must not be an expression' };
    if (SEND_VERB.test(op) || (SEND_VERB.test(resource) && op && !READ_VERB.test(op))) {
      return { violation: `operation "${resource ? resource + '/' : ''}${op}" would send a message` };
    }
    return {};
  }

  if (MESSAGING_NODES.has(t)) {
    if (t.endsWith('Trigger') || t === 'n8n-nodes-base.emailReadImap') return {};
    if (!op || isExpr(p.operation)) return { violation: 'messaging nodes may only read; set an explicit read operation' };
    if (!READ_VERB.test(op)) return { violation: `messaging nodes may only read (found "${op}")` };
    return {};
  }

  return { violation: 'unknown node type; Invenstory only allows reviewed node types' };
}

/** Gates a workflow and every non-core sub-workflow it calls (cycle-safe, depth-limited). */
export async function checkWorkflow(wf: GateWorkflow, ctx: GateContext, seen = new Set<string>(), depth = 0): Promise<Violation[]> {
  seen.add(wf.id);
  const out: Violation[] = [];
  for (const n of wf.nodes) {
    if (n.disabled) continue;
    const r = checkNode(n);
    if (r.violation) out.push({ node: n.name, type: n.type, reason: r.violation });
    if (r.target && !ctx.trustedTargets.has(r.target) && !seen.has(r.target)) {
      if (depth >= 3) {
        out.push({ node: n.name, type: n.type, reason: 'sub-workflow nesting is too deep' });
        continue;
      }
      let sub: GateWorkflow;
      try {
        sub = await ctx.load(r.target);
      } catch {
        out.push({ node: n.name, type: n.type, reason: `sub-workflow ${r.target} could not be loaded` });
        continue;
      }
      for (const v of await checkWorkflow(sub, ctx, seen, depth + 1)) out.push({ ...v, node: `${sub.name} › ${v.node}` });
    }
  }
  return out;
}

export function describeViolations(v: Violation[]): string {
  return [
    'Refused by the Invenstory safety gate. Invenstory workflows never send messages or emails, and only reviewed node types are allowed.',
    ...v.map((x) => `- ${x.node} (${x.type}): ${x.reason}`),
    'Change the workflow so that these nodes are removed or replaced, then try again. To contact someone, propose a draft action item instead.',
  ].join('\n');
}
