#!/usr/bin/env node
'use strict';
/*
 * チナミニ クイズ動画(mp4)レンダラー — WorkX 社内ディスプレイ向け
 *
 * サイネージ用ページ(../index.html)を Chromium(Playwright)で開き、
 * クイズの各画面(タイトル → 問題 → ヒント → 答えと解説 → 誘導)を 1920×1080 で撮影して、
 * ffmpeg で 1 本の mp4 にします。描画はサイネージとまったく同じコードなので、
 * QR コードの位置・秒数・文字サイズの自動縮小はページ側の仕様と常に一致します。
 *
 *   node video/render.js                       # playlist.json の全クイズを out/ に書き出す
 *   node video/render.js --ids 2026-09-02-evening,2026-09-08-evening
 *   node video/render.js --frames-only         # 画面ごとの PNG だけ出す(目視確認用)
 *
 * 必要なもの: Node 20 以上、playwright(npm)、Chromium(npx playwright install chromium)、
 *             ffmpeg(libx264)、日本語フォント(Noto Sans CJK JP など)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const W = 1920, H = 1080, FPS = 30;
// index.html の既定値と同じ。playlist.json の timing、項目ごとの timing で上書きされる。
const DEFAULT_TIMING = { title: 3, question: 20, hint: 15, answer: 25, cta: 8 };
const SCREENS = ['title', 'question', 'hint', 'answer', 'cta'];
// index.html の .progress の位置。高さ 12px、左右 90px、フッター(90px)の上に 12px の余白。
const BAR = { x: 90, y: H - 90 - 12 - 12, w: W - 180, h: 12, fill: '0x4671BF', track: '0xDFDDDC' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

function parseArgs(argv) {
  const a = { playlist: path.join(ROOT, 'playlist.json'), out: path.join(ROOT, 'out'), ids: null, framesOnly: false,
              font: process.env.RENDER_FONT || 'Noto Sans CJK JP', ffmpeg: process.env.FFMPEG || 'ffmpeg', crf: 18, audio: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--playlist') a.playlist = path.resolve(v), i++;
    else if (k === '--out') a.out = path.resolve(v), i++;
    else if (k === '--ids') a.ids = v.split(',').map(s => s.trim()).filter(Boolean), i++;
    else if (k === '--font') a.font = v, i++;
    else if (k === '--ffmpeg') a.ffmpeg = v, i++;
    else if (k === '--crf') a.crf = Number(v), i++;
    else if (k === '--frames-only') a.framesOnly = true;
    else if (k === '--no-audio') a.audio = false;
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
    else throw new Error('不明な引数: ' + k);
  }
  return a;
}

// index.html と同じ資材を配信する小さな HTTP サーバー。
// /__render/<n>.json で、1 問だけを入れた playlist を返す(表示条件は無視して必ず出す)。
function serve(singles) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const m = url.pathname.match(/^\/__render\/(\d+)\.json$/);
    if (m && singles[m[1]]) {
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
      return res.end(JSON.stringify(singles[m[1]]));
    }
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} が終了コード ${code} で失敗しました\n${err}`)));
  });
}

function timingOf(playlist, item) {
  return Object.assign({}, DEFAULT_TIMING, playlist.timing || {}, item.timing || {});
}

async function shoot(page, port, index, screen, file) {
  const url = `http://127.0.0.1:${port}/index.html?playlist=/__render/${index}.json&screen=${screen}&freeze=1`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.screen.active:not(#scr-idle)', { timeout: 15000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
  });
  // 進捗バーは ffmpeg 側で動かすので、ページの物は消しておく(場所はレイアウトのため残す)
  await page.evaluate(() => { for (const p of document.querySelectorAll('.progress')) p.style.visibility = 'hidden'; });
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
  // 撮影した画面が、本文を何 px で収めたかを記録する(ログ用)
  return page.evaluate(() => {
    const e = document.querySelector('.screen.active .explanation');
    return e ? parseFloat(getComputedStyle(e).fontSize) : null;
  });
}

async function encode(ffmpeg, frames, timing, out, opts) {
  // 各画面の PNG を秒数ぶん静止画として並べ、進捗バー(青)を左から右へ動かす。
  // タイトル画面には進捗バーが無いので、そのまま。
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters = [];
  const labels = [];
  let inputs = 0;
  let total = 0;
  for (const s of SCREENS) {
    const sec = timing[s];
    if (!(sec > 0)) continue;
    total += sec;
    const img = inputs++;
    args.push('-loop', '1', '-framerate', String(FPS), '-t', String(sec), '-i', frames[s]);
    if (s === 'title') { filters.push(`[${img}:v]format=rgb24[v${img}]`); labels.push(`[v${img}]`); continue; }
    const bar = inputs++;
    args.push('-f', 'lavfi', '-t', String(sec), '-i', `color=c=${BAR.fill}:s=${BAR.w}x${BAR.h}:r=${FPS}`);
    filters.push(
      `[${img}:v]format=rgb24,drawbox=x=${BAR.x}:y=${BAR.y}:w=${BAR.w}:h=${BAR.h}:color=${BAR.track}:t=fill[t${img}]`,
      `[t${img}][${bar}:v]overlay=x='${BAR.x - BAR.w}+${BAR.w}*t/${sec}':y=${BAR.y}:shortest=1,` +
      `drawbox=x=0:y=${BAR.y}:w=${BAR.x}:h=${BAR.h}:color=white:t=fill[v${img}]`);
    labels.push(`[v${img}]`);
  }
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0,format=yuv420p[v]`);
  if (opts.audio) {
    // 無音の音声トラック。音声無しの mp4 を再生できないプレイヤー対策。
    args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]');
  if (opts.audio) args.push('-map', `${inputs}:a`, '-c:a', 'aac', '-b:a', '48k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf), '-r', String(FPS), '-pix_fmt', 'yuv420p', '-shortest', '-movflags', '+faststart', out);
  await run(ffmpeg, args);
  return total;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const playlist = JSON.parse(fs.readFileSync(opts.playlist, 'utf8'));
  let items = (playlist.items || []).filter(it => it.type === 'quiz');
  if (opts.ids) {
    const missing = opts.ids.filter(id => !items.some(it => it.id === id));
    if (missing.length) throw new Error('playlist に無い id: ' + missing.join(', '));
    items = items.filter(it => opts.ids.includes(it.id));
  }
  if (!items.length) throw new Error('クイズ項目がありません: ' + opts.playlist);
  fs.mkdirSync(opts.out, { recursive: true });

  // 表示条件(from/until/weekdays/enabled/answerAt)は動画には関係ないので外し、1 問ずつ配信する
  const singles = items.map(it => {
    const { from, until, weekdays, enabled, answerAt, ...rest } = it;
    return { version: playlist.version, timing: playlist.timing, brand: playlist.brand, items: [rest] };
  });
  const { server, port } = await serve(singles);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'ja-JP' });
  const page = await context.newPage();
  // フォントを固定する(サイネージの font-family はディスプレイ側 OS の書体に任せているため)
  if (opts.font) await page.addInitScript(font => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = `:root { --font: "${font}", sans-serif; }`;
      document.head.append(st);
    });
  }, opts.font);
  page.on('pageerror', e => console.error('  ページのエラー:', e.message));

  const results = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = item.id || `item-${i}`;
      const timing = timingOf(playlist, item);
      const dir = path.join(opts.out, 'frames', id);
      fs.mkdirSync(dir, { recursive: true });
      const frames = {};
      let explSize = null;
      for (const s of SCREENS) {
        if (!(timing[s] > 0)) continue;
        frames[s] = path.join(dir, `${s}.png`);
        const size = await shoot(page, port, i, s, frames[s]);
        if (s === 'answer') explSize = size;
      }
      const line = `${id}: 解説 ${explSize}px`;
      if (opts.framesOnly) { console.log(`${line} → ${dir}`); results.push({ id, frames }); continue; }
      const out = path.join(opts.out, `${id}.mp4`);
      const total = await encode(opts.ffmpeg, frames, timing, out, opts);
      const mb = (fs.statSync(out).size / 1048576).toFixed(1);
      console.log(`${line}, ${total} 秒 (${SCREENS.map(s => timing[s]).join('/')}), ${mb} MB → ${path.relative(process.cwd(), out)}`);
      results.push({ id, out, total, explSize });
    }
  } finally {
    await browser.close();
    server.close();
  }
  fs.writeFileSync(path.join(opts.out, 'render.json'), JSON.stringify({ renderedAt: new Date().toISOString(), items: results }, null, 2));
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
