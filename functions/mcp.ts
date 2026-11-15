import { mcpProxy, type ProxyEnv } from '../src/server/mcp-proxy.ts';

export const onRequest: PagesFunction<ProxyEnv> = (context) => mcpProxy(context.request, context.env);
