# display — WorkX 社内ディスプレイ用サイネージ

社内ディスプレイに URL を表示するだけで、`playlist.json` に書いたコンテンツを全画面でループ再生するページです。
チナミニの雑学クイズを WorkX 版のトンマナで表示することを主目的にしています。動画ファイルの受け渡しは不要で、
`playlist.json` を更新すれば 5 分以内に各ディスプレイへ反映されます。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | 再生ページ本体。JavaScript と CSS を同梱。外部 CDN には依存しません |
| `playlist.json` | 表示するコンテンツと秒数、ブランド文言 |
| `assets/workx-logo.png` | WorkX ロゴ |
| `vendor/qrcode.js` | QR コード生成ライブラリ(qrcode-generator 1.4.4、MIT) |
| `video/` | 動画版(mp4)のレンダラー。`index.html` を Chromium で撮影して ffmpeg で mp4 にする(後述) |

## 公開手順(GitHub Pages)

1. リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を既定ブランチの `/ (root)` にする。
   (現在の既定ブランチは `claude/hopeful-thompson-8i5a79`。Settings → General で `main` に改名してもよい)
2. 数分後に `https://nakamaasaki-dev.github.io/display/` で表示できる。
3. ディスプレイ側のブラウザでこの URL を全画面(キオスク)表示する。

Chrome をキオスクで起動する場合の例:

```
chrome --kiosk --noerrdialogs --disable-session-crashed-bubble "https://nakamaasaki-dev.github.io/display/"
```

ページ側でも次の対策を入れています。

- 5 分ごとに `playlist.json` を取り直し、変更があればループの切れ目で差し替える。
- 取得に失敗したときは直前の内容で流し続ける(前回の内容はブラウザ内に保存)。
- 24 時間に 1 回、ループの切れ目でページ自体を読み直す(ページの更新を反映するため)。
- 対応ブラウザでは画面スリープを抑止する(Wake Lock API)。
- 1920×1080 で設計し、画面サイズに合わせて拡縮する。

## playlist.json の書き方

```json
{
  "refreshSec": 300,
  "timing": { "title": 3, "question": 20, "hint": 15, "answer": 25, "cta": 8 },
  "brand": { "footer": "チナミニ(chinamini.app)| WorkX 息抜きシリーズ", "logo": "assets/workx-logo.png" },
  "items": [ ... ]
}
```

- `refreshSec`: playlist を取り直す間隔(秒)。最小 30。
- `timing`: クイズ各画面の秒数。項目ごとに `"timing": {...}` を書けば上書きできる。
- `brand`: タイトル画面と誘導画面の文言、フッター、ロゴ。省略時は WorkX 版の既定値。

### クイズ(`type: "quiz"`)

```json
{
  "type": "quiz",
  "id": "2026-09-02-evening",
  "category": "生き物",
  "question": "問題文",
  "choices": ["選択肢1", "選択肢2", "選択肢3"],
  "answer": 1,
  "hint": "ヒント",
  "explanation": "解説。最後は——で切る",
  "url": "https://chinamini.app/a/2026-09-02/evening?src=office",
  "urlLabel": "chinamini.app/a/2026-09-02/evening"
}
```

- `answer` は 1 始まり(①=1)。
- `url` は QR コードの中身。`?src=office` を付けて社内流入を区別する。
- `urlLabel` は誘導画面に文字で出す URL。省略時は `url` からスキームとクエリを除いたもの。
- `hintLocked: true` はヒントを手で直した項目の印。`video/merge-playlist.js` で取り込むとき、この項目のヒントは上書きしない。
- 画面は タイトル → 問題 → ヒント → 答えと解説(QR 付き) → 誘導(大きな QR)の順。合計 71 秒。

### 表示条件(全タイプ共通、省略可)

```json
"from": "2026-10-06",
"until": "2026-10-10T23:59:59",
"weekdays": [1, 2, 3, 4, 5],
"answerAt": "2026-10-07T12:00:00",
"enabled": true
```

- `from` / `until`: 表示期間。期間外の項目は飛ばす。
- `weekdays`: 表示する曜日(0=日 … 6=土)。
- `answerAt`: この日時までは答えと誘導を出さず、「答えはもう少しお待ちください」を出す。1 日 1 問で正解を翌日に出す運用に使う。
- `enabled: false`: 一時的に外す。

### その他のタイプ

```json
{ "type": "image", "src": "https://example.com/award.png", "sec": 15 }
{ "type": "video", "src": "https://example.com/quiz.mp4", "sec": 64 }
{ "type": "slide", "title": "先週の社内正答率", "subtitle": "10/6〜10/10",
  "lines": [ { "text": "ホッキョクグマ", "value": "72%" }, { "text": "コストコ", "value": "41%" } ],
  "url": "https://chinamini.app/?src=office", "sec": 15 }
```

- `image`: 他チームの表彰・新人紹介などの静止画。`sec` 秒表示。
- `video`: 既存の mp4 をそのまま流す。音は出さない。終了で次へ進む(`sec` は保険のタイムアウト)。
- `slide`: 見出しと行のリスト。`lines` は文字列でも `{k, text, value}` でもよい。`url` があれば右下に QR を出す。

## 週次更新の流れ(夜間バッチに組み込む場合)

1. バッチがその週の 5 問を `playlist.json` の形式で書き出す。
2. `git commit` して Pages に設定したブランチへ push する。
3. GitHub Pages が数分で更新され、各ディスプレイは次のループから新しい内容になる。

バッチが `playlist.json` を上書きするときは、`brand` と `timing` を保つか、`items` だけを差し替えてください。
書き出した問題を取り込むには `video/merge-playlist.js` が使えます。`brand` / `timing` を保ったまま `items` を更新し、
`"hintLocked": true` が付いた項目(納品済みの 5 本。ヒントを手で直したもの)は、同じ id の問題が来てもヒントを上書きしません。

```bash
node video/merge-playlist.js new-items.json            # id が同じ項目は置き換え、無ければ末尾に追加
node video/merge-playlist.js new-items.json --replace  # items を丸ごと新しい内容にする
```

## 動作確認用のパラメータ

| パラメータ | 内容 |
|---|---|
| `?item=2` | 3 番目の項目から始める |
| `?screen=answer` | クイズをその画面から始める(title / question / hint / answer / cta) |
| `?freeze=1` | 画面を止める(スクリーンショット用) |
| `?speed=10` | 10 倍速で進める |
| `?playlist=other.json` | 別の playlist を読む |

例: `index.html?item=0&screen=answer&freeze=1`

## 動画版(mp4)

`video/render.js` が、`playlist.json` のクイズを社内ディスプレイ向けの mp4(1920×1080、30fps、H.264、無音の音声トラック付き)にします。
このページ(`index.html`)を Chromium で開いて各画面を撮影し、ffmpeg で 1 本につなぐ方式なので、
QR コードの位置、秒数、長い解説の文字サイズ自動縮小(36px → 最小 26px)はサイネージとまったく同じ仕様になります。

構成は タイトル 3 秒 → 問題 20 秒 → ヒント 15 秒 → 答えと解説 25 秒(QR 付き) → 誘導 8 秒 の合計 71 秒で、
秒数は `playlist.json` の `timing` に従います。

### 手元で作る

```bash
cd video && npm ci && npx playwright install --with-deps chromium && cd ..
# ffmpeg(libx264)と日本語フォント(Noto Sans CJK JP)が必要。Ubuntu なら: sudo apt-get install ffmpeg fonts-noto-cjk

node video/render.js                                   # 全クイズ → out/<id>.mp4
node video/render.js --ids 2026-09-02-evening          # 一部だけ
node video/render.js --frames-only                     # 画面ごとの PNG だけ(out/frames/<id>/answer.png など)
```

| オプション | 内容 |
|---|---|
| `--playlist path` | 読む playlist(既定 `playlist.json`) |
| `--out dir` | 出力先(既定 `out/`) |
| `--ids a,b` | 書き出す id を絞る |
| `--font name` | 描画に使うフォント(既定 `Noto Sans CJK JP`。環境変数 `RENDER_FONT` でも可) |
| `--ffmpeg path` | ffmpeg のパス(既定 `ffmpeg`。環境変数 `FFMPEG` でも可) |
| `--crf n` | H.264 の画質(既定 18) |
| `--no-audio` | 無音トラックを付けない |

`out/render.json` に、各動画の秒数と解説の文字サイズが記録されます。

### 夜間バッチ(GitHub Actions)

`.github/workflows/render-videos.yml` が次のときに全クイズを書き出し、mp4 と確認用フレーム(答え・誘導)を
Actions の artifact「quiz-videos」に置きます(30 日保持)。

- `playlist.json` や `index.html`、`video/` が Pages 対象ブランチに push されたとき
- 毎週月曜 03:10(日本時間)
- Actions タブからの手動実行(`ids` で対象を絞れる)

週次バッチに組み込む場合は、バッチが `playlist.json` を更新して push すれば、その push で動画も作られます。
バッチ側で GitHub Actions を使う場合、`GITHUB_TOKEN` による push では他のワークフローが起動しないため、
そのときは `workflow_dispatch` でこのワークフローを呼ぶか、週次のスケジュール実行に任せてください。

### サイネージとの対応

サイネージで実機確認の結果を受けて決めた 2 点は、動画版にも同じ内容で入っています。

- 答えと解説の画面にも QR コードを常時表示する(右下、約 210px、キャプション「記事はこちら」。解説の幅はその分だけ狭い)。
- 解説の表示を 18 秒から 25 秒にする(進捗バーも 25 秒で右端に達する)。
