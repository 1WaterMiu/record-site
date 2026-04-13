const REL_DIR = "x_backup/twitter/WaterMiuuuuuuu";
const DATA_PATH = "data.json";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.PUBLISH_PASSWORD || !env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return jsonError(500, "Server not configured: missing PUBLISH_PASSWORD / GITHUB_TOKEN / GITHUB_REPO");
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonError(400, "Invalid JSON");
  }

  if (body.password !== env.PUBLISH_PASSWORD) {
    return jsonError(401, "Wrong publish password");
  }

  const tag = (body.tag || "").trim();
  const title = (body.title || "").trim();
  const text = (body.body || "").trim();
  const images = Array.isArray(body.images) ? body.images : [];
  if (!tag || !title) return jsonError(400, "tag and title required");

  const id = Date.now().toString();
  const now = new Date();
  const date = formatDate(now);

  // Build files list (path + base64 content)
  const files = [];
  const imageRelPaths = [];
  let num = 1;
  for (const img of images) {
    const ext = (img.ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const fname = `${id}_${num}.${ext}`;
    const fpath = `${REL_DIR}/${fname}`;
    files.push({ path: fpath, content_base64: img.data, encoding: "base64" });
    // metadata json so generator picks it up next regen
    const meta = {
      filename: `${id}_${num}`,
      extension: ext,
      type: "photo",
      tweet_id: Number(id),
      date: date,
      content: `${tag}码\n${title}${text ? "\n" + text : ""}`,
      num: num,
    };
    files.push({
      path: `${fpath}.json`,
      content_base64: utf8ToBase64(JSON.stringify(meta, null, 2)),
      encoding: "base64",
    });
    imageRelPaths.push(fpath);
    num++;
  }

  // Fetch current data.json from GitHub, append new entry, recommit
  const newEntry = {
    id: id,
    date: date,
    tag: tag,
    title: title,
    body: text,
    images: imageRelPaths,
  };

  let dataArr;
  try {
    const cur = await ghGetFile(env, DATA_PATH);
    dataArr = JSON.parse(utf8FromBase64(cur.content));
  } catch (e) {
    return jsonError(500, "Failed to fetch data.json: " + e.message);
  }
  dataArr.unshift(newEntry);
  files.push({
    path: DATA_PATH,
    content_base64: utf8ToBase64(JSON.stringify(dataArr, null, 0)),
    encoding: "base64",
  });

  try {
    const sha = await ghCommitFiles(env, files, `publish: ${tag} - ${title}`);
    return new Response(JSON.stringify({ ok: true, id, commit: sha }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return jsonError(500, "GitHub commit failed: " + e.message);
  }
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function utf8FromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function gh(env, path, init = {}) {
  const url = `https://api.github.com${path}`;
  const headers = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "record-site-publish",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(init.headers || {}),
  };
  const r = await fetch(url, { ...init, headers });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status} ${path}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function ghGetFile(env, path) {
  return gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodeURIComponent(path)}?ref=main`);
}

async function ghCommitFiles(env, files, message) {
  const repo = env.GITHUB_REPO;
  // 1. get current main ref
  const ref = await gh(env, `/repos/${repo}/git/ref/heads/main`);
  const baseSha = ref.object.sha;
  // 2. get base commit -> base tree
  const baseCommit = await gh(env, `/repos/${repo}/git/commits/${baseSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  // 3. create blobs for each file
  const treeEntries = [];
  for (const f of files) {
    const blob = await gh(env, `/repos/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: f.content_base64, encoding: "base64" }),
    });
    treeEntries.push({
      path: f.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  // 4. create new tree
  const tree = await gh(env, `/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  // 5. create commit
  const commit = await gh(env, `/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }),
  });

  // 6. update main ref
  await gh(env, `/repos/${repo}/git/refs/heads/main`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit.sha;
}
