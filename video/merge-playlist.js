#!/usr/bin/env node
'use strict';
/*
 * 夜間バッチが書き出した問題を playlist.json に取り込む。
 *
 *   node video/merge-playlist.js new-items.json            # id が同じ項目は置き換え、無ければ末尾に追加
 *   node video/merge-playlist.js new-items.json --replace  # items を丸ごと新しい内容にする
 *   node video/merge-playlist.js new-items.json --playlist path/to/playlist.json
 *
 * new-items.json は項目の配列でも、{ "items": [...] } でもよい。
 *
 * 守ること:
 *   - brand / timing / refreshSec / version は playlist.json 側の値を保つ(バッチには触らせない)。
 *   - 既存の項目に "hintLocked": true が付いていれば、その hint は手で直したものなので、
 *     同じ id の新しい項目が来ても hint を上書きしない(hintLocked も引き継ぐ)。
 *     納品済みの 5 本(エミュー、つるふさ、サモア、ホッキョクグマ、コストコ)がこれに当たる。
 */

const fs = require('fs');
const path = require('path');

function main(argv) {
  let src = null, playlistPath = path.resolve(__dirname, '..', 'playlist.json'), replace = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--playlist') playlistPath = path.resolve(argv[++i]);
    else if (argv[i] === '--replace') replace = true;
    else if (!src) src = path.resolve(argv[i]);
    else throw new Error('不明な引数: ' + argv[i]);
  }
  if (!src) throw new Error('取り込む JSON ファイルを指定してください');

  const playlist = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
  const incoming = JSON.parse(fs.readFileSync(src, 'utf8'));
  const newItems = Array.isArray(incoming) ? incoming : incoming.items;
  if (!Array.isArray(newItems)) throw new Error('items の配列がありません: ' + src);
  const existing = Array.isArray(playlist.items) ? playlist.items : [];
  const byId = new Map(existing.filter(it => it.id).map(it => [it.id, it]));

  const protectedIds = [];
  const merged = newItems.map(it => {
    const old = it.id && byId.get(it.id);
    if (old && old.hintLocked) {
      if (it.hint !== old.hint) protectedIds.push(it.id);
      return Object.assign({}, it, { hint: old.hint, hintLocked: true });
    }
    return it;
  });

  let items;
  if (replace) items = merged;
  else {
    // 同じ id の項目はその位置で置き換え、新しい id は末尾に足す
    const mergedById = new Map(merged.filter(it => it.id).map(it => [it.id, it]));
    items = existing.map(it => (it.id && mergedById.get(it.id)) || it)
      .concat(merged.filter(it => !(it.id && byId.has(it.id))));
  }
  const out = Object.assign({}, playlist, { items });
  fs.writeFileSync(playlistPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`${path.relative(process.cwd(), playlistPath)}: ${items.length} 項目 (${merged.length} 件取り込み${replace ? '、置き換え' : ''})`);
  if (protectedIds.length) console.log('手直し済みのヒントを保護: ' + protectedIds.join(', '));
}

try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
