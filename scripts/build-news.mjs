#!/usr/bin/env node
// news.json → index.html の NEWS_SECTION_START/END マーカー間へHTML生成する
// ビルドスクリプト。ouenhp-line-cms(LINE Bot)がnews.jsonをコミットし、このスクリプトが
// index.htmlへ反映する(index.html自体は今まで通り直接編集可能なソースであり続け、
// マーカー間だけがビルドのたびに自動更新される)。
//
// ouenhp-line-cms/functions/_lib/schema.tsのNewsItemSchemaと検証ルールを一致させること。
// 別リポジトリのためコード共有できず、アプリ側+ビルド側の二重zod検証として意図的に
// 重複させている(不正なnews.jsonが来てもここでビルド自体を失敗させる安全網)。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEWS_PATH = join(ROOT, "news.json");
const INDEX_PATH = join(ROOT, "index.html");
const MARKER_START = "<!-- NEWS_SECTION_START -->";
const MARKER_END = "<!-- NEWS_SECTION_END -->";

const NewsItemSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.string(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(600),
  // Botが決定的に生成するパスのみを許可する。任意文字列を許すとimgタグに
  // 意図しないパスを埋め込めてしまう。既存サイトのimages/直下フラット構成に合わせている。
  imagePath: z
    .string()
    .regex(/^\/images\/uploaded-\d{8}-[0-9a-f]{8}\.(jpg|png)$/)
    .optional(),
});
const NewsFileSchema = z.array(NewsItemSchema);

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateJa(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function renderItem(item) {
  const title = escapeHtml(item.title);
  const body = escapeHtml(item.body);
  const dateLabel = formatDateJa(item.date);
  const image = item.imagePath
    ? `
        <img src="${escapeHtml(item.imagePath)}" alt="${title}" loading="lazy" decoding="async"
             class="w-full sm:w-40 sm:flex-shrink-0 aspect-video sm:aspect-square rounded-2xl object-cover" />`
    : "";

  return `      <div class="bg-white rounded-3xl p-6 shadow-md border-2 border-ouen-yellow/50 card-hover flex flex-col sm:flex-row gap-5">${image}
        <div>
          <time datetime="${item.date}" class="inline-block text-[11px] font-black text-ouen-red bg-ouen-yellow/30 px-3 py-1 rounded-full mb-2">${dateLabel}</time>
          <h3 class="font-black text-ouen-navy text-lg mb-1">${title}</h3>
          <p class="text-sm text-ouen-navy/70 leading-relaxed whitespace-pre-line">${body}</p>
        </div>
      </div>`;
}

function renderNewsHtml(items) {
  if (items.length === 0) {
    return `      <p class="text-center text-ouen-navy/50 font-bold text-sm">お知らせは準備中です。</p>`;
  }
  // Botはprependで書き込むが、書き込み順に依存せず常にcreatedAt降順で描画する。
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted.map(renderItem).join("\n");
}

function main() {
  const rawNews = readFileSync(NEWS_PATH, "utf-8");

  let parsedJson;
  try {
    parsedJson = JSON.parse(rawNews);
  } catch (err) {
    console.error(`build-news: news.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const result = NewsFileSchema.safeParse(parsedJson);
  if (!result.success) {
    console.error("build-news: news.json failed schema validation:");
    console.error(result.error.issues);
    process.exit(1);
  }

  const newsHtml = renderNewsHtml(result.data);

  const indexHtml = readFileSync(INDEX_PATH, "utf-8");
  const startIdx = indexHtml.indexOf(MARKER_START);
  const endIdx = indexHtml.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.error(`build-news: marker comments not found (or out of order) in ${INDEX_PATH}`);
    process.exit(1);
  }

  const before = indexHtml.slice(0, startIdx + MARKER_START.length);
  const after = indexHtml.slice(endIdx);
  const nextIndexHtml = `${before}\n${newsHtml}\n${after}`;

  writeFileSync(INDEX_PATH, nextIndexHtml, "utf-8");
  console.log(`build-news: wrote ${result.data.length} item(s) into ${INDEX_PATH}`);
}

main();
