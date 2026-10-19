// Optional browser test for review shortcuts, tab overflow, and the ready banner.
// Skipped unless playwright-core can be required and STUDIO_CHROMIUM points at
// a Chromium/Chrome executable. Unit checks for the pure helpers live in
// studio-ui-lib.test.js.
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

test("review shortcuts, tabs, and ready banner", { skip, timeout: 120000 }, async () => {
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
  const STUDIO = path.join(__dirname, "..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-qol-"));
  const root = path.join(tmp, "root");
  const put = (rel, data) => {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  };
  put("demo/ep01/vo/line01.wav", Buffer.alloc(64, 1));
  put("demo/ep01/vo/line02.wav", Buffer.alloc(64, 2));
  put("demo/ep01/vo/line03.wav", Buffer.alloc(64, 3));
  put("demo/ep01/vo/line04.wav", Buffer.alloc(64, 4));
  put("demo/ep01/alt/line01.wav", Buffer.alloc(64, 5));
  const env = Object.assign({}, process.env, {
    SHORTS_ROOT: root,
    CONTROL_PATH: path.join(tmp, "control.json"),
    REVIEWS_PATH: path.join(tmp, "reviews.json"),
  });
  const port = 40000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: STUDIO,
    env: Object.assign({}, env, { PORT: String(port) }),
  });
  let serverLog = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start\n" + serverLog)), 10000);
    server.stdout.on("data", (d) => {
      serverLog += d;
      if (serverLog.includes("Shorts Studio")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (d) => {
      serverLog += d;
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("server exited " + code + "\n" + serverLog));
    });
  });
  const client = new Client({ name: "studio-qol-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(STUDIO, "mcp.js")],
    cwd: STUDIO,
    env,
  }));
  const browser = await chromium.launch({ executablePath: exe });
  try {
    const page = await (await browser.newContext()).newPage();
    const problems = [];
    page.on("pageerror", (err) => problems.push("pageerror " + err.message));
    page.on("response", (res) => {
      if (res.status() >= 400) problems.push(res.status() + " " + res.url());
    });
    const send = async (name, args) => {
      const res = await client.callTool({ name, arguments: args });
      assert.ok(!res.isError, name + ": " + res.content[0].text);
      await page.waitForTimeout(2500);
    };
    const reviewOf = (rel) => page.evaluate(async (file) => {
      const res = await fetch("/api/reviews?path=" + encodeURIComponent(file));
      return res.json();
    }, rel);
    const waitReview = async (rel, check) => {
      const started = Date.now();
      let last = null;
      while (Date.now() - started < 8000) {
        last = await reviewOf(rel);
        if (check(last)) return last;
        await page.waitForTimeout(200);
      }
      assert.fail(rel + " " + JSON.stringify(last));
    };

    await page.goto("http://127.0.0.1:" + port + "/");
    await page.waitForSelector(".short-head");
    await page.waitForTimeout(2000);
    await send("control", {
      commands: [
        { action: "open", path: "demo/ep01/vo/line01.wav" },
        { action: "open", path: "demo/ep01/alt/line01.wav" },
        { action: "open", path: "demo/ep01/vo/line02.wav" },
      ],
    });
    await page.waitForFunction(() => document.querySelectorAll(".tab").length === 3);

    await page.click("#helpBtn");
    await page.waitForSelector("#help:not([hidden])");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#help", { state: "hidden" });

    await page.click("#tabOverflow");
    await page.waitForSelector("#tabList:not([hidden])");
    const listed = (await page.locator("#tabList button").allTextContents()).map((text) => text.trim());
    assert.strictEqual(listed.length, 3, listed.join(" | "));
    assert.ok(listed.some((text) => text.includes("line01.wav") && text.includes("vo")), listed.join(" | "));
    assert.ok(listed.some((text) => text.includes("line01.wav") && text.includes("alt")), listed.join(" | "));
    assert.ok(listed.some((text) => text.includes("line02.wav")), listed.join(" | "));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#tabList", { state: "hidden" });

    const line01 = page.locator('.tab[title="demo/ep01/vo/line01.wav"]');
    await line01.click({ button: "right" });
    await page.waitForSelector("#tabMenu:not([hidden])");
    assert.deepStrictEqual(await page.locator("#tabMenu button").allTextContents(), [
      "Close",
      "Close others",
      "Close to the right",
      "Close all",
    ]);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#tabMenu", { state: "hidden" });

    await page.locator('.tab[title="demo/ep01/vo/line02.wav"]').click({ button: "middle" });
    await page.waitForFunction(() => document.querySelectorAll(".tab").length === 2);

    await line01.click({ button: "right" });
    await page.click('#tabMenu button[data-act="others"]');
    await page.waitForFunction(() => document.querySelectorAll(".tab").length === 1);
    assert.strictEqual(await page.locator(".tab").getAttribute("title"), "demo/ep01/vo/line01.wav");

    await page.waitForSelector("#reviewBar:not([hidden])");
    await page.click(".review-label");
    await page.keyboard.press("y");
    await page.waitForFunction(() => document.getElementById("reviewYes").getAttribute("aria-pressed") === "true");
    let review = await waitReview("demo/ep01/vo/line01.wav", (data) => data.review && data.review.verdict === "yes");
    assert.strictEqual(review.review.verdict, "yes");
    await page.keyboard.press("n");
    await page.waitForFunction(() => document.getElementById("reviewNo").getAttribute("aria-pressed") === "true");
    review = await waitReview("demo/ep01/vo/line01.wav", (data) => data.review && data.review.verdict === "no");
    assert.strictEqual(review.review.verdict, "no");

    await page.click("#reviewNote");
    await page.fill("#reviewNote", Array.from({ length: 12 }, () => "long note line").join("\n"));
    const tall = await page.locator("#reviewNote").evaluate((el) => ({
      height: el.offsetHeight,
      resize: getComputedStyle(el).resize,
      overflow: getComputedStyle(el).overflowY,
    }));
    await page.fill("#reviewNote", "keep take");
    const shortHeight = await page.locator("#reviewNote").evaluate((el) => el.offsetHeight);
    assert.ok(tall.height > shortHeight, JSON.stringify(tall) + " vs " + shortHeight);
    assert.ok(tall.height <= 180, JSON.stringify(tall));
    assert.strictEqual(tall.resize, "none");
    await page.keyboard.press("Control+Enter");
    review = await waitReview(
      "demo/ep01/vo/line01.wav",
      (data) => data.review && data.review.verdict === "no" && data.review.note === "keep take"
    );
    assert.strictEqual(review.review.note, "keep take");
    assert.match(await page.locator("#reviewStatus").textContent(), /Saved/);
    assert.strictEqual(await page.locator("#reviewNext").isVisible(), true);

    await page.evaluate(async () => {
      await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "demo/ep01/vo/line03.wav", verdict: null, note: "listen again" }),
      });
    });
    await send("notify_ready", { path: "demo/ep01/vo/line03.wav", kind: "audio", note: "third take" });
    await page.waitForSelector("#ready:not([hidden])");
    assert.strictEqual(await page.locator("#readyYes").isVisible(), true);
    assert.strictEqual(await page.locator("#readyNext").isHidden(), true);
    await page.click("#readyYes");
    await page.waitForSelector("#ready", { state: "hidden" });
    review = await reviewOf("demo/ep01/vo/line03.wav");
    assert.strictEqual(review.review && review.review.verdict, "yes");
    assert.strictEqual(review.review && review.review.note, "listen again");

    await send("notify_ready", { path: "demo/ep01/vo", kind: "audio", note: "check the takes" });
    await page.waitForSelector("#galleryGrid [data-rev-file]");
    await page.waitForSelector("#ready:not([hidden])");
    assert.strictEqual(await page.locator("#readyYes").isHidden(), true);
    assert.strictEqual(await page.locator("#readyNext").isVisible(), true);
    assert.strictEqual(await page.locator("#nextUnreviewedBtn").isVisible(), true);
    await page.click("#nextUnreviewedBtn");
    await page.waitForFunction(() => {
      const row = document.querySelector("#galleryGrid .is-current");
      return row && row.getAttribute("data-rev-file") === "ep01/vo/line02.wav";
    });
    const paused = await page.evaluate(() => Array.from(document.querySelectorAll("#galleryGrid audio")).every((el) => el.paused));
    assert.strictEqual(paused, true);
    await page.keyboard.press("y");
    review = await waitReview("demo/ep01/vo/line02.wav", (data) => data.review && data.review.verdict === "yes");
    assert.strictEqual(review.review.verdict, "yes");
    assert.strictEqual(await page.locator("#ready").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#ready", { state: "hidden" });

    await send("notify_ready", { path: "demo/ep01/vo/line04.wav", kind: "audio", note: "last take" });
    await page.waitForSelector("#ready:not([hidden])");
    await page.evaluate(async () => {
      await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "demo/ep01/vo/line04.wav", verdict: "yes", note: "" }),
      });
    });
    await page.waitForSelector("#ready", { state: "hidden", timeout: 8000 });
    review = await reviewOf("demo/ep01/vo/line04.wav");
    assert.strictEqual(review.review && review.review.verdict, "yes");
    assert.deepStrictEqual(problems, []);
  } finally {
    await browser.close();
    await client.close();
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
