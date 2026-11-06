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

export interface AlignedMatch extends ReferenceMatch {
  /** timing offset (ms, you − original) found per block: the audio path (Bluetooth!) delays what you hear by an amount that is not exactly known and can change */
  blocks: { from: number; shift: number; played: number }[];
  /** average of the block offsets, weighted by hits played */
  offsetMs: number;
}

/**
 * Like matchToReference, but first finds, per `block` seconds of the song, the offset that makes your hits best fit the
 * original's, then matches with that offset removed. `meanMs`/`sdMs` are then what is left (your steadiness).
 */
export function alignedMatch(ref: RefHit[], played: ReferencePlayed[], window: [number, number], block = 20, tol = 0.07, maxShift = 0.3): AlignedMatch {
  const total: ReferenceMatch = { reference: 0, played: 0, matched: 0, hitRate: 0, precision: 0, meanMs: 0, sdMs: 0, voiceAgree: 0, perVoice: {} };
  const blocks: AlignedMatch['blocks'] = [];
  let carry = 0, devSum = 0, devSq = 0, agree = 0, wShift = 0, wN = 0;
  for (let b = window[0]; b < window[1]; b += block) {
    const w: [number, number] = [b, Math.min(b + block, window[1])];
    const inBlock = played.filter((p) => p.t >= w[0] && p.t < w[1]);
    let best = carry;
    if (inBlock.length >= 6) {
      let bestRate = -1;
      for (let sh = -maxShift; sh <= maxShift + 1e-9; sh += 0.005) {
        const m = matchToReference(ref, played.map((p) => ({ t: p.t - sh, key: p.key })), w, tol);
        // the count decides; among equal counts the shift that leaves the smallest average error (the middle of the plateau) wins
        const score = m.matched - Math.min(0.9, Math.abs(m.meanMs) / (tol * 1000));
        if (score > bestRate) { bestRate = score; best = sh; }
      }
      carry = best;
    }
    const m = matchToReference(ref, played.map((p) => ({ t: p.t - best, key: p.key })), w, tol);
    total.reference += m.reference; total.played += m.played; total.matched += m.matched;
    devSum += m.meanMs * m.matched; devSq += (m.sdMs ** 2 + m.meanMs ** 2) * m.matched; agree += m.voiceAgree * m.matched;
    for (const [k, v] of Object.entries(m.perVoice)) { const t = (total.perVoice[k] ||= { reference: 0, matched: 0 }); t.reference += v.reference; t.matched += v.matched; }
    blocks.push({ from: b, shift: Math.round(best * 1000), played: inBlock.length });
    wShift += best * 1000 * inBlock.length; wN += inBlock.length;
  }
  const n = total.matched;
  const mean = n ? devSum / n : 0;
  total.hitRate = total.reference ? n / total.reference : 0;
  total.precision = total.played ? n / total.played : 0;
  total.meanMs = mean;
  total.sdMs = n ? Math.sqrt(Math.max(0, devSq / n - mean * mean)) : 0;
  total.voiceAgree = n ? agree / n : 0;
  return { ...total, blocks, offsetMs: wN ? wShift / wN : 0 };
}
