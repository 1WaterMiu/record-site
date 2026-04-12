export async function onRequest(context) {
  const { request, env, next } = context;
  const password = env.SITE_PASSWORD;
  if (!password) {
    return new Response("SITE_PASSWORD env var not set", { status: 500 });
  }
  const auth = request.headers.get("Authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      try {
        const decoded = atob(encoded);
        const idx = decoded.indexOf(":");
        const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
        if (pass === password) {
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
