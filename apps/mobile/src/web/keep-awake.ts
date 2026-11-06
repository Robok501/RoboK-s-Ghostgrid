/** Browser stand-in for expo-keep-awake: asks for a screen wake lock, ignores any refusal. */
const locks: Record<string, any> = {};
export async function activateKeepAwakeAsync(tag = 'default'): Promise<void> {
  try { locks[tag] = await (navigator as any).wakeLock?.request('screen'); } catch { /* not allowed right now */ }
}
export function deactivateKeepAwake(tag = 'default'): Promise<void> {
  try { locks[tag]?.release?.(); } catch { /* already released */ }
  delete locks[tag];
  return Promise.resolve();
}
