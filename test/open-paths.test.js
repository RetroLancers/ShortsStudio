// Automated checks for opening files and folders from MCP (open_review,
// notify_ready) and over HTTP (/api/resolve). Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const STUDIO = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-test-"));
const root = path.join(tmp, "root");
const env = Object.assign({}, process.env, {
  SHORTS_ROOT: root,
  CONTROL_PATH: path.join(tmp, "control.json"),
  REVIEWS_PATH: path.join(tmp, "reviews.json"),
});

function write(rel, data) {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}

write("demo/script.md", "# Script\n");
write("demo/ep01/vo/line01.wav", Buffer.alloc(64, 1));
write("demo/ep01/vo/line02.wav", Buffer.alloc(64, 2));
write("demo/ep01/vo/notes.txt", "notes\n");
write("demo/art/cover.png", Buffer.alloc(16, 3));

let server;
let port;
let client;

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get("http://127.0.0.1:" + port + url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null }));
      })
      .on("error", reject);
  });
}

function getRaw(url) {
  return new Promise((resolve, reject) => {
    http
      .get("http://127.0.0.1:" + port + url, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            type: String(res.headers["content-type"] || ""),
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      })
      .on("error", reject);
  });
}

function readControl() {
  return JSON.parse(fs.readFileSync(env.CONTROL_PATH, "utf8"));
}

async function tool(name, args) {
  const res = await client.callTool({ name, arguments: args });
  return { isError: Boolean(res.isError), text: res.content[0].text };
}

test.before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  server = spawn(process.execPath, ["server.js"], { cwd: STUDIO, env: Object.assign({}, env, { PORT: String(port) }) });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 10000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("Shorts Studio")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error("server exited " + code)));
  });
  client = new Client({ name: "studio-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(STUDIO, "mcp.js")], cwd: STUDIO, env }));
});

test.after(async () => {
  if (client) await client.close();
  if (server) server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("serves studio-ui-lib.js", async () => {
  const res = await getRaw("/studio-ui-lib.js");
  assert.strictEqual(res.status, 200);
  assert.match(res.type, /javascript/);
  assert.match(res.body, /nextUnreviewedName/);
});

test("resolve: folder returns the all-files folder view", async () => {
  for (const p of ["demo/ep01/vo", "demo/ep01/vo/", "demo\\ep01\\vo", path.join(root, "demo", "ep01", "vo")]) {
    const { status, json } = await get("/api/resolve?path=" + encodeURIComponent(p));
    assert.strictEqual(status, 200, p);
    assert.strictEqual(json.kind, "gallery", p);
    assert.strictEqual(json.short, "demo");
    assert.strictEqual(json.file, "ep01/vo");
    assert.deepStrictEqual(json.files.map((f) => [f.name, f.kind]), [
      ["ep01/vo/line01.wav", "audio"],
      ["ep01/vo/line02.wav", "audio"],
      ["ep01/vo/notes.txt", "text"],
    ]);
  }
  const short = await get("/api/resolve?path=demo");
  assert.strictEqual(short.json.kind, "gallery");
  assert.strictEqual(short.json.file, "");
});

test("resolve: files keep their kind", async () => {
  const cases = { "demo/ep01/vo/line01.wav": "audio", "demo/script.md": "text", "demo/art/cover.png": "image" };
  for (const [p, kind] of Object.entries(cases)) {
    const { status, json } = await get("/api/resolve?path=" + encodeURIComponent(p));
    assert.strictEqual(status, 200, p);
    assert.strictEqual(json.kind, kind, p);
  }
  assert.strictEqual((await get("/api/resolve?path=demo/missing.wav")).status, 404);
  assert.strictEqual((await get("/api/resolve?path=../outside")).status, 400);
});

test("media is never read as text", async () => {
  const { status } = await get("/api/file?short=demo&file=" + encodeURIComponent("ep01/vo/line01.wav"));
  assert.strictEqual(status, 400);
});

test("MCP open_review and notify_ready accept folders and files", async () => {
  const calls = [
    ["open_review", { path: "demo/ep01/vo", note: "folder" }],
    ["notify_ready", { path: "demo/ep01/vo", kind: "audio", note: "folder ready" }],
    ["notify_ready", { path: "demo/ep01/vo/", kind: "audio" }],
    ["open_review", { path: "demo/ep01/vo/line01.wav" }],
    ["notify_ready", { path: "demo/script.md", kind: "short" }],
    ["notify_ready", { path: "demo/art", kind: "image" }],
  ];
  for (const [name, args] of calls) {
    const before = fs.existsSync(env.CONTROL_PATH) ? readControl().seq : 0;
    const res = await tool(name, args);
    assert.strictEqual(res.isError, false, name + " " + JSON.stringify(args) + ": " + res.text);
    const control = readControl();
    assert.strictEqual(control.seq, before + 1);
    assert.strictEqual(control.commands[0].action, name);
    assert.strictEqual(control.commands[0].path, args.path);
    // The page resolves the same path; it must resolve to the expected kind.
    const loc = await get("/api/resolve?path=" + encodeURIComponent(args.path));
    assert.strictEqual(loc.status, 200);
    const isFolder = !/\.\w+$/.test(args.path.replace(/\/$/, ""));
    assert.strictEqual(loc.json.kind === "gallery", isFolder, args.path);
  }
});

test("MCP rejects paths that do not exist", async () => {
  const res = await tool("notify_ready", { path: "demo/nope", kind: "audio" });
  assert.strictEqual(res.isError, true);
});
