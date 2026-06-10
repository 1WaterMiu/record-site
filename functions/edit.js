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

  const id = String(body.id || "").trim();
  const tag = (body.tag || "").trim();
  const title = (body.title || "").trim();
  const text = (body.body || "").trim();
  const keepImages = Array.isArray(body.keepImages) ? body.keepImages.map(String) : null;
  const newImages = Array.isArray(body.images) ? body.images : [];
  if (!id) return jsonError(400, "id required");
  if (!tag || !title) return jsonError(400, "tag and title required");

  let dataArr;
  let dataFileSha;
  try {
    const cur = await ghGetFile(env, DATA_PATH);
    dataFileSha = cur.sha;
    dataArr = JSON.parse(utf8FromBase64(cur.content));
  } catch (e) {
    return jsonError(500, "Failed to fetch data.json: " + e.message);
  }

  const index = dataArr.findIndex((item) => String(item.id) === id);
  if (index < 0) return jsonError(404, "Record not found");

  const current = dataArr[index];
  const currentImages = Array.isArray(current.images) ? current.images : [];
  const currentImageSet = new Set(currentImages);
  const keptImages = keepImages ? keepImages.filter((path) => currentImageSet.has(path)) : currentImages;
  const addedImagePaths = [];
  const imageFiles = [];
  let nextImageNumber = getNextImageNumber(id, currentImages);

  for (const img of newImages) {
    if (!img || typeof img.data !== "string" || !img.data) {
      return jsonError(400, "Invalid image payload");
    }
    const ext = (img.ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const num = nextImageNumber++;
    const fname = `${id}_${num}.${ext}`;
    const fpath = `${REL_DIR}/${fname}`;
    imageFiles.push({ path: fpath, content_base64: img.data });
    const meta = {
      filename: `${id}_${num}`,
      extension: ext,
      type: "photo",
      tweet_id: Number(id),
      date: current.date,
      content: `${tag}\n${title}${text ? "\n" + text : ""}`,
      num: num,
    };
    imageFiles.push({
      path: `${fpath}.json`,
      content_base64: utf8ToBase64(JSON.stringify(meta, null, 2)),
    });
    addedImagePaths.push(fpath);
  }

  const finalImages = [...keptImages, ...addedImagePaths];
  const updated = {
    ...current,
    tag,
    title,
    body: text,
    images: finalImages,
  };

  if (
    current.tag === updated.tag &&
    current.title === updated.title &&
    (current.body || "") === updated.body &&
    sameArray(currentImages, finalImages)
  ) {
    return jsonOk({ ok: true, id, unchanged: true, images: finalImages });
  }

  dataArr[index] = updated;

  try {
    for (const file of imageFiles) {
      await ghCreateFile(env, file.path, file.content_base64, `edit image: ${title}`);
    }
    const commitSha = await ghUpdateFile(
      env,
      DATA_PATH,
      dataFileSha,
      utf8ToBase64(JSON.stringify(dataArr, null, 0)),
      `edit: ${tag} - ${title}`,
    );
    return jsonOk({ ok: true, id, commit: commitSha, images: finalImages });
  } catch (e) {
    return jsonError(500, "GitHub commit failed: " + e.message);
  }
}

function jsonOk(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    "User-Agent": "record-site-edit",
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

async function ghCreateFile(env, path, contentBase64, message) {
  const result = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: "main",
    }),
  });
  return result.commit?.sha;
}

async function ghUpdateFile(env, path, sha, contentBase64, message) {
  const result = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: contentBase64,
      sha,
      branch: "main",
    }),
  });
  return result.commit?.sha;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function getNextImageNumber(id, images) {
  let max = 0;
  const prefix = `${id}_`;
  for (const path of images) {
    const name = String(path).split("/").pop() || "";
    if (!name.startsWith(prefix)) continue;
    const n = Number.parseInt(name.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
