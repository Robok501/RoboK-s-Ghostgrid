/**
 * Text that core builds at run time (questions, results) goes through tr(), so the app can translate it.
 * Keys are the English text with {{name}} placeholders, the same format the app's language files use.
 * Without a translator set, the English text comes back with the values filled in.
 */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;
const fill: Translate = (k, v) => k.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(v?.[n] ?? ''));
let fn: Translate = fill;
export const tr: Translate = (k, v) => fn(k, v);
export function setTranslator(f: Translate | null) { fn = f ?? fill; }
