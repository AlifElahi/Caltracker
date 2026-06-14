import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { MongoClient } from "mongodb";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const dataFile = join(dataDir, "entries.json");
const authFile = join(dataDir, "auth.json");
const sessionsFile = join(dataDir, "sessions.json");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const mongoUri = process.env.MONGODB_URI || "";
const mongoDbName = process.env.MONGODB_DB || "caltracker";
const mongoCollectionName = process.env.MONGODB_COLLECTION || "app_state";
const useMongo = Boolean(mongoUri);
let mongoClient;
let mongoCollection;
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

function defaultStore() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    settings: {
      maintenanceCalories: 2200,
      intakeGoal: 1200,
      maintenanceHistory: [{ date: today, calories: 2200 }],
      sessionStart: "",
      sessionEnd: ""
    },
    days: {}
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name
  };
}

function slugify(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "user";
}

function uniqueUserId(auth, name) {
  const base = slugify(name);
  const existing = new Set((auth?.users || []).map(user => user.id));
  if (!existing.has(base)) return base;

  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
}

function userStoreFile(userId) {
  return userId === "owner" ? dataFile : join(dataDir, `entries-${userId}.json`);
}

function userStoreDocumentId(userId) {
  return userId === "owner" ? "entries" : `entries:${userId}`;
}

function normalizeAuth(auth) {
  if (!auth) return { auth: null, changed: false };
  let changed = false;

  if (!Array.isArray(auth.users)) {
    const legacyUser = auth.user || auth;
    auth = {
      users: [
        {
          id: legacyUser.id || "owner",
          name: legacyUser.name || "Me",
          salt: legacyUser.salt,
          hash: legacyUser.hash
        }
      ]
    };
    changed = true;
  }

  auth.users = auth.users
    .map(user => ({
      id: user.id || slugify(user.name),
      name: user.name || user.id || "User",
      salt: user.salt,
      hash: user.hash
    }))
    .filter(user => user.salt && user.hash);

  return { auth, changed };
}

async function getMongoCollection() {
  if (!useMongo) return null;
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    mongoCollection = mongoClient.db(mongoDbName).collection(mongoCollectionName);
  }
  return mongoCollection;
}

async function ensureStore() {
  if (useMongo) {
    const collection = await getMongoCollection();
    await collection.updateOne(
      { _id: "entries" },
      { $setOnInsert: { ...defaultStore(), createdAt: new Date() } },
      { upsert: true }
    );
    return;
  }

  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dataFile)) {
    await writeFile(dataFile, JSON.stringify(defaultStore(), null, 2));
  }
}

async function readAuth() {
  let auth;
  if (useMongo) {
    const collection = await getMongoCollection();
    const document = await collection.findOne({ _id: "auth" });
    auth = document?.auth || null;
  } else {
    await mkdir(dataDir, { recursive: true });
    if (!existsSync(authFile)) return null;
    auth = JSON.parse(await readFile(authFile, "utf8"));
  }

  const normalized = normalizeAuth(auth);
  if (normalized.changed) await writeAuth(normalized.auth);
  return normalized.auth;
}

async function writeAuth(auth) {
  if (useMongo) {
    const collection = await getMongoCollection();
    await collection.replaceOne(
      { _id: "auth" },
      { _id: "auth", auth, updatedAt: new Date() },
      { upsert: true }
    );
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(authFile, JSON.stringify(auth, null, 2));
}

async function loadSessions() {
  if (useMongo) {
    const collection = await getMongoCollection();
    const document = await collection.findOne({ _id: "sessions" });
    const rawSessions = document?.sessions || {};
    sessions = new Map(
      Object.entries(rawSessions).filter(([, session]) => session.expiresAt > Date.now())
    );
    await saveSessions();
    return;
  }

  await mkdir(dataDir, { recursive: true });
  if (!existsSync(sessionsFile)) return;
  const rawSessions = JSON.parse(await readFile(sessionsFile, "utf8"));
  sessions = new Map(
    Object.entries(rawSessions).filter(([, session]) => session.expiresAt > Date.now())
  );
  await saveSessions();
}

async function saveSessions() {
  if (useMongo) {
    const collection = await getMongoCollection();
    await collection.replaceOne(
      { _id: "sessions" },
      { _id: "sessions", sessions: Object.fromEntries(sessions), updatedAt: new Date() },
      { upsert: true }
    );
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(sessionsFile, JSON.stringify(Object.fromEntries(sessions), null, 2));
}

function createUser(name, password, id = slugify(name)) {
  const salt = randomBytes(16).toString("hex");
  return {
    id,
    name: String(name || "User").trim() || "User",
    salt,
    hash: scryptSync(password, salt, 64).toString("hex")
  };
}

function verifyPassword(password, user) {
  const actual = Buffer.from(scryptSync(password, user.salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(user.hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function findUser(auth, name) {
  const users = auth?.users || [];
  if (!name && users.length === 1) return users[0];
  const normalized = String(name || "").trim().toLowerCase();
  return users.find(user => user.id.toLowerCase() === normalized || user.name.toLowerCase() === normalized);
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

async function authenticatedUser(req) {
  const sessionId = parseCookies(req).calorie_session;
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    await saveSessions();
    return null;
  }

  const auth = await readAuth();
  const user = (auth?.users || []).find(item => item.id === (session.userId || "owner"));
  if (!user) return null;

  session.expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14;
  await saveSessions();
  return publicUser(user);
}

async function isAuthenticated(req) {
  return Boolean(await authenticatedUser(req));
}

async function createSession(res, user) {
  const sessionId = randomBytes(32).toString("hex");
  sessions.set(sessionId, {
    userId: user.id,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14
  });
  await saveSessions();
  res.setHeader("Set-Cookie", `calorie_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600`);
}

async function clearSession(req, res) {
  const sessionId = parseCookies(req).calorie_session;
  if (sessionId) sessions.delete(sessionId);
  await saveSessions();
  res.setHeader("Set-Cookie", "calorie_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}

async function readStore(userId = "owner") {
  await ensureStore();
  let store;
  if (useMongo) {
    const collection = await getMongoCollection();
    await collection.updateOne(
      { _id: userStoreDocumentId(userId) },
      { $setOnInsert: { ...defaultStore(), createdAt: new Date() } },
      { upsert: true }
    );
    const { _id, createdAt, updatedAt, ...document } = await collection.findOne({ _id: userStoreDocumentId(userId) });
    store = document;
  } else {
    const storeFile = userStoreFile(userId);
    await mkdir(dataDir, { recursive: true });
    if (!existsSync(storeFile)) {
      await writeFile(storeFile, JSON.stringify(defaultStore(), null, 2));
    }
    store = JSON.parse(await readFile(storeFile, "utf8"));
  }
  const normalized = normalizeStore(store);
  if (normalized.changed) await writeStore(userId, normalized.store);
  return normalized.store;
}

async function writeStore(userId = "owner", store) {
  await ensureStore();
  const normalizedStore = normalizeStore(store).store;

  if (useMongo) {
    const collection = await getMongoCollection();
    await collection.replaceOne(
      { _id: userStoreDocumentId(userId) },
      { _id: userStoreDocumentId(userId), ...normalizedStore, updatedAt: new Date() },
      { upsert: true }
    );
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(userStoreFile(userId), JSON.stringify(normalizedStore, null, 2));
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
    const user = await authenticatedUser(req);
    return sendJson(res, 200, {
      configured: Boolean(auth?.users?.length),
      authenticated: Boolean(user),
      user,
      users: auth?.users?.map(publicUser) || []
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/setup") {
    if (await readAuth()) return sendJson(res, 409, { error: "Password is already configured." });
    const { name, password } = await readBody(req);
    if (!name || !name.trim()) {
      return sendJson(res, 400, { error: "Enter your name." });
    }
    if (!password || password.length < 8) {
      return sendJson(res, 400, { error: "Use a password with at least 8 characters." });
    }
    const user = createUser(name, password, "owner");
    await writeAuth({ users: [user] });
    await createSession(res, user);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const auth = await readAuth();
    if (!auth) return sendJson(res, 400, { error: "Create a password first." });
    const { name, password } = await readBody(req);
    const user = findUser(auth, name);
    if (!user || !password || !verifyPassword(password, user)) {
      return sendJson(res, 401, { error: "Wrong user or password." });
    }
    await createSession(res, user);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    await clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  const user = await authenticatedUser(req);
  if (!user) {
    return sendJson(res, 401, { error: "Login required." });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/users") {
    const auth = await readAuth();
    const { name, password } = await readBody(req);
    if (!name || !name.trim()) return sendJson(res, 400, { error: "Enter a name." });
    if (!password || password.length < 8) {
      return sendJson(res, 400, { error: "Use a password with at least 8 characters." });
    }
    if ((auth.users || []).some(item => item.name.toLowerCase() === name.trim().toLowerCase())) {
      return sendJson(res, 409, { error: "That user already exists." });
    }

    const newUser = createUser(name, password, uniqueUserId(auth, name));
    auth.users.push(newUser);
    await writeAuth(auth);
    await readStore(newUser.id);
    return sendJson(res, 200, { ok: true, user: publicUser(newUser) });
  }

  if (req.method === "GET" && url.pathname === "/api/data") {
    return sendJson(res, 200, await readStore(user.id));
  }

  if (req.method === "PUT" && url.pathname === "/api/data") {
    const payload = await readBody(req);
    await writeStore(user.id, payload);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/backup") {
    return sendBackup(res, await readStore(user.id));
  }

  if (req.method === "POST" && url.pathname === "/api/restore") {
    const payload = await readBody(req);
    if (!payload || typeof payload !== "object" || !payload.settings || !payload.days) {
      return sendJson(res, 400, { error: "Backup file must contain settings and days." });
    }
    await writeStore(user.id, { settings: payload.settings, days: payload.days });
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const publicPaths = new Set(["/login.html", "/styles.css", "/login.js", "/favicon.svg"]);

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
  console.log(`Storage: ${useMongo ? `MongoDB database "${mongoDbName}"` : "local JSON files"}`);
});
