/**
 * dsh-plugin-lily-voice —— 宿主半边。
 *
 * 给 DSH Web GUI 提供一组 loopback-only 路由，用来：
 *   - 查看/开关「常驻监听」（spawn talk.py listen-daemon）
 *   - 读 heard.jsonl（听到的话时间线）
 *   - 让莉莉说一句（talk.py say）
 *   - 读写音色配置（voice_cfg.json）
 *
 * 浏览器半边（./client）渲染侧栏面板，轮询这些路由。
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 稳定插件名。 */
const name = "lily-voice";

/** 需要的宿主服务。 */
const inject = ["webServer"];

const TOOLS = process.env.LILY_TOOLS || "D:\\Program Files\\deepseek H Wokr\\工具";
const PY = process.env.LILY_PYTHON ||
  "D:\\DSH-Data\\dsh-home\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe";
const TALK = join(TOOLS, "senses", "talk.py");
const HEARD = join(TOOLS, "senses", "heard.jsonl");
const CFG = join(TOOLS, "senses", "voice_cfg.json");
const SESSIONS_ROOT = join(process.env.DSH_HOME || "D:\\DSH-Data\\dsh-home", "sessions");
const SESSION_FILE = "session.v4.jsonl.zstd";

const ROUTES = {
  status: "/api/dsh-lily-voice/status",
  heard: "/api/dsh-lily-voice/heard",
  start: "/api/dsh-lily-voice/start",
  stop: "/api/dsh-lily-voice/stop",
  say: "/api/dsh-lily-voice/say",
  config: "/api/dsh-lily-voice/config",
  voices: "/api/dsh-lily-voice/voices",
  active: "/api/dsh-lily-voice/active",
  state: "/api/dsh-lily-voice/state",
  inject: "/api/dsh-lily-voice/inject",
  auto: "/api/dsh-lily-voice/auto"
};

/** edge 中文音色（面板下拉用）。 */
const EDGE_VOICES = [
  { id: "zh-CN-XiaoyiNeural", label: "晓伊 · 年轻活泼" },
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 温柔" },
  { id: "zh-CN-YunxiNeural", label: "云希 · 年轻男声" },
  { id: "zh-CN-YunxiaNeural", label: "云夏 · 可爱男声" },
  { id: "zh-CN-YunjianNeural", label: "云健 · 低沉" },
  { id: "zh-CN-YunyangNeural", label: "云扬 · 播音" },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北 · 东北话" },
  { id: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮 · 陕西话" }
];

let child = null;
let childPid = 0;
let childSince = 0;

function isLoopback(req) {
  const addr = req.socket?.remoteAddress;
  if (typeof addr !== "string") return false;
  const a = addr.toLowerCase();
  if (a === "::1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  if (!v4.startsWith("127.")) return false;
  if (req.headers["x-forwarded-for"] !== undefined) return false;
  if (req.headers["cf-connecting-ip"] !== undefined) return false;
  return true;
}

function writeJson(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(text);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function guard(req, res, method) {
  if (!isLoopback(req)) {
    writeJson(res, 403, { error: "forbidden: loopback-only" });
    return false;
  }
  if (method && req.method !== method) {
    writeJson(res, 405, { error: `method not allowed: ${req.method}` });
    return false;
  }
  return true;
}

async function loadConfig() {
  try {
    // PowerShell 5.1 的 Set-Content/Out-File -Encoding UTF8 会写 BOM，JSON.parse 会炸
    const raw = (await readFile(CFG, "utf8")).replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveConfig(patch) {
  const cur = await loadConfig();
  const next = { ...cur, ...patch };
  await writeFile(CFG, JSON.stringify(next, null, 1), "utf8");
  return next;
}

async function readHeard(n) {
  try {
    const raw = await readFile(HEARD, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
    const tail = lines.slice(-Math.max(1, n));
    const rows = [];
    for (const line of tail) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* 忽略坏行 */
      }
    }
    return { total: lines.length, rows };
  } catch {
    return { total: 0, rows: [] };
  }
}

/** 语音自动接管状态（进程内）。 */
const VOICE = {
  sessionId: "",
  autoInject: false,
  spoken: [],
  log: [],
  seenLines: -1,
  timer: null
};

function pushVoiceLog(entry) {
  VOICE.log.push(entry);
  if (VOICE.log.length > 40) VOICE.log.splice(0, VOICE.log.length - 40);
}

function rememberSpoken(text) {
  const now = Date.now();
  VOICE.spoken.push({ text, at: now });
  VOICE.spoken = VOICE.spoken.filter((row) => now - row.at < 180000);
}

/** 莉莉自己刚播报过的话，别当成她说的再注入回去（防回声自激）。 */
function isOwnEcho(text) {
  const now = Date.now();
  return VOICE.spoken.some((row) => {
    if (now - row.at > 30000) return false;
    if (text.length >= 6) return text.includes(row.text) || row.text.includes(text);
    return text === row.text;
  });
}

function serviceOf(ctx, name) {
  try {
    return ctx.get(name);
  } catch {
    return void 0;
  }
}

/**
 * 把一句话作为普通 user 消息送进会话（等价于她亲手发消息）。
 * @returns 注入记录（ok 或 error）。
 */
async function injectLine(ctx, text, sessionId, why) {
  const sid = sessionId || VOICE.sessionId;
  const entry = { t: new Date().toISOString(), sid, text, why, ok: false };
  if (!sid) {
    entry.error = "no-active-session";
    pushVoiceLog(entry);
    return entry;
  }
  const now = Date.now();
  const duplicate = VOICE.log.some((row) => row.ok && row.text === text && now - Date.parse(row.t) < 15000);
  if (duplicate) {
    entry.error = "duplicate";
    pushVoiceLog(entry);
    return entry;
  }
  if (isOwnEcho(text)) {
    entry.error = "own-echo";
    pushVoiceLog(entry);
    return entry;
  }
  const controller = serviceOf(ctx, "sessionController");
  if (controller === void 0 || typeof controller.prompt !== "function") {
    entry.error = "session-controller-unavailable";
    pushVoiceLog(entry);
    return entry;
  }
  try {
    await controller.prompt({
      sessionId: sid,
      content: [{ type: "text", text }],
      mode: "followup",
      requestId: randomUUID(),
      clientTimeZone: "Asia/Shanghai"
    }, new AbortController().signal);
    entry.ok = true;
  } catch (error) {
    entry.error = String(error && error.message ? error.message : error);
  }
  pushVoiceLog(entry);
  if (entry.ok) ctx.logger?.info?.(`[lily-voice] injected into ${sid}: ${text}`);
  else ctx.logger?.warn?.(`[lily-voice] inject failed (${entry.error}): ${text}`);
  return entry;
}

/** 轮询 heard.jsonl：只处理启动之后新写入的行。 */
async function pollHeard(ctx) {
  let raw;
  try {
    raw = await readFile(HEARD, "utf8");
  } catch {
    return;
  }
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (VOICE.seenLines < 0 || lines.length < VOICE.seenLines) {
    VOICE.seenLines = lines.length;
    return;
  }
  if (lines.length === VOICE.seenLines) return;
  const fresh = lines.slice(VOICE.seenLines);
  VOICE.seenLines = lines.length;
  if (!VOICE.autoInject) return;
  for (const line of fresh) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text.length < 2) continue;
    if (/^[。，、？！.,?!\s]+$/.test(text)) continue;
    await injectLine(ctx, text, "", "heard");
  }
}

function daemonArgs() {
  return [
    TALK,
    "listen-daemon",
    "--out", HEARD,
    "--model", "base",
    "--beam", "5",
    "--silence", "1.5",
    "--min-len", "0.6",
    "--thresh", "0.004",
    "--self-window", "6",
    "--cooldown", "3"
  ];
}

function startDaemon(logger) {
  if (child !== null) return { started: false, pid: childPid, already: true };
  if (!existsSync(TALK)) return { started: false, error: `talk.py 不存在: ${TALK}` };
  const proc = spawn(PY, daemonArgs(), {
    cwd: join(TOOLS, "senses"),
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" }
  });
  child = proc;
  childPid = proc.pid || 0;
  childSince = Date.now();
  proc.stdout?.on("data", (d) => logger?.info?.(`[lily-voice] ${String(d).trim()}`));
  proc.stderr?.on("data", (d) => logger?.warn?.(`[lily-voice] ${String(d).trim()}`));
  proc.on("exit", () => {
    child = null;
    childPid = 0;
    childSince = 0;
  });
  return { started: true, pid: childPid };
}

function stopDaemon() {
  if (child === null) return { stopped: false, already: true };
  const pid = childPid;
  try {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  child = null;
  childPid = 0;
  childSince = 0;
  return { stopped: true, pid };
}

function sayOnce(text) {
  const proc = spawn(PY, [TALK, "say", text], {
    cwd: join(TOOLS, "senses"),
    windowsHide: true,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" }
  });
  proc.unref();
  return proc.pid || 0;
}

function makeRoutes(ctx) {
  const logger = ctx.logger;
  return [
    {
      kind: "exact",
      path: ROUTES.active,
      handler: async (req, res) => {
        if (!guard(req, res, "POST")) return;
        const body = await readBody(req);
        const id = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (id !== "" && id !== VOICE.sessionId) {
          VOICE.sessionId = id;
          pushVoiceLog({ t: new Date().toISOString(), why: "active", sid: id, ok: true });
          logger?.info?.(`[lily-voice] active session -> ${id}`);
        }
        writeJson(res, 200, { ok: true, sessionId: VOICE.sessionId });
      }
    },
    {
      kind: "exact",
      path: ROUTES.state,
      handler: async (req, res) => {
        if (!guard(req, res, "GET")) return;
        writeJson(res, 200, {
          ok: true,
          sessionId: VOICE.sessionId,
          autoInject: VOICE.autoInject,
          seenLines: VOICE.seenLines,
          daemonPid: childPid,
          service: typeof serviceOf(ctx, "sessionController")?.prompt === "function",
          log: VOICE.log.slice(-12)
        });
      }
    },
    {
      kind: "exact",
      path: ROUTES.inject,
      handler: async (req, res) => {
        if (!guard(req, res, "POST")) return;
        const body = await readBody(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (text === "") {
          writeJson(res, 400, { error: "text 不能为空" });
          return;
        }
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        writeJson(res, 200, await injectLine(ctx, text, sessionId, "manual"));
      }
    },
    {
      kind: "exact",
      path: ROUTES.auto,
      handler: async (req, res) => {
        if (req.method === "GET") {
          if (!guard(req, res, null)) return;
          writeJson(res, 200, { autoInject: VOICE.autoInject, sessionId: VOICE.sessionId });
          return;
        }
        if (!guard(req, res, "POST")) return;
        const body = await readBody(req);
        VOICE.autoInject = body.enabled === true;
        if (VOICE.autoInject) {
          // 打开时把基线对齐到当前行数，避免把历史台词一次性灌进去
          try {
            const raw = await readFile(HEARD, "utf8");
            VOICE.seenLines = raw.split(/\r?\n/).filter((line) => line.trim() !== "").length;
          } catch {
            VOICE.seenLines = -1;
          }
        }
        await saveConfig({ auto_inject: VOICE.autoInject });
        logger?.info?.(`[lily-voice] auto inject -> ${VOICE.autoInject}`);
        writeJson(res, 200, { ok: true, autoInject: VOICE.autoInject });
      }
    },
    {
      kind: "exact",
      path: ROUTES.status,
      handler: async (req, res) => {
        if (!guard(req, res, "GET")) return;
        const cfg = await loadConfig();
        writeJson(res, 200, {
          running: child !== null,
          pid: childPid,
          since: childSince,
          cfg,
          python: PY,
          tools: TOOLS,
          sessionId: VOICE.sessionId,
          autoInject: VOICE.autoInject
        });
      }
    },
    {
      kind: "exact",
      path: ROUTES.heard,
      handler: async (req, res) => {
        if (!guard(req, res, "GET")) return;
        const url = new URL(req.url ?? "/", "http://x");
        const n = Number(url.searchParams.get("n") || "40");
        writeJson(res, 200, await readHeard(Number.isFinite(n) ? n : 40));
      }
    },
    {
      kind: "exact",
      path: ROUTES.start,
      handler: async (req, res) => {
        if (!guard(req, res, "POST")) return;
        writeJson(res, 200, startDaemon(logger));
      }
    },
    {
      kind: "exact",
      path: ROUTES.stop,
      handler: async (req, res) => {
        if (!guard(req, res, "POST")) return;
        writeJson(res, 200, stopDaemon());
      }
    },
    {
      kind: "exact",
      path: ROUTES.say,
      handler: async (req, res) => {
        if (!guard(req, res, "POST")) return;
        const body = await readBody(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) {
          writeJson(res, 400, { error: "text 不能为空" });
          return;
        }
        writeJson(res, 200, { ok: true, pid: sayOnce(text) });
        rememberSpoken(text);
      }
    },
    {
      kind: "exact",
      path: ROUTES.voices,
      handler: async (req, res) => {
        if (!guard(req, res, "GET")) return;
        writeJson(res, 200, {
          edge: EDGE_VOICES,
          sapi: [{ id: "Huihui", label: "慧慧 · 本机离线（免费、最快）" }],
          current: await loadConfig()
        });
      }
    },
    {
      kind: "exact",
      path: ROUTES.config,
      handler: async (req, res) => {
        if (req.method === "GET") {
          if (!guard(req, res, null)) return;
          writeJson(res, 200, await loadConfig());
          return;
        }
        if (!guard(req, res, "POST")) return;
        const body = await readBody(req);
        const patch = {};
        if (body.engine === "edge" || body.engine === "sapi" || body.engine === "auto") patch.engine = body.engine;
        if (typeof body.voice === "string" && body.voice.trim()) patch.voice = body.voice.trim();
        if (typeof body.sapi_voice === "string" && body.sapi_voice.trim()) patch.sapi_voice = body.sapi_voice.trim();
        if (Number.isFinite(body.rate)) patch.rate = body.rate;
        // 语音识别纠错开关（面板发送框旁的小按钮走 talk.py 的 20129 控制口，这里留给宿主 API）
        if (typeof body.correct === "boolean") patch.correct = body.correct;
        if (typeof body.correct_llm === "boolean") patch.correct_llm = body.correct_llm;
        writeJson(res, 200, await saveConfig(patch));
      }
    }
  ];
}

/**
 * 挂载语音面板路由。
 * @param ctx - 宿主插件上下文（需要 webServer）。
 */
function applyImpl(ctx) {
  const routes = makeRoutes(ctx);
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    loadConfig().then((cfg) => {
      VOICE.autoInject = cfg.auto_inject === true;
      if (cfg.auto_start === true) startDaemon(ctx.logger);
    }).catch(() => {});
    VOICE.timer = setInterval(() => {
      pollHeard(ctx).catch((error) => ctx.logger?.warn?.(`[lily-voice] poll: ${String(error)}`));
    }, 800);
    return () => {
      for (const dispose of disposers) dispose();
      if (VOICE.timer !== null) {
        clearInterval(VOICE.timer);
        VOICE.timer = null;
      }
      stopDaemon();
    };
  }, "lily-voice: routes");
}

export { ROUTES, applyImpl as apply, inject, name };
