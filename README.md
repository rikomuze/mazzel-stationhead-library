# MAZZEL Stationhead Library

スマホ向けの個人用Stationheadライブラリの土台です。

## 入っている機能
- 出演者フィルター
- EIKI強調表示
- 検索
- 音源あり / 音源未登録
- お気に入り（ブラウザ内保存）
- 音源の途中再生位置を保存
- 音源ゼロでも配信データだけ先に登録可能

## 配信データ
`data/episodes.json` を編集します。

`audioUrl` が空なら「音源未登録」。
Cloudflare R2等へ音源を置いた後、URLを入れるとプレイヤーになります。

## 動画（Cloudflare R2）
- 大きい動画はR2バケット `bmsg-videos` に保存し、Worker（`src/worker.js`）経由で `/videos/...` から配信します（シーク対応）。
- アップロードは `/upload/` のページから。パスワードはダッシュボードの Settings → Variables and Secrets で `UPLOAD_PASSWORD`（Secret）として登録します。
- `bmsg-fes-26/` フォルダの動画は BMSG FES ’26 ページに自動で並びます。
- 実際に配信されるのは `public/` の中身です。

## 次の段階
1. GitHubへ置く
2. Cloudflare Pagesにつなぐ
3. R2をPrivate運用
4. 自分だけアクセスできる認証を追加

※このスターターには音源ファイルは入っていません。
