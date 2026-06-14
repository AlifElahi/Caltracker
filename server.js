import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const dataFile = join(dataDir, "entries.json");
const authFile = join(dataDir, "auth.json");
const sessionsFile = join(dataDir, "sessions.json");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
let sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dataFile)) {
    const today = new Date().toISOString().slice(0, 10);
    await writeFile(
      dataFile,
      JSON.stringify(
        {
          settings: {
            maintenanceCalories: 2200,
            intakeGoal: 1200,
            maintenanceHistory: [{ date: today, calories: 2200 }],
            sessionStart: "",
            sessionEnd: ""
          },
          days: {}
        },
        null,
        2
      )
    );
  }
}

async function readAuth() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(authFile)) return null;
  return JSON.parse(await readFile(authFile, "utf8"));
}

async function writeAuth(auth) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(authFile, JSON.stringify(auth, null, 2));
}

async function loadSessions() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(sessionsFile)) return;
  const rawSessions = JSON.parse(await readFile(sessionsFile, "utf8"));
  sessions = new Map(
    Object.entries(rawSessions).filter(([, session]) => session.expiresAt > Date.now())
  );
  await saveSessions();
}

async function saveSessions() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(sessionsFile, JSON.stringify(Object.fromEntries(sessions), null, 2));
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return {
    user: {
      id: "owner",
      name: "Me",
      salt,
      hash
    }
  };
}

function verifyPassword(password, auth) {
  const user = auth.user || auth;
  const actual = Buffer.from(hashPassword(password, user.salt).user.hash, "hex");
  const expected = Buffer.from(user.hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map(cookie => cookie.trim())
      .filter(Boolean)
      .map(cookie => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

async function isAuthenticated(req) {
  const sessionId = parseCookies(req).calorie_session;
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    await saveSessions();
    return false;
  }
  session.expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14;
  await saveSessions();
  return true;
}

async function createSession(res) {
  const sessionId = randomBytes(32).toString("hex");
  sessions.set(sessionId, { expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14 });
  await saveSessions();
  res.setHeader("Set-Cookie", `calorie_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600`);
}

async function clearSession(req, res) {
  const sessionId = parseCookies(req).calorie_session;
  if (sessionId) sessions.delete(sessionId);
  await saveSessions();
  res.setHeader("Set-Cookie", "calorie_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}

async function readStore() {
  await ensureStore();
  const store = JSON.parse(await readFile(dataFile, "utf8"));
  const normalized = normalizeStore(store);
  if (normalized.changed) await writeStore(normalized.store);
  return normalized.store;
}

async function writeStore(store) {
  await ensureStore();
  await writeFile(dataFile, JSON.stringify(normalizeStore(store).store, null, 2));
}

function normalizeStore(store) {
  let changed = false;
  store.settings ||= {};
  store.days ||= {};

  if (!store.settings.maintenanceCalories) {
    store.settings.maintenanceCalories = 2200;
    changed = true;
  }

  if (!store.settings.intakeGoal) {
    store.settings.intakeGoal = 1200;
    changed = true;
  }

  if (!Array.isArray(store.settings.maintenanceHistory) || !store.settings.maintenanceHistory.length) {
    const existingDays = Object.keys(store.days).sort();
    store.settings.maintenanceHistory = [
      {
        date: existingDays[0] || new Date().toISOString().slice(0, 10),
        calories: Number(store.settings.maintenanceCalories || 2200)
      }
    ];
    changed = true;
  }

  let normalizedHistory = store.settings.maintenanceHistory
    .map(item => ({ date: item.date, calories: Number(item.calories || 0) }))
    .filter(item => item.date && item.calories > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!normalizedHistory.length) {
    const existingDays = Object.keys(store.days).sort();
    normalizedHistory = [
      {
        date: existingDays[0] || new Date().toISOString().slice(0, 10),
        calories: Number(store.settings.maintenanceCalories || 2200)
      }
    ];
  }

  if (JSON.stringify(normalizedHistory) !== JSON.stringify(store.settings.maintenanceHistory)) {
    store.settings.maintenanceHistory = normalizedHistory;
    changed = true;
  }

  store.settings.sessionStart ||= "";
  store.settings.sessionEnd ||= "";

  return { store, changed };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendBackup(res, store) {
  const date = new Date().toISOString().slice(0, 10);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="caltracker-backup-${date}.json"`
  });
  res.end(JSON.stringify({ exportedAt: new Date().toISOString(), ...store }, null, 2));
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    const auth = await readAuth();
    const authenticated = await isAuthenticated(req);
    return sendJson(res, 200, {
      configured: Boolean(auth),
      authenticated,
      user: authenticated ? { id: "owner", name: "Me" } : null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/setup") {
    if (await readAuth()) return sendJson(res, 409, { error: "Password is already configured." });
    const { password } = await readBody(req);
    if (!password || password.length < 8) {
      return sendJson(res, 400, { error: "Use a password with at least 8 characters." });
    }
    await writeAuth(hashPassword(password));
    await createSession(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const auth = await readAuth();
    if (!auth) return sendJson(res, 400, { error: "Create a password first." });
    const { password } = await readBody(req);
    if (!password || !verifyPassword(password, auth)) {
      return sendJson(res, 401, { error: "Wrong password." });
    }
    await createSession(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    await clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (!(await isAuthenticated(req))) {
    return sendJson(res, 401, { error: "Login required." });
  }

  if (req.method === "GET" && url.pathname === "/api/data") {
    return sendJson(res, 200, await readStore());
  }

  if (req.method === "PUT" && url.pathname === "/api/data") {
    const payload = await readBody(req);
    await writeStore(payload);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/backup") {
    return sendBackup(res, await readStore());
  }

  if (req.method === "POST" && url.pathname === "/api/restore") {
    const payload = await readBody(req);
    if (!payload || typeof payload !== "object" || !payload.settings || !payload.days) {
      return sendJson(res, 400, { error: "Backup file must contain settings and days." });
    }
    await writeStore({ settings: payload.settings, days: payload.days });
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const publicPaths = new Set(["/login.html", "/styles.css", "/login.js"]);

  if (!publicPaths.has(pathname) && !(await isAuthenticated(req))) {
    res.writeHead(302, { Location: "/login.html" });
    res.end();
    return;
  }

  if (pathname === "/login.html" && await isAuthenticated(req)) {
    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  }

  const target = join(publicDir, pathname);

  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(target);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(target)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      const handled = await handleApi(req, res);
      if (handled === false) sendJson(res, 404, { error: "Not found" });
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

await loadSessions();

server.listen(port, host, () => {
  console.log(`Calorie Calendar running at http://${host}:${port}`);
});
