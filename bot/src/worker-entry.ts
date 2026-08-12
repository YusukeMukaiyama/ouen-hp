import { handleWebhookRequest, type Env as WebhookEnv } from "../functions/api/line-webhook";

// wrangler.jsonc の main が指すエントリポイント。このWorkerはouen-hp本体サイトの
// ホスティングを兼ねない(LINEを受けてGitHubにコミットするだけの役割)ため、
// /api/line-webhook 以外は素通しせずそのまま404にする。
export type Env = WebhookEnv;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/line-webhook" && request.method === "POST") {
      return handleWebhookRequest(request, env, ctx.waitUntil.bind(ctx));
    }
    return new Response("not found", { status: 404 });
  },
};
