import { NAME_PREFIX } from './agent/tools.ts';

export interface Flow {
  id: string;
  name: string;
  active: boolean;
}

/** Guided setup is complete once data has arrived and an active Invenstory automation keeps it fresh. */
export function setupComplete(products: number, sales: number, flows: Flow[]): boolean {
  return products + sales > 0 && flows.some((f) => f.active && f.name.startsWith(NAME_PREFIX));
}
