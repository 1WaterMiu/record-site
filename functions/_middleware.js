import {
  USERS,
  authCookie,
  createSessionToken,
  dataPathForUser,
  expiredAuthCookie,
  getRequestUser,
  isAuthorizedUser,
  normalizeUser,
  relDirForUser,
} from "./_auth.js";

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname === "/auth/user") {
    const user = await getRequestUser(request, env, context.data?.user);
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

  const user = await getRequestUser(request, env, context.data?.user);
  if (user) {
    if (!canAccessPath(user, url.pathname)) {
      return notFound();
    }

    context.data = context.data || {};
    context.data.user = user;
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

function canAccessPath(user, pathname) {
  const currentDataPath = `/${dataPathForUser(user)}`;
  const currentImageDir = `/${relDirForUser(user)}/`;
  const protectedPaths = USERS.flatMap((name) => [
    `/${dataPathForUser(name)}`,
    `/${relDirForUser(name)}/`,
  ]);

  for (const path of protectedPaths) {
    if (path.endsWith("/") ? pathname.startsWith(path) : pathname === path) {
      return path === currentDataPath || path === currentImageDir;
    }
  }

  return true;
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

function jsonOk(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
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

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
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
