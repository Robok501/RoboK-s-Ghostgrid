// Render every screen in a phone-sized browser (web build with engine and file stand-ins) and save full-length
// screenshots with the scroll line marked. Usage: npx expo export --platform web --output-dir <web>; node tools/screenshots.js <web> <out>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.argv[2], OUT = process.argv[3];
const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(ROOT, 'index.html');
  const ext = path.extname(p);
  res.writeHead(200, { 'Content-Type': ext === '.js' ? 'application/javascript' : ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(8765);

const beats = []; for (let t = 1.2; t < 210; t += 0.6) beats.push(+t.toFixed(3));
const song = { id: 's1', name: 'John Brown - Papa Grows Funk', created: 1, source: 'file', original: 'original.mp3', duration: 213, separated: true,
  rate: 0.9, mix: 'nodrums', drumVol: 1, loop: true, loopA: 30, loopB: 39.6, click: true, clickVol: 0.8, countIn: 1, coach: true, coachInput: 'pads', grade: 2,
  beatMap: { beats, beatsPerBar: 4, downbeat: 0, bpm: 100, source: 'drums', v: 3 },
  check: { mixDb: -14.2, drumsDb: -19.8, restDb: -15.6, drumsShare: 0.27, invalid: 0 } };
const song2 = { id: 's2', name: 'the hardest transcription - Oliver', created: 2, source: 'file', original: 'original.m4a', duration: 43, separated: false };
const SEED = { 'doc/songs.json': JSON.stringify([song, song2]) };

const W = 428, H = 926, TOP = 47, BOTTOM = 34;
(async () => {
  const b = await chromium.launch();
  async function page(w, h) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.addInitScript((seed) => { window.__GG_SEED = seed; }, SEED);
    await p.goto('http://localhost:8765/');
    await p.addStyleTag({ content: `html,body{background:#000} #root{position:fixed!important;top:${TOP}px;bottom:${BOTTOM}px;left:0;right:0;height:auto!important}` });
    await p.waitForTimeout(1500);
    return p;
  }
  const tab = async (p, name) => { await p.getByRole('tab', { name }).click(); await p.waitForTimeout(500); };
  const text = async (p, t) => { await p.getByText(t, { exact: true }).first().click(); await p.waitForTimeout(500); };
  const btn = async (p, t) => { await p.getByRole('button', { name: t, exact: true }).first().click(); await p.waitForTimeout(500); };

  async function shoot(p, name, w, h) {
    // the tallest scrolling area in view is "the page"; grow the window until all of it shows, and mark the fold
    const info = await p.evaluate(() => {
      const scope = document.querySelector('[aria-modal="true"]') || document;
      const els = [...scope.querySelectorAll('div')].filter((e) => {
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x); if (c.opacity === '0' || c.display === 'none' || c.visibility === 'hidden') return false; }
        return r.width > 100 && r.height > 50 && e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(cs.overflowY);
      });
      els.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      const e = els[0];
      if (!e) return null;
      e.setAttribute('data-main-scroll', '1');
      const r = e.getBoundingClientRect();
      return { extra: e.scrollHeight - e.clientHeight, foldY: r.top + e.clientHeight };
    });
    await p.screenshot({ path: `${OUT}/${name}-screen.png` });
    if (!info) { fs.copyFileSync(`${OUT}/${name}-screen.png`, `${OUT}/${name}-full.png`); return; }
    await p.setViewportSize({ width: w, height: h + info.extra });
    await p.waitForTimeout(400);
    await p.evaluate(({ foldY, w }) => {
      const mark = (y, label, color) => {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;left:0;top:${y}px;width:${w}px;border-top:3px dashed ${color};z-index:99999;pointer-events:none`;
        const t = document.createElement('div');
        t.textContent = label;
        t.style.cssText = `position:absolute;right:4px;top:2px;background:${color};color:#000;font:700 12px -apple-system,Arial;padding:2px 6px;border-radius:4px`;
        d.appendChild(t); document.body.appendChild(d);
      };
      mark(foldY, '▼ scroll starts here (iPhone 13 Pro Max)', '#ff4d4d');
      // sideways scrollers
      const scope2 = document.querySelector('[aria-modal="true"]') || document;
      for (const e of scope2.querySelectorAll('div')) {
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        let vis = true;
        for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x); if (c.opacity === '0' || c.display === 'none') { vis = false; break; } }
        if (vis && r.width > 60 && e.scrollWidth > e.clientWidth + 8 && /(auto|scroll)/.test(cs.overflowX) && r.height > 20) {
          const t = document.createElement('div');
          t.textContent = '⟷ swipe sideways';
          t.style.cssText = `position:fixed;left:${Math.max(0, r.right - 130)}px;top:${r.top + r.height / 2 - 10}px;background:#ffb020;color:#000;font:700 11px -apple-system,Arial;padding:2px 6px;border-radius:4px;z-index:99999;pointer-events:none`;
          document.body.appendChild(t);
          const o = document.createElement('div');
          o.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px dashed #ffb020;z-index:99998;pointer-events:none`;
          document.body.appendChild(o);
        }
      }
    }, { foldY: info.foldY, w });
    await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(() => document.querySelectorAll('div[style*="z-index: 9999"]').forEach((d) => d.remove()));
  }

  const btnStart = async (p, t) => { await p.getByRole('button', { name: new RegExp('^' + t) }).first().click(); await p.waitForTimeout(600); };
  const states = [
    ['1-click', async (p) => {}],
    ['2-click-mode-sheet', async (p) => { await btnStart(p, 'Mode'); }],
    ['3-click-meter-sheet', async (p) => { await btnStart(p, 'Meter and sound'); }],
    ['2b-click-coach-playing', async (p) => {
      await btnStart(p, 'Mode'); await btn(p, 'Coach'); await text(p, 'E-drum'); await btn(p, 'Done');
      await btn(p, 'Play');
      // a minute of kick/snare/hi-hat: 8ths at 100 BPM, a little loose; the kick drags a bit
      await p.evaluate(async () => {
        const E = window.__GG_emit, now = window.__GG_now;
        let seed = 3; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
        for (let i = 0; i < 40; i++) {
          // somewhere on the grid of the click (the offset is what the coach measures); kick a bit late
          const pad = i % 4 === 0 ? 36 : i % 4 === 2 ? 38 : 42;
          const jit = (pad === 36 ? 0.012 : 0) + r() * (pad === 42 ? 0.05 : 0.03);
          window.__GG_last = jit;
          E('onPadHit', { time: now() + jit, note: pad, velocity: 90 });
          await new Promise((res) => setTimeout(res, 150));
        }
      });
    }],
    ['4-trainer', async (p) => { await tab(p, 'Trainer'); }],
    ['5-sketch', async (p) => { await tab(p, 'Sketch'); }],
    ['6-sketch-menu', async (p) => { await tab(p, 'Sketch'); await btn(p, '•••'); }],
    ['7-sketch-rec-choice', async (p) => { await tab(p, 'Sketch'); await btn(p, 'Record'); }],
    ['8-songs', async (p) => { await tab(p, 'Songs'); }],
    ['9-songs-player', async (p) => { await tab(p, 'Songs'); await text(p, 'John Brown - Papa Grows Funk'); }],
    ['10-settings', async (p) => { await tab(p, 'Settings'); }],
  ];
  for (const [name, go] of states) {
    const p = await page(W, H);
    try { await go(p); await shoot(p, name, W, H); console.log('ok', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); }
    await p.close();
  }
  // iPhone sideways: Sketch
  const p = await page(H, W);
  try { await tab(p, 'Sketch'); await shoot(p, '11-sketch-sideways', H, W); console.log('ok sideways'); } catch (e) { console.log('FAIL sideways', e.message); }
  await b.close(); server.close();
})();
