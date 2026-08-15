const AUTH_COOKIE = "record_auth";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const USERS = ["WaterMiu", "Shiki"];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname === "/auth/user") {
    const user = await getSessionUser(request, env) || getBasicAuthUser(request, env);
    if (user) {
      return jsonOk({ user, users: USERS });
    }
    return jsonError(401, "Authentication required");
  }

  if (url.pathname === "/login") {
    if (request.method === "POST") {
      return handleLogin(request, env);
    }
    return loginPage({
      selectedUser: normalizeUser(url.searchParams.get("user")),
      nextPath: safeNext(url.searchParams.get("next")),
    });
  }

  if (url.pathname === "/logout") {
    return redirectToLogin(url, expiredAuthCookie());
  }

  const cookieUser = await getSessionUser(request, env);
  if (cookieUser) {
    return next();
  }

  const basicUser = getBasicAuthUser(request, env);
  if (basicUser) {
    return next();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(401, "Authentication required");
  }

  return loginPage({
    selectedUser: "WaterMiu",
    nextPath: `${url.pathname}${url.search}`,
  });
}

async function handleLogin(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return loginPage({ error: "Invalid login request." }, 400);
  }

  const username = normalizeUser(form.get("username"));
  const password = String(form.get("password") || "");
  const nextPath = safeNext(form.get("next"));

  if (!isAuthorizedUser(username, password, env)) {
    return loginPage({
      selectedUser: username,
      nextPath,
      error: "Wrong password.",
    }, 401);
  }

  const token = await createSessionToken(username, env);
  return new Response(null, {
    status: 303,
    headers: {
      "Location": nextPath,
      "Set-Cookie": authCookie(token, request.url),
      "Cache-Control": "no-store",
    },
  });
}

function getBasicAuthUser(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth) return "";

  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) return "";

  try {
    const decoded = atob(encoded);
    const idx = decoded.indexOf(":");
    const user = idx >= 0 ? decoded.slice(0, idx) : "";
    const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    return isAuthorizedUser(user, pass, env) ? normalizeUser(user) : "";
  } catch (_) {
    return "";
  }
}

function isAuthorizedUser(user, pass, env) {
  const username = String(user || "");
  const password = String(pass || "");
  const users = {
    WaterMiu: String(env.SITE_PASSWORD || "1178"),
    Shiki: String(env.SHIKI_SITE_PASSWORD || "0317"),
  };

  if (Object.prototype.hasOwnProperty.call(users, username)) {
    return password === users[username];
  }

  return Boolean(env.SITE_PASSWORD) && password === env.SITE_PASSWORD;
}

async function getSessionUser(request, env) {
  const token = getCookie(request.headers.get("Cookie") || "", AUTH_COOKIE);
  if (!token) return "";
  return verifySessionToken(token, env);
}

async function createSessionToken(username, env) {
  const expires = Date.now() + SESSION_SECONDS * 1000;
  const payload = `${normalizeUser(username)}.${expires}`;
  const signature = await sign(payload, env);
  return `${payload}.${signature}`;
}

async function verifySessionToken(token, env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return "";

  const [username, expiresText, signature] = parts;
  const user = normalizeUser(username);
  const expires = Number(expiresText);
  if (!USERS.includes(user) || !Number.isFinite(expires) || expires < Date.now()) {
    return "";
  }

  const expected = await sign(`${user}.${expiresText}`, env);
  return timingSafeEqual(signature, expected) ? user : "";
}

async function sign(value, env) {
  const keyBytes = new TextEncoder().encode(authSecret(env));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64Url(signature);
}

function authSecret(env) {
  return String(env.AUTH_SECRET || env.SITE_PASSWORD || env.PUBLISH_PASSWORD || "1178");
}

function getCookie(header, name) {
  const prefix = `${name}=`;
  for (const part of header.split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) {
      try {
        return decodeURIComponent(cookie.slice(prefix.length));
      } catch (_) {
        return "";
      }
    }
  }
  return "";
}

function authCookie(token, requestUrl) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

function expiredAuthCookie() {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function redirectToLogin(url, cookie) {
  const next = safeNext(url.searchParams.get("next")) || "/";
  const user = normalizeUser(url.searchParams.get("user"));
  return new Response(null, {
    status: 303,
    headers: {
      "Location": `/login?user=${encodeURIComponent(user)}&next=${encodeURIComponent(next)}`,
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
}

function safeNext(value) {
  const next = String(value || "/");
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function normalizeUser(value) {
  return USERS.includes(String(value || "")) ? String(value) : "WaterMiu";
}

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function base64Url(buffer) {
  let bin = "";
  for (const byte of new Uint8Array(buffer)) {
    bin += String.fromCharCode(byte);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function jsonOk(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function loginPage({ selectedUser = "WaterMiu", nextPath = "/", error = "" } = {}, status = 200) {
  const user = normalizeUser(selectedUser);
  const next = safeNext(nextPath);
  const body = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WaterMiu Login</title>
<style>
  :root { --bg:#fafafa; --card:#fff; --line:#e5e5e5; --text:#222; --muted:#888; --accent:#ff6b9d; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; font-family:-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background:var(--bg); color:var(--text); }
  .login { width:min(100%, 360px); background:var(--card); border:1px solid var(--line); border-radius:12px; padding:28px; box-shadow:0 10px 30px rgba(0,0,0,.06); }
  h1 { margin:0 0 18px; font-size:22px; line-height:1.2; }
  .user { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 14px; padding:12px 14px; border:1px solid var(--line); border-radius:999px; background:#fff; color:var(--accent); font:inherit; font-weight:700; cursor:pointer; }
  .user:hover, .user:focus-visible { border-color:var(--accent); outline:none; }
  .user span:last-child { color:var(--muted); font-size:12px; font-weight:500; }
  label { display:block; margin:0 0 6px; font-size:13px; font-weight:600; color:#444; }
  input[type=password] { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:8px; font:inherit; outline:none; }
  input[type=password]:focus { border-color:var(--accent); }
  .submit { width:100%; margin-top:16px; padding:12px; border:0; border-radius:8px; background:var(--accent); color:#fff; font:inherit; font-weight:700; cursor:pointer; }
  .submit:hover { opacity:.9; }
  .error { min-height:18px; margin:10px 0 0; color:#d33; font-size:13px; }
</style>
</head>
<body>
<main class="login">
  <h1>WaterMiu</h1>
  <form method="post" action="/login" autocomplete="on">
    <input type="hidden" id="username" name="username" value="${escapeHtml(user)}">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <button type="button" class="user" id="userButton" aria-label="Switch user">
      <span id="userLabel">${escapeHtml(user)}</span>
      <span>switch</span>
    </button>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit" class="submit">Login</button>
    <div class="error">${escapeHtml(error)}</div>
  </form>
</main>
<script>
  const users = ${JSON.stringify(USERS)};
  const button = document.getElementById("userButton");
  const label = document.getElementById("userLabel");
  const input = document.getElementById("username");
  button.addEventListener("click", () => {
    const index = users.indexOf(input.value);
    const next = users[(index + 1) % users.length];
    input.value = next;
    label.textContent = next;
  });
</script>
</body>
</html>`;

  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
