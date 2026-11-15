// Terminal access to an Invenstory n8n instance for development and live verification.
// Talks to n8n's instance-level MCP server directly (no CORS outside the browser) with an
// MCP access token instead of the app's browser OAuth login.
//
// Setup: in n8n, Settings → Instance-level MCP → create an access token. Then:
//   export N8N_BASE=https://<name>.app.n8n.cloud
//   export N8N_MCP_TOKEN=<token>          # never commit it
// (or copy scripts/n8n.env.example to .env.local)
//
// Commands:
//   bun scripts/n8n.ts tools                         list MCP tools
//   bun scripts/n8n.ts call <tool> ['<json args>']   raw tool call, prints the result
//   bun scripts/n8n.ts state                         install status, row counts, Invenstory workflows
//   bun scripts/n8n.ts install [origin] [currency]   idempotent install/upgrade (origin = app URL to allow)
//   bun scripts/n8n.ts summary [7d|30d|90d]          call the secret-path API like the dashboard does
//   bun scripts/n8n.ts validate <api|notify|error|analyze>   validate a core template against n8n (saves nothing)
//
// Keep call volume low: n8n Cloud rate-limits MCP (HTTP 429).

import { Mcp, resultText } from '../src/lib/n8n/mcp.ts';
import { apiDetails, detect, generateVapid, install, isComplete, readConfig } from '../src/lib/n8n/install.ts';
import { TABLE_NAMES, type TableIds } from '../src/lib/n8n/core/schema.ts';
import { apiWorkflow, errorWorkflow, notifyWorkflow } from '../src/lib/n8n/core/templates.ts';
import { analyzeWorkflow, MODEL_CHOICES } from '../src/lib/n8n/core/analyze.ts';
import type { Connection } from '../src/lib/n8n/oauth.ts';

const base = (process.env.N8N_BASE ?? '').replace(/\/+$/, '');
const token = process.env.N8N_MCP_TOKEN ?? '';
if (!base || !token) {
  console.error('Set N8N_BASE and N8N_MCP_TOKEN (see the header of scripts/n8n.ts).');
  process.exit(2);
}

const conn: Connection = {
  base,
  mcpUrl: `${base}/mcp-server/http`,
  resource: `${base}/mcp-server/http`,
  as: { issuer: base, authorization_endpoint: '', token_endpoint: '' },
};
const mcp = new Mcp(conn, 'direct', async () => token);
const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'tools': {
      for (const t of await mcp.listTools()) console.log(t.name);
      return;
    }
    case 'call': {
      const r = await mcp.callTool(args[0]!, args[1] ? JSON.parse(args[1]) : {});
      console.log(r.structuredContent !== undefined ? JSON.stringify(r.structuredContent, null, 2) : resultText(r));
      if (r.isError) process.exitCode = 1;
      return;
    }
    case 'state': {
      const d = await detect(mcp);
      console.log('project', d.projectId, '| complete install:', isComplete(d));
      console.log('core workflows', d.workflows);
      if (d.tables.inv_config) console.log('config', await readConfig(mcp, d.projectId, d.tables.inv_config));
      for (const name of TABLE_NAMES) {
        const id = d.tables[name];
        if (!id) {
          console.log(`${name}: missing`);
          continue;
        }
        const r = await mcp.call<{ count: number }>('get_data_table_rows', { dataTableId: id, projectId: d.projectId, limit: 1 });
        console.log(`${name} (${id}): ${r.count} rows`);
      }
      const wfs = await mcp.call<{ data: { id: string; name: string; active: boolean }[] }>('search_workflows', { query: 'Invenstory', limit: 100 });
      console.log('agent-built workflows:');
      for (const w of wfs.data.filter((x) => x.name.startsWith('Invenstory · '))) console.log(`  ${w.id} ${w.active ? 'active' : 'draft '} ${w.name}`);
      return;
    }
    case 'install': {
      const info = await install(mcp, { base, origin: args[0] ?? 'http://localhost:5173', baseCurrency: args[1] ?? 'USD', onStep: (m) => console.log('·', m) });
      console.log(JSON.stringify({ ...info, apiUrl: info.apiUrl.replace(/inv-[0-9a-f]+/, 'inv-<secret>') }, null, 2));
      return;
    }
    case 'summary': {
      const d = await detect(mcp);
      if (!d.workflows.api) throw new Error('invenstory-api is not installed.');
      const { path } = await apiDetails(mcp, d.workflows.api);
      const r = await fetch(`${base}/webhook/${path}?view=summary&period=${args[0] ?? '30d'}`);
      console.log(r.status, JSON.stringify(await r.json(), null, 2));
      return;
    }
    case 'validate': {
      const d = await detect(mcp);
      const tables = Object.fromEntries(TABLE_NAMES.map((n) => [n, d.tables[n] ?? 'missingTable0000'])) as TableIds;
      const dummy = 'abcdefghijklmnop';
      const vapid = await generateVapid();
      const which = args[0] ?? 'api';
      const code =
        which === 'api'
          ? apiWorkflow({ tables, path: 'inv-validate', origins: ['http://localhost:5173'] })
          : which === 'notify'
            ? notifyWorkflow({ tables, vapidPrivateJwk: vapid.privateJwk, vapidPublicKey: vapid.publicKey })
            : which === 'error'
              ? errorWorkflow({ notifyId: d.workflows.notify ?? dummy })
              : analyzeWorkflow({ tables, notifyId: d.workflows.notify ?? dummy, choice: MODEL_CHOICES[0]!, credential: { id: dummy, name: 'Validate' }, model: MODEL_CHOICES[0]!.defaultModel });
      const r = await mcp.callTool('validate_workflow', { code });
      console.log(JSON.stringify(r.structuredContent ?? resultText(r), null, 2));
      return;
    }
    default:
      console.error('Unknown command. See the header of scripts/n8n.ts.');
      process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
