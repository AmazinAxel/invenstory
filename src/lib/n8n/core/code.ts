// JavaScript run inside n8n Code nodes. Each constant defines `function run(input)` with no
// outside references, so test/core-code.test.ts can execute the exact same source.

export const SHARED = String.raw`
function real(rows) { return (rows || []).filter(function (r) { return r && r.id !== undefined && r.id !== null; }); }
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function round(v) { return Math.round(v * 100) / 100; }
function ts(v) { var t = new Date(v).getTime(); return isFinite(t) ? t : 0; }
function latestConfig(rows) {
  var out = {};
  real(rows).slice().sort(function (a, b) { return ts(a.createdAt) - ts(b.createdAt) || num(a.id) - num(b.id); })
    .forEach(function (r) { out[r.key] = r.value; });
  return out;
}
function parseJson(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
`;

export const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export const SUMMARY = SHARED + String.raw`
function run(input) {
  var cfg = latestConfig(input.config);
  var currency = String(cfg.base_currency || 'USD').toUpperCase();
  var days = ({ '7d': 7, '30d': 30, '90d': 90 })[input.period] || 30;
  var now = ts(input.now) || Date.now();
  var since = now - days * 86400000;
  var inBase = function (c) { return !c || String(c).toUpperCase() === currency; };
  var excluded = 0;

  var products = real(input.products);
  var stockValue = 0, lowStock = 0, outOfStock = 0;
  products.forEach(function (p) {
    var q = num(p.quantity);
    if (q <= 0) outOfStock++;
    else if (p.reorder_point !== null && p.reorder_point !== undefined && p.reorder_point !== '' && q <= num(p.reorder_point)) lowStock++;
    if (inBase(p.currency)) stockValue += q * num(p.unit_cost); else excluded++;
  });

  var byDay = {}, bySku = {}, revenue = 0, units = 0;
  real(input.sales).forEach(function (s) {
    var t = ts(s.sold_at);
    if (!t || t < since || t > now + 86400000) return;
    var q = num(s.quantity);
    units += q;
    var sku = bySku[s.sku] || (bySku[s.sku] = { sku: s.sku, units: 0, revenue: 0 });
    sku.units += q;
    var d = new Date(t).toISOString().slice(0, 10);
    var day = byDay[d] || (byDay[d] = { revenue: 0, units: 0 });
    day.units += q;
    if (inBase(s.currency)) { var r = num(s.revenue); revenue += r; sku.revenue += r; day.revenue += r; } else excluded++;
  });

  var trend = [];
  for (var i = days - 1; i >= 0; i--) {
    var key = new Date(now - i * 86400000).toISOString().slice(0, 10);
    var v = byDay[key] || { revenue: 0, units: 0 };
    trend.push({ date: key, revenue: round(v.revenue), units: v.units });
  }

  var names = {};
  products.forEach(function (p) { names[p.sku] = p.name; });
  var top = Object.keys(bySku).map(function (k) { return bySku[k]; })
    .sort(function (a, b) { return b.revenue - a.revenue || b.units - a.units; })
    .slice(0, 5)
    .map(function (x) { return { sku: x.sku, name: names[x.sku] || x.sku, units: x.units, revenue: round(x.revenue) }; });
  var slow = products.filter(function (p) { return num(p.quantity) > 0; })
    .map(function (p) { return { sku: p.sku, name: p.name, quantity: num(p.quantity), units: (bySku[p.sku] || { units: 0 }).units }; })
    .sort(function (a, b) { return a.units - b.units || b.quantity - a.quantity; })
    .slice(0, 5);

  var items = real(input.items).filter(function (it) { return it.status === 'open'; })
    .sort(function (a, b) { return ts(b.created_at) - ts(a.created_at); })
    .map(function (it) {
      return { item_id: it.item_id, session_id: it.session_id, created_at: it.created_at, title: it.title, detail: it.detail, kind: it.kind,
        workflow_id: it.workflow_id || null, draft_channel: it.draft_channel || null, draft_to: it.draft_to || null,
        draft_subject: it.draft_subject || null, draft_body: it.draft_body || null };
    });

  var session = real(input.sessions)[0] || null;
  var messages = session ? real(input.messages).filter(function (m) { return m.session_id === session.session_id; })
    .sort(function (a, b) { return ts(a.created_at) - ts(b.created_at) || num(a.id) - num(b.id); })
    .map(function (m) { return { role: m.role, created_at: m.created_at, content: parseJson(m.content, m.content) }; }) : [];

  return {
    generated_at: new Date(now).toISOString(),
    period: ({ 7: '7d', 30: '30d', 90: '90d' })[days],
    currency: currency,
    kpis: { stock_value: round(stockValue), revenue: round(revenue), units_sold: units, low_stock: lowStock, out_of_stock: outOfStock,
      products: products.length, excluded_rows: excluded },
    sales_trend: trend,
    top_sellers: top,
    slow_movers: slow,
    action_items: items,
    session: session ? { session_id: session.session_id, created_at: session.created_at, origin: session.origin, messages: messages } : null,
    config: { version: num(cfg.version), base_currency: currency, vapid_public_key: cfg.vapid_public_key || null, analysis: !!cfg.analyze_workflow_id },
  };
}
`;

export const STOCK = SHARED + String.raw`
function run(input) {
  var q = String(input.q || '').toLowerCase().trim();
  var rows = real(input.products).filter(function (p) {
    return !q || String(p.sku || '').toLowerCase().indexOf(q) >= 0 || String(p.name || '').toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) { return String(a.name || a.sku).localeCompare(String(b.name || b.sku)); });
  var offset = Math.max(0, parseInt(input.cursor, 10) || 0);
  var size = 50;
  return {
    total: rows.length,
    next: offset + size < rows.length ? String(offset + size) : null,
    items: rows.slice(offset, offset + size).map(function (p) {
      return { sku: p.sku, name: p.name, quantity: num(p.quantity), reorder_point: p.reorder_point === null || p.reorder_point === undefined || p.reorder_point === '' ? null : num(p.reorder_point),
        unit_cost: num(p.unit_cost), unit_price: num(p.unit_price), currency: p.currency || null, source: p.source || null, updated_at: p.updated_at || null };
    }),
  };
}
`;

export const NOTICE = SHARED + String.raw`
function run(input) {
  var e = real(input.events)[0];
  return e ? { kind: e.kind, title: e.title, body: e.body, created_at: e.created_at } : { kind: null, title: 'Invenstory', body: 'Something changed.', created_at: null };
}
`;

/** Validates an item.run request against the item and the action registry. */
export const PREPARE_RUN = SHARED + String.raw`
function run(input) {
  var item = real(input.item)[0];
  var reg = real(input.registry)[0];
  if (!item || item.kind !== 'run' || item.status !== 'open') return { ok: false, error: 'Action item not found or not runnable.' };
  if (!reg || reg.workflow_id !== item.workflow_id) return { ok: false, error: 'That workflow is not registered as an action.' };
  return { ok: true, item_id: item.item_id, session_id: item.session_id, workflow_id: item.workflow_id, input: parseJson(item.input || '{}', {}) };
}
`;

export const ANALYSIS_TARGET = SHARED + String.raw`
function run(input) {
  var id = latestConfig(input.config).analyze_workflow_id;
  return id ? { ok: true, workflow_id: id } : { ok: false, error: 'Analysis is not set up yet: add an LLM credential in n8n.' };
}
`;

/** Wraps a run() source as a Code-node body (runOnceForAllItems). */
export function codeNode(source: string, inputExpr: string): string {
  return `${source}\nreturn [{ json: run(${inputExpr}) }];`;
}

/** Signs one VAPID JWT per push-service origin and emits one item per subscription. */
export function signPushCode(privateJwk: JsonWebKey, publicKey: string): string {
  const jwk = { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y, d: privateJwk.d };
  return String.raw`
const crypto = require('crypto');
const key = crypto.createPrivateKey({ key: ${JSON.stringify(jwk)}, format: 'jwk' });
const pub = ${JSON.stringify(publicKey)};
const b64u = (b) => Buffer.from(b).toString('base64url');
const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
const auth = {};
const seen = {};
const out = [];
for (const item of $input.all()) {
  const endpoint = item.json.endpoint;
  const m = typeof endpoint === 'string' ? /^https:\/\/[^/]+/.exec(endpoint) : null;
  if (!m || seen[endpoint]) continue;
  seen[endpoint] = true;
  const aud = m[0];
  if (!auth[aud]) {
    const claims = b64u(JSON.stringify({ aud, exp, sub: 'mailto:push@invenstory.invalid' }));
    const sig = crypto.sign('sha256', Buffer.from(header + '.' + claims), { key, dsaEncoding: 'ieee-p1363' });
    auth[aud] = 'vapid t=' + header + '.' + claims + '.' + sig.toString('base64url') + ', k=' + pub;
  }
  out.push({ json: { endpoint, authorization: auth[aud] } });
}
return out;
`.trim();
}

/** Turns the summary into compact facts for the analysis model. */
export const ANALYSIS_FACTS = SUMMARY.replace('function run(input)', 'function summarize(input)') + String.raw`
function run(input) {
  var s = summarize(input);
  var low = real(input.products).filter(function (p) {
    return num(p.quantity) <= 0 || (p.reorder_point !== null && p.reorder_point !== undefined && p.reorder_point !== '' && num(p.quantity) <= num(p.reorder_point));
  }).slice(0, 25).map(function (p) { return { sku: p.sku, name: p.name, quantity: num(p.quantity), reorder_point: num(p.reorder_point) }; });
  var registry = real(input.registry).map(function (a) {
    return { workflow_id: a.workflow_id, name: a.name, description: a.description, input_schema: parseJson(a.input_schema || '{}', {}) };
  });
  var facts = { currency: s.currency, period: s.period, kpis: s.kpis, top_sellers: s.top_sellers, slow_movers: s.slow_movers,
    low_or_out_of_stock: low, open_action_items: s.action_items.map(function (i) { return { title: i.title, kind: i.kind }; }),
    weekly_revenue: s.sales_trend.reduce(function (acc, d, i) { var w = Math.floor(i / 7); acc[w] = round((acc[w] || 0) + d.revenue); return acc; }, []) };
  return { facts: JSON.stringify(facts), registry: registry, registry_json: JSON.stringify(registry) };
}
`;

/**
 * Facts plus the chat-completions request body, for the analysis variant that calls the model
 * over HTTP with the owner's OpenRouter key. The prompt is the same as the LLM-chain variant's;
 * the reply format is asked for in words because JSON-schema output is not universal.
 */
export const ANALYSIS_REQUEST = ANALYSIS_FACTS.replace('function run(input)', 'function prepare(input)') + String.raw`
function run(input) {
  var f = prepare(input);
  var system = String(input.system || '') + '\nReply with one JSON object and nothing else: no code fences, no commentary. It must match this JSON Schema:\n' + JSON.stringify(input.schema || {});
  f.body = {
    model: input.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: 'Facts:\n' + f.facts + '\n\nRegistered actions:\n' + f.registry_json }
    ],
    response_format: { type: 'json_object' }
  };
  return f;
}
`;

/**
 * Reads the model's reply from a chat-completions response. Tolerates code fences and prose
 * around the JSON; fails loudly otherwise so the error workflow tells the owner.
 */
export const ANALYSIS_REPLY = SHARED + String.raw`
function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function extract(text) {
  var t = String(text || '');
  var direct = parseJson(t, null);
  if (isObject(direct)) return direct;
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  var inner = parseJson(t.slice(a, b + 1), null);
  return isObject(inner) ? inner : null;
}
function run(input) {
  var r = input.response;
  if (typeof r === 'string') r = parseJson(r, {});
  if (!isObject(r)) r = {};
  if (r.error) throw new Error('The analysis model answered with an error: ' + String((isObject(r.error) && r.error.message) || r.error).slice(0, 300));
  var choice = (Array.isArray(r.choices) ? r.choices[0] : null) || {};
  var content = choice.message ? choice.message.content : '';
  if (Array.isArray(content)) content = content.map(function (p) { return p && typeof p.text === 'string' ? p.text : ''; }).join('');
  var out = extract(content);
  if (!out) throw new Error(choice.finish_reason === 'length' ? 'The analysis model ran out of room before it finished its answer.' : 'The analysis model did not answer with JSON.');
  return { output: out };
}
`;

/** Validates the model's structured output and shapes session, message and item rows. */
export const ANALYSIS_RECORDS = SHARED + String.raw`
function run(input) {
  var out = input.output || {};
  if (typeof out === 'string') out = parseJson(out, {});
  if (out.output && !out.insight) out = out.output;
  var registered = {};
  (input.registry || []).forEach(function (a) { registered[a.workflow_id] = true; });
  var now = input.now;
  var sessionId = 'a-' + input.uuid;
  var items = (Array.isArray(out.items) ? out.items : []).slice(0, 5).map(function (it, i) {
    var title = String(it.title || '').slice(0, 120).trim();
    if (!title) return null;
    var base = { item_id: sessionId + '-' + (i + 1), session_id: sessionId, created_at: now, title: title, detail: String(it.detail || '').slice(0, 1000), status: 'open',
      kind: '', workflow_id: '', input: '', draft_channel: '', draft_to: '', draft_subject: '', draft_body: '' };
    if (it.kind === 'run' && registered[it.workflow_id]) {
      base.kind = 'run'; base.workflow_id = it.workflow_id; base.input = JSON.stringify(it.input && typeof it.input === 'object' ? it.input : {});
      return base;
    }
    var ch = ['email', 'whatsapp', 'sms'].indexOf(it.draft_channel) >= 0 ? it.draft_channel : 'email';
    base.kind = 'draft'; base.draft_channel = ch; base.draft_to = String(it.draft_to || '').slice(0, 200);
    base.draft_subject = String(it.draft_subject || '').slice(0, 200); base.draft_body = String(it.draft_body || it.detail || '').slice(0, 4000);
    return base;
  }).filter(Boolean);
  var insight = String(out.insight || 'No insight was produced.').slice(0, 8000);
  return {
    session: { session_id: sessionId, created_at: now, origin: 'analysis', execution_id: String(input.execution_id || '') },
    message: { session_id: sessionId, created_at: now, role: 'assistant', content: JSON.stringify({ type: 'insight', text: insight, item_ids: items.map(function (x) { return x.item_id; }) }) },
    items: items,
    notice: { kind: 'action_items', title: items.length === 1 ? '1 new action item' : items.length + ' new action items', body: items.map(function (x) { return x.title; }).join(' · ').slice(0, 200) },
  };
}
`;

/** Recovers the VAPID key pair embedded in an installed Sign Push node (for in-place upgrades). */
export function extractVapid(jsCode: string): { privateJwk: JsonWebKey; publicKey: string } | null {
  const k = /createPrivateKey\(\{ key: (\{[^}]*\}), format: 'jwk' \}\)/.exec(jsCode);
  const p = /const pub = ("[^"]+");/.exec(jsCode);
  if (!k || !p) return null;
  try {
    return { privateJwk: JSON.parse(k[1]!) as JsonWebKey, publicKey: JSON.parse(p[1]!) as string };
  } catch {
    return null;
  }
}
