# すけ君のHP制作 — 北河内応援プロジェクト

## ファイル構成

```
sukekun-hp/
├── index.html              ← LP本体（単一ファイル完結）
├── images/
│   ├── sukekun-beer.png    ← ヒーロー画像・OGP用（配置してください）
│   └── sukekun-steak.png   ← Aboutセクション用（配置してください）
└── README.md
```

## ローカル確認

```bash
cd sukekun-hp
python3 -m http.server 8080
# → http://localhost:8080 で確認
```

※ `index.html` をブラウザで直接開くと OGP や一部パスが正しく動作しない場合があるため、http.server 経由を推奨。

---

## デプロイ手順

### Cloudflare Pages（推奨）

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン
2. **Workers & Pages → Create application → Pages → Upload assets** を選択
3. `sukekun-hp/` フォルダをそのままドラッグ&ドロップ
4. プロジェクト名を入力して「Deploy site」をクリック
5. 数秒で `https://プロジェクト名.pages.dev` のURLが発行される

**カスタムドメインを使う場合:**
- Pages プロジェクトの「Custom domains」タブからドメインを追加
- ドメインレジストラ側で CNAME を `プロジェクト名.pages.dev` に向ける

---

### Netlify（代替）

1. [Netlify](https://app.netlify.com/) にログイン
2. **Add new site → Deploy manually** を選択
3. `sukekun-hp/` フォルダをドラッグ&ドロップ
4. `https://ランダム名.netlify.app` のURLが即時発行される

---

## 画像の配置ガイド

`sukekun-hp/images/` 配下に以下の4枚を配置してください。

| ファイル名 | キャラ | 用途 |
|---|---|---|
| `sukekun-beer.png` | 探検帽＋ビール（目を開けて笑顔） | ヒーロー右側 + OGP画像 |
| `sukekun-steak.png` | ナイフとフォークでステーキ | Aboutセクション左側 |
| `sukekun-cheers.png` | 探検帽＋ビール（目を閉じて満面の笑み） | 「なぜ5万円〜?」見出し上の小マスコット |
| `sukekun-osaka.png` | 探検帽＋ビール＋「大阪（北河内）」テキスト | 最終CTA左下（PC）/ 上部中央（スマホ） |

- 画像がない状態でも崩れないよう `onerror` 処理済み
- OGP画像（sukekun-beer.png）は **1200×630px** が最適（X/Facebook推奨サイズ）
- それ以外は **1000×1000px 程度の正方形** でOK

---

## CTA リンク

全DMボタン → `https://www.instagram.com/gurume_tanken/`
