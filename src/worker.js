// MAZZEL Stationhead Library Worker
// - 静的ファイル（public/）はCloudflareのassetsがそのまま返す
// - /videos/<key>      : R2（VIDEOS）の動画を返す（Range対応でシーク可能）
// - /api/videos        : 指定フォルダの動画一覧（ページ表示用・公開）
// - /api/upload/*      : ブラウザからの分割アップロード（UPLOAD_PASSWORD 必須）
// - /api/delete        : 動画の削除（UPLOAD_PASSWORD 必須）

const PUBLIC_FOLDERS = ["bmsg-fes-26/", "archive/"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith("/videos/")) return await serveVideo(request, env, path);
      if (path === "/api/videos") return await listVideos(env, url);
      if (path.startsWith("/api/upload/") || path === "/api/delete") {
        const denied = checkPassword(request, env);
        if (denied) return denied;
        return await handleUpload(request, env, path);
      }
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 500);
    }

    return env.ASSETS.fetch(request);
  },
};

// ---------- 動画の配信 ----------
async function serveVideo(request, env, path) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const key = decodeURIComponent(path.slice("/videos/".length));
  if (!key) return new Response("Not found", { status: 404 });

  if (request.method === "HEAD") {
    const head = await env.VIDEOS.head(key);
    if (!head) return new Response(null, { status: 404 });
    const headers = baseHeaders(head);
    headers.set("content-length", String(head.size));
    return new Response(null, { headers });
  }

  let obj;
  try {
    obj = await env.VIDEOS.get(key, { range: request.headers, onlyIf: request.headers });
  } catch (err) {
    // 範囲指定がファイルサイズを超えている場合など
    const head = await env.VIDEOS.head(key);
    if (!head) return new Response("Not found", { status: 404 });
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { "content-range": `bytes */${head.size}` },
    });
  }
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = baseHeaders(obj);
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  if (request.headers.has("range") && obj.range) {
    let offset, length;
    if ("suffix" in obj.range && obj.range.suffix !== undefined) {
      length = Math.min(obj.range.suffix, obj.size);
      offset = obj.size - length;
    } else {
      offset = obj.range.offset ?? 0;
      length = obj.range.length ?? obj.size - offset;
    }
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

function baseHeaders(obj) {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (!headers.has("content-type")) headers.set("content-type", guessType(obj.key));
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=86400");
  return headers;
}

// ---------- 一覧 ----------
async function listVideos(env, url) {
  let prefix = url.searchParams.get("folder") || "";
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  if (!PUBLIC_FOLDERS.includes(prefix)) {
    return json({ error: "このフォルダは公開されていません" }, 403);
  }
  return json({ videos: await collect(env, prefix) });
}

async function collect(env, prefix) {
  const videos = [];
  let cursor;
  do {
    const page = await env.VIDEOS.list({ prefix, cursor, include: ["customMetadata", "httpMetadata"] });
    for (const o of page.objects) {
      const meta = decodeMeta(o.customMetadata || {});
      videos.push({
        key: o.key,
        url: "/videos/" + o.key.split("/").map(encodeURIComponent).join("/"),
        size: o.size,
        uploaded: o.uploaded,
        type: (o.httpMetadata && o.httpMetadata.contentType) || guessType(o.key),
        title: meta.title || "",
        date: meta.date || "",
        memo: meta.memo || "",
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  videos.sort((a, b) => (b.date || b.uploaded).localeCompare(a.date || a.uploaded));
  return videos;
}

// ---------- アップロード（管理用） ----------
function checkPassword(request, env) {
  if (!env.UPLOAD_PASSWORD) {
    return json({ error: "UPLOAD_PASSWORD がまだ設定されていません（Cloudflareのダッシュボードで設定してください）" }, 503);
  }
  const given = request.headers.get("x-upload-password") || "";
  if (!timingSafeEqual(given, env.UPLOAD_PASSWORD)) {
    return json({ error: "パスワードが違います" }, 401);
  }
  return null;
}

async function handleUpload(request, env, path) {
  const url = new URL(request.url);

  if (path === "/api/upload/check") return json({ ok: true });

  if (path === "/api/upload/list" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    return json({ videos: await collect(env, cleanFolder(body.folder || "")) });
  }

  if (path === "/api/upload/create" && request.method === "POST") {
    const body = await request.json();
    const key = buildKey(body.folder, body.filename);
    const upload = await env.VIDEOS.createMultipartUpload(key, {
      httpMetadata: { contentType: body.contentType || guessType(key) },
      customMetadata: encodeMeta({ title: body.title, date: body.date, memo: body.memo }),
    });
    return json({ key: upload.key, uploadId: upload.uploadId });
  }

  if (path === "/api/upload/part" && request.method === "PUT") {
    const key = url.searchParams.get("key");
    const uploadId = url.searchParams.get("uploadId");
    const partNumber = Number(url.searchParams.get("partNumber"));
    if (!key || !uploadId || !partNumber || !request.body) return json({ error: "パラメータが足りません" }, 400);
    const upload = env.VIDEOS.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }

  if (path === "/api/upload/complete" && request.method === "POST") {
    const body = await request.json();
    const upload = env.VIDEOS.resumeMultipartUpload(body.key, body.uploadId);
    const obj = await upload.complete(body.parts);
    return json({ key: obj.key, size: obj.size });
  }

  if (path === "/api/upload/abort" && request.method === "POST") {
    const body = await request.json();
    await env.VIDEOS.resumeMultipartUpload(body.key, body.uploadId).abort();
    return json({ ok: true });
  }

  if (path === "/api/delete" && request.method === "POST") {
    const body = await request.json();
    if (!body.key) return json({ error: "key がありません" }, 400);
    await env.VIDEOS.delete(body.key);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

// ---------- 小さな道具 ----------
function cleanFolder(folder) {
  let f = String(folder || "").trim().replace(/^\/+/, "").replace(/\.\.+/g, "");
  if (f && !f.endsWith("/")) f += "/";
  return f;
}

function buildKey(folder, filename) {
  const name = String(filename || "video.mp4").trim().replace(/[\/\\]/g, "_").replace(/\s+/g, "-");
  return cleanFolder(folder) + name;
}

function encodeMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) if (v) out[k] = encodeURIComponent(String(v).slice(0, 500));
  return out;
}

function decodeMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function guessType(key) {
  const ext = (key.split(".").pop() || "").toLowerCase();
  return {
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mkv: "video/x-matroska", m4a: "audio/mp4", mp3: "audio/mpeg", jpg: "image/jpeg", png: "image/png",
  }[ext] || "application/octet-stream";
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
