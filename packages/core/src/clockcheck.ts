/**
 * Clock check: do the clocks inside the phone agree?
 *
 * The latency test and the click schedule count audio frames; the recording counts microphone frames; the phone
 * also has an ordinary real-time clock. Sampled once a second for a minute or two, a straight line through each
 * pair tells how fast one runs against the other. Real crystals differ by a few tens of ppm (parts per million);
 * a latency that creeps by 2 ms per second would be 2000 ppm, which crystals cannot do, so a gap that large
 * means the timing in the test itself is off. (The microphone count moves in whole buffers, so its slope is only good
 * to about 1000 ppm: enough to rule a 2000 ppm creep in or out, not to measure crystal drift.)
 */
export interface ClockSample {
  /** seconds on the phone's real-time clock since the check began */
  wall: number;
  /** seconds of audio the engine has rendered */
  engine: number;
  /** seconds of audio the microphone has delivered */
  mic: number;
}

export interface ClockCheckResult {
  samples: number;
  seconds: number;
  /** how fast the engine clock runs against the real-time clock, in ppm (+ = engine fast) */
  engineVsWallPpm: number;
  micVsWallPpm: number;
  micVsEnginePpm: number;
  /** straight-line misfit of mic against engine, in ms (steady = small) */
  wobbleMs: number;
  /** what that does to a latency measurement, ms per 10 s */
  creepMsPer10s: number;
  verdict: 'agree' | 'mismatch' | 'unclear';
}

/** least-squares slope and rms residual of y over x */
function fit(x: number[], y: number[]): { slope: number; rms: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const slope = sxx > 0 ? sxy / sxx : 0;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (y[i] - my - slope * (x[i] - mx)) ** 2;
  return { slope, rms: Math.sqrt(ss / n) };
}

export function analyzeClocks(samples: ClockSample[]): ClockCheckResult {
  const s = samples.filter((p) => Number.isFinite(p.wall) && Number.isFinite(p.engine) && Number.isFinite(p.mic));
  if (s.length < 5 || s[s.length - 1].wall - s[0].wall < 5) {
    return { samples: s.length, seconds: 0, engineVsWallPpm: 0, micVsWallPpm: 0, micVsEnginePpm: 0, wobbleMs: 0, creepMsPer10s: 0, verdict: 'unclear' };
  }
  const wall = s.map((p) => p.wall), eng = s.map((p) => p.engine), mic = s.map((p) => p.mic);
  const ew = fit(wall, eng).slope - 1;
  const mw = fit(wall, mic).slope - 1;
  const me = fit(eng, mic);
  const micVsEng = me.slope - 1;
  const ppm = (v: number) => v * 1e6;
  // the microphone count moves in whole tap buffers (0.1 s on the iPhone), so over 90 s its slope is only good to
  // about +-1000 ppm; the engine count moves in tiny steps and is good to about 50 ppm
  const verdict = Math.abs(ppm(micVsEng)) > 1500 || Math.abs(ppm(ew)) > 500 ? 'mismatch' : Math.abs(ppm(micVsEng)) < 1000 && Math.abs(ppm(ew)) < 200 ? 'agree' : 'unclear';
  return {
    samples: s.length,
    seconds: wall[wall.length - 1] - wall[0],
    engineVsWallPpm: ppm(ew),
    micVsWallPpm: ppm(mw),
    micVsEnginePpm: ppm(micVsEng),
    wobbleMs: me.rms * 1000,
    creepMsPer10s: micVsEng * 10 * 1000,
    verdict,
  };
}
