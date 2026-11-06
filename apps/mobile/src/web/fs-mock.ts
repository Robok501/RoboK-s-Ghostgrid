/** In-memory stand-in for expo-file-system on the web (screenshots only). Seeded from window.__GG_SEED. */
const seeded = (globalThis as any).__GG_SEED as Record<string, string> | undefined;
const KEY = 'ghostgrid-files';
// normal web use keeps settings and ideas in localStorage; screenshot runs (seeded) stay in memory
const load = (): Record<string, string> => { try { return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}'); } catch { return {}; } };
const store: Record<string, string> = seeded ?? load();
const persist = () => { if (seeded) return; try { globalThis.localStorage?.setItem(KEY, JSON.stringify(store)); } catch { /* full or blocked */ } };
const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/').replace(/\/+/g, '/');
export class File {
  uri: string;
  constructor(...parts: unknown[]) { this.uri = join(parts); }
  get exists() { return this.uri in store; }
  textSync() { return store[this.uri] ?? ''; }
  writeSync(d: unknown) { store[this.uri] = typeof d === 'string' ? d : '[binary]'; persist(); }
  bytesSync() { return new Uint8Array(0); }
  delete() { delete store[this.uri]; persist(); }
  async copy() {}
  create() {}
}
export class Directory {
  uri: string;
  constructor(...parts: unknown[]) { this.uri = join(parts); }
  get exists() { return true; }
  create() {}
  delete() {}
}
export const Paths = { document: new Directory('doc'), cache: new Directory('cache') };
