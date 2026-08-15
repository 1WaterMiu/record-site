export const AUTH_COOKIE = "record_auth";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;
export const USERS = ["WaterMiu", "Shiki"];

const USER_CONFIG = {
  WaterMiu: {
    dataPath: "data.json",
    relDir: "x_backup/twitter/WaterMiuuuuuuu",
  },
  Shiki: {
    dataPath: "data_shiki.json",
    relDir: "x_backup/twitter/Shiki",
  },
};

export function normalizeUser(value) {
  return USERS.includes(String(value || "")) ? String(value) : "WaterMiu";
}

export function dataPathForUser(user) {
  return USER_CONFIG[normalizeUser(user)].dataPath;
}

export function relDirForUser(user) {
  return USER_CONFIG[normalizeUser(user)].relDir;
}

export function isAuthorizedUser(user, pass, env) {
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

export function isAuthorizedPublishPassword(input, user, env) {
  const password = String(input || "");
  if (normalizeUser(user) === "Shiki") {
    return password === String(env.SHIKI_PUBLISH_PASSWORD || env.SHIKI_SITE_PASSWORD || "0317");
  }
  return password === String(env.PUBLISH_PASSWORD || env.SITE_PASSWORD || "1178");
}

export async function getRequestUser(request, env, dataUser = "") {
  if (USERS.includes(String(dataUser || ""))) {
    return String(dataUser);
  }

  const sessionUser = await getSessionUser(request, env);
  if (sessionUser) {
    return sessionUser;
  }

  return getBasicAuthUser(request, env);
}

export async function getSessionUser(request, env) {
  const token = getCookie(request.headers.get("Cookie") || "", AUTH_COOKIE);
  if (!token) return "";
  return verifySessionToken(token, env);
}

export function getBasicAuthUser(request, env) {
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

export async function createSessionToken(username, env) {
  const expires = Date.now() + SESSION_SECONDS * 1000;
  const payload = `${normalizeUser(username)}.${expires}`;
  const signature = await sign(payload, env);
  return `${payload}.${signature}`;
}

export function authCookie(token, requestUrl) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export function expiredAuthCookie() {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
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
