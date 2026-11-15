import { defineConfig, type Connect, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mcpProxy } from './src/server/mcp-proxy.ts';

// Mounts the same handler as functions/mcp.ts on the dev and preview servers.
function mcpProxyPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res) => {
    void forward(req, res).catch((e: unknown) => {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: String(e) }));
    });
  };
  return {
    name: 'invenstory-mcp-proxy',
    configureServer: (server) => void server.middlewares.use('/mcp', handler),
    configurePreviewServer: (server) => void server.middlewares.use('/mcp', handler),
  };
}

async function forward(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const request = new Request('http://localhost/mcp', {
    method: req.method,
    headers,
    body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
  });
  const response = await mcpProxy(request, { N8N_ALLOWED_HOSTS: process.env.N8N_ALLOWED_HOSTS });
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (!response.body) return void res.end();
  const reader = response.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

export default defineConfig({
  plugins: [svelte(), mcpProxyPlugin()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022' },
});
