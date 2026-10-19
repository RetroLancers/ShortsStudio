// Optional browser test: drives the page with control commands written by the
// MCP server and checks what opens. Skipped unless playwright-core can be
// required and STUDIO_CHROMIUM points at a Chromium/Chrome executable.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

let chromium = null;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  chromium = null;
}
const exe = process.env.STUDIO_CHROMIUM;
const skip = !chromium || !exe ? "set STUDIO_CHROMIUM and install playwright-core to run" : false;

test("page opens folders and files pushed over MCP", { skip, timeout: 120000 }, async () => {
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
  const STUDIO = path.join(__dirname, "..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-ui-"));
  const root = path.join(tmp, "root");
  const put = (rel, data) => {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  };
  put("demo/script.md", "# Script\n");
  put("demo/ep01/vo/line01.wav", Buffer.alloc(64, 1));
  put("demo/ep01/vo/line02.wav", Buffer.alloc(64, 2));
  put("demo/ep01/vo/line03.wav", Buffer.alloc(64, 3));
  const env = Object.assign({}, process.env, {
    SHORTS_ROOT: root,
    CONTROL_PATH: path.join(tmp, "control.json"),
    REVIEWS_PATH: path.join(tmp, "reviews.json"),
  });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, ["server.js"], { cwd: STUDIO, env: Object.assign({}, env, { PORT: String(port) }) });
  await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("Shorts Studio") && resolve()));
  const client = new Client({ name: "studio-ui-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(STUDIO, "mcp.js")], cwd: STUDIO, env }));
  const browser = await chromium.launch({ executablePath: exe });
  try {
    const page = await (await browser.newContext()).newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push("pageerror " + e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) problems.push(r.status() + " " + r.url());
    });
    await page.goto("http://127.0.0.1:" + port + "/");
    await page.waitForSelector(".short-head");
    await page.waitForTimeout(2000);
    const state = () =>
      page.evaluate(() => ({
        active: (document.querySelector(".tab.active .name") || {}).textContent || null,
        gallery: !document.getElementById("galleryPane").hidden,
        rows: document.querySelectorAll("#galleryGrid .playlist-row, #galleryGrid .folder-item, #galleryGrid .thumb").length,
      }));
    const send = async (name, args) => {
      const res = await client.callTool({ name, arguments: args });
      assert.ok(!res.isError, name + ": " + res.content[0].text);
      await page.waitForTimeout(2500);
      return state();
    };
    let s = await send("notify_ready", { path: "demo/ep01/vo", kind: "audio", note: "folder" });
    assert.ok(s.gallery && s.rows === 3, "notify_ready folder: " + JSON.stringify(s));
    s = await send("open_review", { path: "demo/ep01/vo/line02.wav" });
    assert.ok(!s.gallery && /line02/.test(s.active || ""), "open_review file: " + JSON.stringify(s));
    s = await send("control", { commands: [{ action: "open", short: "demo", file: "ep01/vo" }] });
    assert.ok(s.gallery && s.rows === 3, "open folder via short+file: " + JSON.stringify(s));
    s = await send("control", { commands: [{ action: "open", path: "demo/ep01/vo/line01.wav" }] });
    assert.ok(!s.gallery && /line01/.test(s.active || ""), "open file via path: " + JSON.stringify(s));
    s = await send("control", { commands: [{ action: "open", short: "demo" }] });
    assert.ok(s.gallery, "open short only: " + JSON.stringify(s));
    s = await send("control", { commands: [{ action: "goto", short: "demo", file: "ep01/vo/line03.wav", line: 1 }] });
    assert.ok(/line03/.test(s.active || ""), "goto on media opens media: " + JSON.stringify(s));
    s = await send("control", { commands: [{ action: "goto", short: "demo", file: "script.md", line: 1 }] });
    assert.ok(/script/.test(s.active || ""), "goto text: " + JSON.stringify(s));
    assert.deepStrictEqual(problems, []);
  } finally {
    await browser.close();
    await client.close();
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
