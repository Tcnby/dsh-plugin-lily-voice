/** 本地自测：不装进 DSH，直接跑插件的服务端路由（验证 spawn/读数/配置）。 */
import { apply, ROUTES, name, inject } from "./lib/index.js";

const routes = new Map();
const ctx = {
  logger: { info: () => {}, warn: (e) => console.warn("[warn]", e) },
  effect: (fn) => fn(),
  webServer: {
    register: (r) => {
      routes.set(r.path, r.handler);
      return () => {};
    }
  }
};

apply(ctx);

function mockReq(method, url, bodyObj) {
  const body = bodyObj === undefined ? "" : JSON.stringify(bodyObj);
  const listeners = {};
  const req = {
    method,
    url,
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "127.0.0.1:1234" },
    on(ev, cb) {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(cb);
      return req;
    },
    destroy() {}
  };
  setTimeout(() => {
    if (body) (listeners.data || []).forEach((cb) => cb(Buffer.from(body)));
    (listeners.end || []).forEach((cb) => cb());
  }, 0);
  return req;
}

function mockRes() {
  const res = {
    code: 0,
    body: "",
    headers: {},
    writeHead(c, h) { res.code = c; res.headers = h || {}; },
    end(t) { res.body = t || ""; }
  };
  return res;
}

async function hit(method, path, body) {
  const fn = routes.get(path.split("?")[0]);
  if (!fn) throw new Error("route missing: " + path);
  const res = mockRes();
  await fn(mockReq(method, path, body), res);
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch { parsed = res.body; }
  return { code: res.code, body: parsed };
}

console.log("plugin:", name, "inject:", JSON.stringify(inject));
console.log("routes:", [...routes.keys()].join("\n        "));

console.log("\n== voices ==");
console.log(JSON.stringify((await hit("GET", ROUTES.voices)).body).slice(0, 160));

console.log("\n== status (before) ==");
let st = await hit("GET", ROUTES.status);
console.log(JSON.stringify(st.body));

console.log("\n== heard ==");
const hd = await hit("GET", ROUTES.heard + "?n=5");
console.log("total:", hd.body.total, "rows:", hd.body.rows.length);
if (hd.body.rows.length) console.log("last:", JSON.stringify(hd.body.rows[hd.body.rows.length - 1]));

console.log("\n== start ==");
console.log(JSON.stringify(await hit("POST", ROUTES.start)));

await new Promise((r) => setTimeout(r, 4000));

st = await hit("GET", ROUTES.status);
console.log("status after start:", JSON.stringify(st.body));

console.log("\n== say ==");
console.log(JSON.stringify(await hit("POST", ROUTES.say, { text: "插件自测，能听见我说话吗？" })));
await new Promise((r) => setTimeout(r, 5000));

console.log("\n== heard after say ==");
const hd2 = await hit("GET", ROUTES.heard + "?n=3");
console.log("total:", hd2.body.total);
for (const row of hd2.body.rows) console.log(" ", JSON.stringify(row));

console.log("\n== stop ==");
console.log(JSON.stringify(await hit("POST", ROUTES.stop)));
await new Promise((r) => setTimeout(r, 800));
st = await hit("GET", ROUTES.status);
console.log("status after stop:", JSON.stringify(st.body));

console.log("\n== config write ==");
console.log(JSON.stringify(await hit("POST", ROUTES.config, { engine: "edge", voice: "zh-CN-XiaoyiNeural" })));

console.log("\nALL OK");
process.exit(0);
