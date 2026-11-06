/**
 * Playing along with the real drummer: compare the hits you played with the hits found in the song's drum track.
 * Timing of a hit is the reliable part; which drum it was is only reported as a rough agreement.
 */

export interface RefHit { t: number; id: string }
export interface ReferencePlayed { t: number; key: string }

export interface ReferenceMatch {
  /** hits in the original (inside the window) */
  reference: number;
  /** hits you played (inside the window) */
  played: number;
  /** original hits you answered within the tolerance */
  matched: number;
  /** share of the original's hits you answered, 0..1 */
  hitRate: number;
  /** share of your hits that sat on an original hit, 0..1 */
  precision: number;
  /** average of (you − original) in ms: positive = behind the original */
  meanMs: number;
  /** spread of that in ms (how steady) */
  sdMs: number;
  /** of the matched hits, the share where kick/snare/hat family agreed (rough, the drum track's naming is imperfect) */
  voiceAgree: number;
  /** a rough "ghost" hit-rate per voice family */
  perVoice: Record<string, { reference: number; matched: number }>;
}

const family = (id: string): string => {
  if (id === 'bd' || id === 'kick') return 'bd';
  if (id === 'sn' || id === 'rim') return 'sn';
  if (id.startsWith('hh') || id === 'hf' || id === 'rd' || id === 'cr' || id === 'crash' || id === 'ride') return 'hh';
  return 'other';
};

/**
 * One-to-one, closest first. `window` limits both lists to the part of the song that was played.
 * A strong steady offset (a late player) still matches as long as it stays within `tol`.
 */
export function matchToReference(ref: RefHit[], played: ReferencePlayed[], window: [number, number], tol = 0.07): ReferenceMatch {
  const R = ref.filter((r) => r.t >= window[0] && r.t <= window[1]);
  const P = played.filter((p) => p.t >= window[0] && p.t <= window[1]);
  const pairs: { r: number; p: number; d: number }[] = [];
  let lo = 0;
  const Rs = R.map((r, i) => ({ ...r, i })).sort((a, b) => a.t - b.t);
  const Ps = P.map((p, i) => ({ ...p, i })).sort((a, b) => a.t - b.t);
  for (const p of Ps) {
    while (lo < Rs.length && Rs[lo].t < p.t - tol) lo++;
    for (let k = lo; k < Rs.length && Rs[k].t <= p.t + tol; k++) pairs.push({ r: Rs[k].i, p: p.i, d: Math.abs(p.t - Rs[k].t) });
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedR = new Set<number>(), usedP = new Set<number>();
  const dev: number[] = [];
  let agree = 0;
  const per: Record<string, { reference: number; matched: number }> = {};
  for (const r of R) (per[family(r.id)] ||= { reference: 0, matched: 0 }).reference++;
  for (const m of pairs) {
    if (usedR.has(m.r) || usedP.has(m.p)) continue;
    usedR.add(m.r); usedP.add(m.p);
    dev.push((P[m.p].t - R[m.r].t) * 1000);
    if (family(P[m.p].key) === family(R[m.r].id)) agree++;
    per[family(R[m.r].id)].matched++;
  }
  const n = dev.length;
  const mean = n ? dev.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(dev.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  return {
    reference: R.length, played: P.length, matched: n,
    hitRate: R.length ? n / R.length : 0, precision: P.length ? n / P.length : 0,
    meanMs: mean, sdMs: sd, voiceAgree: n ? agree / n : 0, perVoice: per,
  };
}
