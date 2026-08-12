export interface GitHubEnv {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "owner/repo"
}

const API = "https://api.github.com";

function headers(env: GitHubEnv) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ouenhp-line-cms",
  };
}

// コミットメッセージはASCIIのみ。GitHubのAPIはUTF-8コミットメッセージを
// エラーコード8000111で拒否する(03_AI-agentic-HP/AGENTS.mdの絶対ルールと同じ理由)。
// プロンプト側の指示だけに頼らず、ここでもハードに弾く。
export function assertAsciiCommitMessage(message: string): string {
  if (!/^[\x00-\x7F]*$/.test(message)) {
    throw new Error(`commit message must be ASCII only, got: ${message}`);
  }
  return message;
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function getFile(env: GitHubEnv, path: string, ref = "main") {
  const res = await fetch(
    `${API}/repos/${env.GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers: headers(env) }
  );
  if (!res.ok) throw new Error(`getFile failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content: string; sha: string };
  return { content: fromBase64Utf8(data.content), sha: data.sha };
}

export async function getRefSha(env: GitHubEnv, branch: string) {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/git/refs/heads/${branch}`, {
    headers: headers(env),
  });
  if (!res.ok) throw new Error(`getRefSha failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

// Contents APIはbranchを自動作成しない。git refsで先に作る必要がある。
export async function createBranch(env: GitHubEnv, branch: string, fromSha: string) {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/git/refs`, {
    method: "POST",
    headers: { ...headers(env), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
  if (!res.ok) throw new Error(`createBranch failed: ${res.status} ${await res.text()}`);
}

export async function putFile(
  env: GitHubEnv,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha: string
) {
  assertAsciiCommitMessage(message);
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers(env), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: toBase64Utf8(content), branch, sha }),
  });
  if (!res.ok) throw new Error(`putFile failed: ${res.status} ${await res.text()}`);
}

// 画像など新規バイナリファイル追加専用。contentは呼び出し側で既にbase64化済みのものを
// そのまま渡す(putFileのtoBase64Utf8を通すとバイナリが壊れるため別関数にしてある)。
// 新規追加のみを想定しているためshaを取らない(既存ファイル上書きが必要になったら要拡張)。
export async function putBinaryFile(
  env: GitHubEnv,
  path: string,
  base64Content: string,
  message: string,
  branch: string
) {
  assertAsciiCommitMessage(message);
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers(env), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: base64Content, branch }),
  });
  if (!res.ok) throw new Error(`putBinaryFile failed: ${res.status} ${await res.text()}`);
}

// force: false = fast-forwardのみ許可。mainが途中で動いていた場合は安全に失敗する。
export async function fastForwardMerge(env: GitHubEnv, toBranch: string, fromSha: string) {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/git/refs/heads/${toBranch}`, {
    method: "PATCH",
    headers: { ...headers(env), "Content-Type": "application/json" },
    body: JSON.stringify({ sha: fromSha, force: false }),
  });
  if (!res.ok) throw new Error(`fastForwardMerge failed: ${res.status} ${await res.text()}`);
}

export async function deleteBranch(env: GitHubEnv, branch: string) {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/git/refs/heads/${branch}`, {
    method: "DELETE",
    headers: headers(env),
  });
  if (!res.ok && res.status !== 422) {
    console.error(`deleteBranch warning: ${res.status} ${await res.text()}`);
  }
}
