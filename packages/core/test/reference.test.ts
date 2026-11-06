import { describe, expect, it } from 'vitest';
import { matchToReference } from '../src';

const ref = Array.from({ length: 16 }, (_, i) => ({ t: 1 + i * 0.25, id: i % 4 === 0 ? 'bd' : i % 2 ? 'hh' : 'sn' }));

describe('matchToReference', () => {
  it('perfect play matches everything with zero offset', () => {
    const m = matchToReference(ref, ref.map((r) => ({ t: r.t, key: r.id })), [0, 10]);
    expect(m.hitRate).toBe(1); expect(m.precision).toBe(1); expect(m.meanMs).toBeCloseTo(0); expect(m.voiceAgree).toBe(1);
  });
  it('a steady late player is reported as late, not wrong', () => {
    const m = matchToReference(ref, ref.map((r) => ({ t: r.t + 0.03, key: r.id })), [0, 10]);
    expect(m.hitRate).toBe(1); expect(m.meanMs).toBeCloseTo(30); expect(m.sdMs).toBeLessThan(1);
  });
  it('missed hits and extra hits lower hit rate and precision', () => {
    const played = ref.filter((_, i) => i % 2 === 0).map((r) => ({ t: r.t, key: r.id })).concat([{ t: 1.12, key: 'sn' }]);
    const m = matchToReference(ref, played, [0, 10]);
    expect(m.matched).toBe(8); expect(m.hitRate).toBeCloseTo(0.5); expect(m.precision).toBeCloseTo(8 / 9);
  });
  it('only the played window counts', () => {
    const m = matchToReference(ref, ref.slice(0, 4).map((r) => ({ t: r.t, key: r.id })), [0.9, 1.9]);
    expect(m.reference).toBe(4); expect(m.hitRate).toBe(1);
  });
  it('one-to-one: a double hit near one original counts once', () => {
    const m = matchToReference([{ t: 1, id: 'sn' }], [{ t: 0.99, key: 'sn' }, { t: 1.01, key: 'sn' }], [0, 5]);
    expect(m.matched).toBe(1); expect(m.precision).toBeCloseTo(0.5);
  });
  it('voice disagreement is reported separately', () => {
    const m = matchToReference([{ t: 1, id: 'sn' }], [{ t: 1, key: 'bd' }], [0, 5]);
    expect(m.matched).toBe(1); expect(m.voiceAgree).toBe(0);
  });
});
