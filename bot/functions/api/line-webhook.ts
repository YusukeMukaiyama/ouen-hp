import {
  verifySignature,
  startLoading,
  replyOrPush,
  textMessage,
  confirmQuickReply,
  fetchImageBase64,
  parseAllowedUserIds,
  type LineEnv,
} from "../_lib/line";
import {
  getFile,
  getRefSha,
  createBranch,
  putFile,
  putBinaryFile,
  fastForwardMerge,
  deleteBranch,
  type GitHubEnv,
} from "../_lib/github";
import { proposeEdit } from "../_lib/agent";
import { NewsFileSchema, type NewsItem } from "../_lib/schema";

export interface Env extends LineEnv, GitHubEnv {
  ANTHROPIC_API_KEY: string;
  PENDING_IMAGES: KVNamespace;
}

// 友だち追加時の案内、および「使い方」再呼び出し時の共通文面。
// line-site-cms本体にはfollowイベント処理も使い方キーワードも実装されていなかったため
// (READMEの説明とは異なり実コードには存在しなかった)、ここが新規設計。
const WELCOME_MESSAGE = `「グルメ探検隊のHP制作」公式サイト(ouen-hp.jp)のお知らせ編集Botです。

このトークで話しかけると、サイトの「お知らせ」欄を更新できます。

■ 追加する
伝えたい内容をそのまま送ってください。画像を1枚添付してもOKです。

■ 削除する
「〇〇のお知らせを消して」のように伝えてください。

■ 公開する
内容を提案すると「公開する/やめる」ボタンが届きます。確認してから公開してください。

「使い方」と送るといつでもこの説明を再表示します。`;

const HELP_KEYWORDS = new Set(["使い方", "つかいかた", "ヘルプ", "help"]);

// Cloudflare KVのexpirationTtlは60秒未満を指定できない仕様のため、これが実質最小値。
const PENDING_IMAGE_TTL_SECONDS = 60;

function pendingImageKey(senderId: string): string {
  return `pending-image:${senderId}`;
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; id?: string; text?: string };
  postback?: { data: string };
}

const NEWS_PATH = "news.json";
const MAIN_BRANCH = "main";

function makeBranchName() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHmmss
  const suffix = crypto.randomUUID().slice(0, 4);
  return `news-${stamp}-${suffix}`;
}

// news.jsonのimagePathの正規表現(schema.ts)と一致させること。既存サイトの
// images/直下フラット命名規則(例: works-ichibiriya.webp)に寄せているが、Bot生成物は
// 手動アップロード分と衝突しないよう uploaded- プレフィックスで区別する。
function makeImagePath(contentType: "image/jpeg" | "image/png"): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = crypto.randomUUID().slice(0, 8);
  const ext = contentType === "image/png" ? "png" : "jpg";
  return `/images/uploaded-${stamp}-${suffix}.${ext}`;
}

function productionUrl(): string {
  return "https://ouen-hp.jp";
}

export async function handleWebhookRequest(
  request: Request,
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void
): Promise<Response> {
  // 必須環境変数が空/未設定だと署名検証・allowlistチェックがfail-openになりうる。
  // ダッシュボード側の設定漏れは型では検出できないため、ここで明示的に止める。
  const requiredVars: (keyof Env)[] = [
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_ALLOWED_USER_IDS",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
    "GITHUB_REPO",
  ];
  if (requiredVars.some((key) => !env[key])) {
    console.error("missing required environment variable(s)");
    return new Response("server misconfigured", { status: 500 });
  }
  const allowedUserIds = parseAllowedUserIds(env);
  if (allowedUserIds.length === 0) {
    console.error("LINE_ALLOWED_USER_IDS resolved to an empty allowlist");
    return new Response("server misconfigured", { status: 500 });
  }

  // 署名検証にはraw bodyが必要。request.json()を先に呼んでbodyを消費してはいけない。
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!(await verifySignature(env, rawBody, signature))) {
    return new Response("invalid signature", { status: 400 });
  }

  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // LINE Developers Consoleの「検証」ボタンはevents:[]の空配列を送ってくる。
  // ここまで到達すれば200を返せば足りる。
  for (const event of payload.events ?? []) {
    // allowlist外は静かに無視する(理由を漏らさない)。
    // source.userIdが欠落するイベント種別(グループ/ルーム発の一部イベント等)で
    // 両辺undefinedのまま一致してしまわないよう、非空文字列であることも要求する。
    const senderId = event.source?.userId;
    if (typeof senderId !== "string" || !senderId) continue;
    // ワイルドカード許可は実装しない。自社の本番サイトを編集できる権限のため、
    // allowlistは常に具体的なuserIdのカンマ区切りのみで運用する。
    if (!allowedUserIds.includes(senderId)) {
      // allowlist未登録の人物のuserIdをここに残しておくことで、新しい編集者を
      // 追加したいとき「一度メッセージを送ってもらい、この行をwrangler tailで見る」
      // だけでuserIdが分かる(LINEには自分のuserIdを確認する簡単な公式手段がないため)。
      console.log(`rejected sender not in allowlist: ${senderId}`);
      continue;
    }

    if (event.type === "follow") {
      waitUntil(replyOrPush(env, event.replyToken, senderId, [textMessage(WELCOME_MESSAGE)]));
      continue;
    }

    if (event.type === "postback") {
      waitUntil(handlePostback(env, event, senderId));
      continue;
    }

    if (event.type === "message" && event.message?.type === "text") {
      const trimmed = (event.message.text ?? "").trim();
      if (HELP_KEYWORDS.has(trimmed)) {
        waitUntil(replyOrPush(env, event.replyToken, senderId, [textMessage(WELCOME_MESSAGE)]));
        continue;
      }
    }

    if (
      event.type === "message" &&
      (event.message?.type === "text" || event.message?.type === "image")
    ) {
      waitUntil(startLoading(env, senderId, 20));
      waitUntil(handleEditRequest(env, event, senderId));
    }
  }

  return new Response(null, { status: 200 });
}

async function handleEditRequest(env: Env, event: LineEvent, senderId: string) {
  try {
    const { content: currentJson, sha } = await getFile(env, NEWS_PATH, MAIN_BRANCH);
    const currentItems = NewsFileSchema.parse(JSON.parse(currentJson));

    let image: { base64: string; contentType: "image/jpeg" | "image/png" } | undefined;
    let userMessage = event.message?.text ?? "";
    const key = pendingImageKey(senderId);

    if (event.message?.type === "image" && event.message.id) {
      image = await fetchImageBase64(env, event.message.id);
      userMessage = userMessage || "この画像に合うお知らせを追加してください。";
      // LINEは画像とテキストを同一メッセージにできない(「画像はこれを差し込んで」のような
      // 後続の指示テキストが常に別イベントで届く)。少しの間だけ直近画像として覚えておき、
      // 次のテキストメッセージ処理時に拾えるようにする(会話履歴を持たない設計への最小限の例外)。
      await env.PENDING_IMAGES.put(key, JSON.stringify(image), {
        expirationTtl: PENDING_IMAGE_TTL_SECONDS,
      });
    } else if (event.message?.type === "text") {
      const pending = await env.PENDING_IMAGES.get(key);
      if (pending) {
        image = JSON.parse(pending);
        // 消費型: 一度使ったら消す。残しておくと後の無関係なテキストに
        // 古い画像が誤って付いてしまう。
        await env.PENDING_IMAGES.delete(key);
      }
    }

    const proposal = await proposeEdit({
      apiKey: env.ANTHROPIC_API_KEY,
      currentItems,
      userMessage,
      image,
    });

    if (proposal.action === "clarify") {
      await replyOrPush(env, event.replyToken, senderId, [textMessage(proposal.question)]);
      return;
    }

    let nextItems: NewsItem[];
    let commitMessage: string;
    // LINEの確認メッセージに提案内容そのものを表示するために保持しておく。
    // ブランチ単位のプレビューURLは予測できないため、これが実質的なレビュー手段になる。
    let previewText: string;
    // 画像がある場合、newsコミットと同じbranchに追加でコミットする対象パス。
    let imagePath: string | undefined;

    if (proposal.action === "add") {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const id = `${today}-${crypto.randomUUID().slice(0, 8)}`;
      if (image) imagePath = makeImagePath(image.contentType);
      nextItems = [
        {
          id,
          date: today,
          createdAt: now.toISOString(),
          title: proposal.title,
          body: proposal.body,
          ...(imagePath ? { imagePath } : {}),
        },
        ...currentItems,
      ];
      commitMessage = "Add news item via LINE bot";
      previewText = `追加案:\n【${proposal.title}】\n${proposal.body}${image ? "\n(画像を1枚添付)" : ""}`;
    } else {
      const target = currentItems.find((item) => item.id === proposal.id);
      if (!target) {
        await replyOrPush(env, event.replyToken, senderId, [
          textMessage("指定されたお知らせが見つかりませんでした。もう一度内容を教えてください。"),
        ]);
        return;
      }
      nextItems = currentItems.filter((item) => item.id !== proposal.id);
      commitMessage = "Remove news item via LINE bot";
      previewText = `削除案:\n【${target.title}】`;
    }

    const branch = makeBranchName();
    const mainSha = await getRefSha(env, MAIN_BRANCH);
    await createBranch(env, branch, mainSha);
    if (image && imagePath) {
      // 既存サイトのimages/はAstro等のbuild pipelineを経由しないただの静的配信ディレクトリ
      // なので、リポジトリ直下images/にそのまま置けばそのまま配信される。
      await putBinaryFile(
        env,
        `images${imagePath.replace(/^\/images/, "")}`,
        image.base64,
        "Add uploaded image via LINE bot",
        branch
      );
    }
    await putFile(env, NEWS_PATH, JSON.stringify(nextItems, null, 2) + "\n", commitMessage, branch, sha);

    await replyOrPush(env, event.replyToken, senderId, [
      confirmQuickReply(`${previewText}\n\n上記の内容で公開しますか?`, branch),
    ]);
  } catch (err) {
    console.error("handleEditRequest failed", err);
    await replyOrPush(env, event.replyToken, senderId, [
      textMessage("エラーが発生しました。もう少し具体的な指示で再度お試しください。"),
    ]);
  }
}

async function handlePostback(env: Env, event: LineEvent, senderId: string) {
  const data = new URLSearchParams(event.postback?.data ?? "");
  const action = data.get("action");
  const branch = data.get("branch");
  if (!branch) return;

  try {
    if (action === "publish") {
      const branchSha = await getRefSha(env, branch);
      await fastForwardMerge(env, MAIN_BRANCH, branchSha);
      await deleteBranch(env, branch);
      await replyOrPush(env, event.replyToken, senderId, [
        textMessage(`公開しました。\n${productionUrl()}\n反映まで数分ほどお待ちください。`),
      ]);
    } else if (action === "cancel") {
      await deleteBranch(env, branch);
      await replyOrPush(env, event.replyToken, senderId, [textMessage("取り消しました。")]);
    }
  } catch (err) {
    console.error("handlePostback failed", err);
    await replyOrPush(env, event.replyToken, senderId, [
      textMessage("処理中にエラーが発生しました。"),
    ]);
  }
}
