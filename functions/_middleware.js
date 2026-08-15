export async function onRequest(context) {
  const { request, env, next } = context;
  const auth = request.headers.get("Authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      try {
        const decoded = atob(encoded);
        const idx = decoded.indexOf(":");
        const user = idx >= 0 ? decoded.slice(0, idx) : "";
        const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
        if (isAuthorizedUser(user, pass, env)) {
          return next();
        }
      } catch (_) {}
    }
  }
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="record", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
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
