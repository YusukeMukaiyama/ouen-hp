import { z } from "zod";

export const NewsItemSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // 並び順専用のISO日時。同日中に複数件追加されても順序が安定するようdateとは分けて持つ。
  // news.jsonはこのBot以外が書き換えない前提なので(line-site-cmsと違い旧データが存在しない)、
  // optionalにせず必須にしている。
  createdAt: z.string(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(600),
  // LLMの出力ではなくWebhookハンドラ側が決定的に生成するパスのみを許可する
  // (/images/uploaded-YYYYMMDD-{hex8}.(jpg|png))。任意文字列を許すとnews.json経由で
  // 意図しないパスをimgタグに埋め込めてしまう。既存サイトのimages/直下フラット構成に
  // 合わせており、line-site-cmsの/assets/images/とはパスが異なる点に注意。
  imagePath: z
    .string()
    .regex(/^\/images\/uploaded-\d{8}-[0-9a-f]{8}\.(jpg|png)$/)
    .optional(),
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

export const NewsFileSchema = z.array(NewsItemSchema);

// LLMに強制する判別共用体。「1回の依頼で1件だけ」に編集範囲を絞ることで、
// 生HTML編集より安全にしている核。line-site-cmsと同一設計。
export const EditProposalSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(600),
  }),
  z.object({
    action: z.literal("remove"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("clarify"),
    question: z.string().min(1).max(300),
  }),
]);

export type EditProposal = z.infer<typeof EditProposalSchema>;

// Anthropicのoutput_config.formatに渡すJSON Schema。
// 上のzodスキーマと意味的に一致させること(ワイヤー越しにzodをそのまま渡せないため手書き)。
export const EDIT_PROPOSAL_JSON_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        action: { const: "add" },
        title: { type: "string", minLength: 1, maxLength: 120 },
        body: { type: "string", minLength: 1, maxLength: 600 },
      },
      required: ["action", "title", "body"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        action: { const: "remove" },
        id: { type: "string", minLength: 1 },
      },
      required: ["action", "id"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        action: { const: "clarify" },
        question: { type: "string", minLength: 1, maxLength: 300 },
      },
      required: ["action", "question"],
      additionalProperties: false,
    },
  ],
} as const;
