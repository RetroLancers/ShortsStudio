// Optional browser test for quick open, text-file review keys, and tab gestures.
// Skipped unless playwright-core can be required and STUDIO_CHROMIUM points at
// a Chromium/Chrome executable. Query parsing and scoring live in
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

test("quick open, text review bar, and tab reorder", { skip, timeout: 120000 }, async () => {
  const STUDIO = path.join(__dirname, "..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-quick-"));
  const root = path.join(tmp, "root");
  const put = (rel, data) => {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  };
  put("demo/script.md", "# Script\n\nHello from markdown.\n");
  put("demo/readme.txt", "plain notes\n");
  put("demo/ep01/vo/line01.wav", Buffer.alloc(64, 1));
  put("demo/ep01/vo/line02.wav", Buffer.alloc(64, 2));
  const env = Object.assign({}, process.env, {
    SHORTS_ROOT: root,
    CONTROL_PATH: path.join(tmp, "control.json"),
    REVIEWS_PATH: path.join(tmp, "reviews.json"),
  });
  const port = 45000 + Math.floor(Math.random() * 15000);
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
  const browser = await chromium.launch({ executablePath: exe });
  try {
    const page = await (await browser.newContext()).newPage();
    const problems = [];
    page.on("pageerror", (err) => problems.push("pageerror " + err.message));
    page.on("response", (res) => {
      if (res.status() >= 400) problems.push(res.status() + " " + res.url());
    });
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
    const tabTitles = () => page.locator("#tabs .tab").evaluateAll((els) => els.map((el) => el.getAttribute("title")));

    await page.goto("http://127.0.0.1:" + port + "/");
    await page.waitForSelector(".short-head");
    await page.locator(".short-head .caret").click();
    await page.locator(".file", { hasText: "readme.txt" }).click();
    await page.waitForSelector('.tab[title="demo/readme.txt"]');
    await page.locator(".file", { hasText: "line02.wav" }).click();
    await page.waitForSelector('.tab[title="demo/ep01/vo/line02.wav"]');
    await page.locator(".file", { hasText: "script.md" }).click();
    await page.waitForSelector('.tab.active[title="demo/script.md"]');
    await page.waitForSelector("#reviewBar:not([hidden])");
    assert.strictEqual(await page.locator("#reviewNext").isVisible(), true);

    await page.keyboard.press("y");
    let review = await waitReview("demo/script.md", (data) => data.review && data.review.verdict === "yes");
    assert.strictEqual(review.review.verdict, "yes");
    assert.strictEqual(await page.locator("#reviewYes").getAttribute("aria-pressed"), "true");
    await page.keyboard.press("u");
    await waitReview("demo/script.md", (data) => !data.review || data.review.verdict == null);
    assert.strictEqual(await page.locator("#reviewYes").getAttribute("aria-pressed"), "false");

    await page.click('#mdModes button[data-mode="edit"]');
    await page.waitForSelector("#editorCol:not([hidden])");
    await page.click("#editor");
    await page.keyboard.type("Hello ");
    await page.keyboard.press("y");
    await page.waitForFunction(() => document.getElementById("editor").value.includes("Hello y") || document.getElementById("editor").value.includes("Helloy"));
    assert.strictEqual(await page.locator("#reviewYes").getAttribute("aria-pressed"), "false");
    review = await reviewOf("demo/script.md");
    assert.notStrictEqual(review.review && review.review.verdict, "yes");

    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => {
      const tab = document.querySelector(".tab.active");
      return tab && !tab.classList.contains("dirty");
    });
    await page.click('#mdModes button[data-mode="preview"]');
    await page.waitForSelector("#mdPreview .md-body");
    assert.strictEqual(await page.locator("#reviewBar").isVisible(), true);
    assert.strictEqual(await page.locator("#editorCol").isHidden(), true);
    assert.match(await page.locator("#mdPreview").innerText(), /Hello/);

    const beforeDrag = await tabTitles();
    assert.deepStrictEqual(beforeDrag, [
      "demo/readme.txt",
      "demo/ep01/vo/line02.wav",
      "demo/script.md",
    ]);
    await page.evaluate(() => {
      const tabs = [...document.querySelectorAll("#tabs .tab")];
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
      fire(tabs[0], "dragstart");
      fire(tabs[2], "dragover");
      fire(tabs[2], "drop");
      fire(tabs[0], "dragend");
    });
    await page.waitForFunction(() => {
      const titles = [...document.querySelectorAll("#tabs .tab")].map((el) => el.getAttribute("title"));
      return titles[0] === "demo/ep01/vo/line02.wav" && titles[2] === "demo/readme.txt";
    });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("studio.openTabs")).tabs.map((tab) => tab.file));
    assert.deepStrictEqual(stored, ["ep01/vo/line02.wav", "script.md", "readme.txt"]);

    await page.click("#tabOverflow");
    await page.waitForSelector("#tabList:not([hidden])");
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("#tabList button")];
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
      fire(buttons[0], "dragstart");
      fire(buttons[2], "dragover");
      fire(buttons[2], "drop");
      fire(buttons[0], "dragend");
    });
    await page.waitForFunction(() => {
      const titles = [...document.querySelectorAll("#tabs .tab")].map((el) => el.getAttribute("title"));
      return titles[0] === "demo/script.md" && titles[2] === "demo/ep01/vo/line02.wav";
    });

    await page.locator('.tab[title="demo/readme.txt"]').click({ modifiers: ["Control"] });
    await page.waitForFunction(() => document.querySelectorAll("#tabs .tab").length === 2);
    assert.deepStrictEqual(await tabTitles(), ["demo/script.md", "demo/ep01/vo/line02.wav"]);

    await page.keyboard.press("Control+k");
    await page.waitForSelector("#quickOpen:not([hidden])");
    await page.fill("#quickInput", "type:audio line01");
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll(".quick-row .quick-path")].map((el) => el.textContent);
      return rows.length === 1 && rows[0].includes("line01.wav") && rows[0].includes("demo/ep01/vo/");
    });
    assert.ok((await page.locator(".quick-row .quick-kind").textContent()).length > 0);
    await page.keyboard.press("Enter");
    await page.waitForSelector("#quickOpen", { state: "hidden" });
    await page.waitForSelector('.tab.active[title="demo/ep01/vo/line01.wav"]');
    await page.waitForSelector("#reviewBar:not([hidden])");
    assert.deepStrictEqual(problems, []);
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
