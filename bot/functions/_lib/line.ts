export interface LineEnv {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  // カンマ区切りで複数人を許可できる編集者allowlist。まずは向山さん本人のuserIdのみで
  // 運用開始する想定だが、将来複数人に共有する可能性を見込んでカンマ区切り対応にしてある。
  LINE_ALLOWED_USER_IDS: string;
}

export function parseAllowedUserIds(env: LineEnv): string[] {
  return env.LINE_ALLOWED_USER_IDS.split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

// 文字列の内容による早期return差で応答時間が変わらないよう、定数時間で比較する。
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignature(
  env: LineEnv,
  rawBody: string,
  signature: string | null
): Promise<boolean> {
  // LINE_CHANNEL_SECRETの設定漏れ(空文字)でfail-open(誰でも署名検証を通せる)に
  // なるのを防ぐ。ダッシュボード側の設定ミスは型システムでは検出できないため、
  // ここで明示的にガードする。
  if (!signature || !env.LINE_CHANNEL_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.LINE_CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return timingSafeEqual(computed, signature);
}

export async function startLoading(env: LineEnv, userId: string, seconds = 20) {
  try {
    await fetch("https://api.line.me/v2/bot/chat/loading/start", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chatId: userId, loadingSeconds: seconds }),
    });
  } catch (err) {
    console.error("startLoading failed", err);
  }
}

export async function reply(env: LineEnv, replyToken: string, messages: unknown[]) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  return res.ok;
}

export async function push(env: LineEnv, to: string, messages: unknown[]) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });
  return res.ok;
}

// reply(無料・返信トークン使用)を優先し、失敗時のみpush(従量枠消費)にフォールバック。
export async function replyOrPush(
  env: LineEnv,
  replyToken: string | undefined,
  to: string,
  messages: unknown[]
) {
  if (replyToken) {
    const ok = await reply(env, replyToken, messages);
    if (ok) return;
  }
  const pushOk = await push(env, to, messages);
  // reply・pushの両方が失敗すると呼び出し元は例外なしで正常終了してしまい、
  // ユーザーには何も届かないまま気づけない。診断のため失敗時だけ明示的に警告する。
  if (!pushOk) console.error("replyOrPush: both reply and push failed");
}

export function textMessage(text: string) {
  return { type: "text", text };
}

export function confirmQuickReply(text: string, branch: string) {
  return {
    type: "text",
    text,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "公開する",
            data: `action=publish&branch=${encodeURIComponent(branch)}`,
            displayText: "公開する",
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "やめる",
            data: `action=cancel&branch=${encodeURIComponent(branch)}`,
            displayText: "やめる",
          },
        },
      ],
    },
  };
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

export async function fetchImageBase64(env: LineEnv, messageId: string) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`fetchImageBase64 failed: ${res.status}`);
  const contentType = res.headers.get("content-type") || "image/jpeg";
  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
    throw new Error(`unsupported image content-type: ${contentType}`);
  }
  const buf = await res.arrayBuffer();
  // GitHub Contents API(PUT)は1ファイル実質1MB程度が上限のため、超過分は早期に弾く。
  if (buf.byteLength > 1_000_000) {
    throw new Error("image too large (over 1MB)");
  }
  let binary = "";
  for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
  return { base64: btoa(binary), contentType: contentType as "image/jpeg" | "image/png" };
}
