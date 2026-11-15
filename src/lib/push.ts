// Web Push subscription. The VAPID public key comes from the install; the private key lives
// only in the invenstory-notify workflow. Subscriptions are appended to n8n via MCP.

import { kv, K } from './kv.ts';
import type { McpLike, InstallInfo } from './n8n/install.ts';
import { Api } from './n8n/api.ts';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

export function urlBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !standalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Must be called from a user gesture (permission prompt). */
export async function enablePush(mcp: McpLike, install: InstallInfo): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  const key = urlBase64ToBytes(install.vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (e.g. before a reinstall) cannot receive our pushes.
  const current = sub?.options.applicationServerKey;
  if (sub && current && new Uint8Array(current).toString() !== key.toString()) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const known = await kv.get<{ endpoint: string }>(K.push);
  if (known?.endpoint === sub.endpoint) return 'on';
  await mcp.call('add_data_table_rows', {
    dataTableId: install.tables.inv_push_subscriptions,
    projectId: install.projectId,
    rows: [{ endpoint: sub.endpoint, created_at: new Date().toISOString() }],
  });
  await kv.set(K.push, { endpoint: sub.endpoint });
  return 'on';
}

export async function disablePush(install: InstallInfo): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await new Api(install.apiUrl).post('push.unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  await kv.del(K.push);
  return 'off';
}
