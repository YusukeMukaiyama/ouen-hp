# bot/ — ouenhp-line-cms

LINEチャットで「グルメ探検隊のHP制作」公式サイト([ouen-hp.jp](https://ouen-hp.jp/))の
「お知らせ」欄を向山さん自身が編集できる仕組み。姉妹プロジェクト`line-site-cms`(PoC/MVP、
`01_開発/01_アプリ/line-site-cms/`)を、本番の自社サイト向けに移植したもの。

このディレクトリは`ouen-hp`リポジトリのサブディレクトリとして存在する(独立リポジトリではない)。
デプロイ先のCloudflare Worker名は`ouenhp-line-cms`(このディレクトリ名とは無関係)。
サイト本体(リポジトリ直下)とは完全に独立したデプロイ単位で、Cloudflare Workers Builds側で
このディレクトリをルートディレクトリに指定して連携する。

## line-site-cmsとの違い

- **配置**: line-site-cmsは独立リポジトリだが、こちらは`ouen-hp`リポジトリのサブディレクトリ
  (モノレポ)。GitHub連携するCloudflareのビルド設定は、このディレクトリをルートに指定する
- **ホスティング方式**: ouen-hp.jp本体はCloudflare PagesではなくGitHub Pages(GitHub Actions配信)。
  このWorkerはサイトのホスティングを兼ねない(line-site-cmsはASSETSバインディングでサイト配信も
  兼ねていたが、こちらは`/api/line-webhook`だけを持つ)
- **画像パス**: `/images/uploaded-{YYYYMMDD}-{hex8}.(jpg|png)`。既存サイトの`images/`直下フラット
  構成に合わせている(line-site-cmsの`/assets/images/`とは異なる)
- **news.jsonの配置**: リポジトリ直下`news.json`(このディレクトリからは`../news.json`。
  line-site-cmsは`src/content/news/news.json`。Astro Content Collectionを使わないため)
- **allowlist**: `"*"`ワイルドカード許可を実装していない。自社の本番サイトを編集できる権限のため、
  最初から具体的なuserIdのカンマ区切りのみで運用する
- **createdAt**: 必須(line-site-cmsはoptional。旧データ互換のため)。このリポジトリはBot以外が
  news.jsonを書き換えない前提なので、常に付与される値として扱ってよい
- **友だち追加時の案内・「使い方」キーワード応答**: line-site-cmsの実コード・計画書のどちらにも
  存在しなかったため新規設計([functions/api/line-webhook.ts](functions/api/line-webhook.ts)の
  `WELCOME_MESSAGE`/`HELP_KEYWORDS`)

## アーキテクチャ

```
LINEで向山さんがメッセージ送信(テキスト、または画像+任意のテキスト)
  → src/worker-entry.ts → functions/api/line-webhook.ts が受信
  → 署名検証 + 向山さんuserIdのallowlistチェック
  → ローディング表示 + 200を即座に返す
  → (非同期) 現在のnews.json取得 → 画像があればLINE Content APIから取得
    → Claude Haiku 4.5で単発判定(add/remove/clarifyの判別共用体) → 新branchに
    news.json(+画像があればimages/配下にも)をコミット
  → LINE Reply APIで提案内容そのもの + 「公開する/やめる」ボタンを返信
    (branch単位のプレビューURLは予測できないためURLには依存しない設計)
  → 「公開する」タップ → mainへfast-forwardマージ → GitHub Actionsが自動ビルド
    (Tailwind CSS + build-news.mjsでマーカー間HTML再生成)・GitHub Pagesへ自動デプロイ
```

このWorkerは`ouen-hp`本体サイトのホスティングとは完全に別物。「LINEを受けてGitHubにコミットするだけ」の役割に徹する。

## セットアップ(自分でやる必要がある部分)

line-site-cmsのREADMEと同じ形式。詳細な罠(LINE Official Account Managerの応答設定を切る手順、
Webhook検証など)は`01_開発/01_アプリ/line-site-cms/README.md`を参照。

### 1. LINE Developers Console

1. https://developers.line.biz/console/ で新規プロバイダー → Messaging APIチャンネルを作成
   (チャンネル名は「応援HP お知らせ編集用」等)
2. チャンネルシークレット・チャンネルアクセストークン(長期)を発行
3. 向山さんのLINE userIdを確認
4. LINE Official Account Manager → 設定 → 応答設定で、**「チャット」「あいさつメッセージ」
   「応答メッセージ」の3つをOFF**、**「Webhook」のみON**にする

### 2. Anthropic APIキー

https://console.anthropic.com/ で発行(Claude Codeのサブスクとは別課金)。

### 3. Cloudflare Workers(個人アカウント mukaiyama.yusuke0424@gmail.com)

1. このディレクトリ(`bot/`)で`wrangler kv namespace create PENDING_IMAGES` →
   発行されたidを`wrangler.jsonc`に反映
2. `wrangler secret put <NAME>` で6つのsecretを設定(`LINE_CHANNEL_SECRET` /
   `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_ALLOWED_USER_IDS`(向山さんのuserIdのみ) /
   `ANTHROPIC_API_KEY` / `GITHUB_TOKEN`(ouen-hpリポジトリ限定のfine-grained PAT、
   Contents: Read and write) / `GITHUB_REPO`=`YusukeMukaiyama/ouen-hp`)
3. `npx wrangler deploy` で初回デプロイ
4. Cloudflareダッシュボード → 対象Worker → Settings → ビルド → 「接続」で`ouen-hp`リポジトリと
   連携。**ルートディレクトリを`bot`に設定する**(モノレポのため。設定しないとリポジトリ直下を
   ビルド対象にしてしまい失敗する)。以後`bot/`配下の変更をpushすると自動ビルド・デプロイ

### 4. LINE Webhook URLの設定

デプロイ完了後、LINE Developers ConsoleのMessaging API設定でWebhook URLに
`https://ouenhp-line-cms.<アカウントのworkers.devサブドメイン>.workers.dev/api/line-webhook` を設定し、
「検証」ボタンで成功することを確認してから「Webhookの利用」をONにする。

## ローカル開発

```bash
cd bot
npm install
cp .dev.vars.example .dev.vars   # 値を埋めてから
npm run dev
npm run check   # 型チェック
```

## 既知の制約(意図的に省略しているもの)

- Webhook再送に対する冪等性チェックなし
- 画像はJPEG/PNGのみ、1ファイル1MBまで
- 画像の最適化(リサイズ・webp変換等)は行わない
- お知らせ1件につき画像は最大1枚
- 削除(remove)時、そのお知らせに紐づく画像ファイルは削除されず残る
