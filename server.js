// Shorts Studio HTTP server. No framework.
// Routes are listed in route(). Media (audio, video, images) is GET/HEAD only, with Range support.
// PORT (default 5178). SHORTS_ROOT, studio.config.json and CONTROL_PATH are read by studio-lib.js.

const http = require("http");
const fs = require("fs");
const path = require("path");
const lib = require("./studio-lib");

const PORT = Number(process.env.PORT || 5178);
const INDEX_PATH = path.join(__dirname, "index.html");
const VENDOR_MARKED = path.join(__dirname, "vendor", "marked.umd.js");
const MAX_BODY = 8 * 1024 * 1024;

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buf.length,
    "Cache-Control": "no-store",
  });
  res.end(buf);
}

function sendError(res, err) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const status = err && err.status ? err.status : 500;
  if (status >= 500) console.error(err);
  const body = { error: (err && err.message) || "Server error" };
  if (err && err.extra) Object.assign(body, err.extra);
  sendJson(res, status, body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new lib.StudioError(413, "Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          reject(new lib.StudioError(400, "JSON body must be an object"));
          return;
        }
        resolve(data);
      } catch {
        reject(new lib.StudioError(400, "Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function requireQuery(url, key) {
  const value = url.searchParams.get(key);
  if (value == null || value === "") throw new lib.StudioError(400, "Missing " + key);
  return value;
}

function serveIndex(res) {
  const html = fs.readFileSync(INDEX_PATH);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": html.length,
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function serveVendorMarked(res) {
  let data;
  try {
    data = fs.readFileSync(VENDOR_MARKED);
  } catch (err) {
    if (err.code === "ENOENT") throw new lib.StudioError(404, "Not found");
    throw err;
  }
  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
  });
  res.end(data);
}

async function serveMedia(req, res, short, file) {
  const located = lib.resolveUserFile(short, file, "media");
  const abs = await lib.assertRealInside(located.abs);
  let stat;
  try {
    stat = await fs.promises.stat(abs);
  } catch (err) {
    if (err.code === "ENOENT") throw new lib.StudioError(404, "File not found");
    throw err;
  }
  if (!stat.isFile()) throw new lib.StudioError(404, "File not found");
  const size = stat.size;
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": lib.mimeFor(located.rel),
    "Cache-Control": "no-store",
    "Last-Modified": stat.mtime.toUTCString(),
  };
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, Object.assign({ "Content-Length": size }, headers));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    pipeRange(req, res, abs, 0, size - 1);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    res.writeHead(416, { "Content-Range": "bytes */" + size });
    res.end();
    return;
  }
  let start;
  let end;
  if (match[1] === "") {
    const suffix = parseInt(match[2], 10);
    if (!Number.isFinite(suffix)) {
      res.writeHead(416, { "Content-Range": "bytes */" + size });
      res.end();
      return;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === "" ? size - 1 : parseInt(match[2], 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    res.writeHead(416, { "Content-Range": "bytes */" + size });
    res.end();
    return;
  }
  end = Math.min(end, size - 1);
  res.writeHead(
    206,
    Object.assign(
      {
        "Content-Range": "bytes " + start + "-" + end + "/" + size,
        "Content-Length": end - start + 1,
      },
      headers
    )
  );
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  pipeRange(req, res, abs, start, end);
}

function pipeRange(req, res, abs, start, end) {
  if (end < start) {
    res.end();
    return;
  }
  const stream = fs.createReadStream(abs, { start, end });
  const done = () => stream.destroy();
  stream.on("error", done);
  res.on("close", done);
  stream.pipe(res);
}

async function route(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathName = url.pathname;

  if (req.method === "GET" && (pathName === "/" || pathName === "/index.html")) {
    serveIndex(res);
    return;
  }
  if (req.method === "GET" && pathName === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && pathName === "/vendor/marked.umd.js") {
    serveVendorMarked(res);
    return;
  }
  if ((req.method === "GET" || req.method === "HEAD") && pathName === "/media") {
    await serveMedia(req, res, requireQuery(url, "short"), requireQuery(url, "file"));
    return;
  }
  if (pathName === "/api/reviews") {
    if (req.method === "GET") {
      const reviewPath = url.searchParams.get("path");
      if (reviewPath == null || reviewPath === "") {
        sendJson(
          res,
          200,
          await lib.readReviews({
            lite: url.searchParams.get("lite") === "1",
            short: url.searchParams.get("short"),
            prefix: url.searchParams.get("prefix"),
          })
        );
        return;
      }
      sendJson(res, 200, await lib.getReview(reviewPath));
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (typeof body.path !== "string") throw new lib.StudioError(400, "path is required");
      if (body.clear === true) {
        sendJson(res, 200, await lib.clearReview(body.path));
        return;
      }
      sendJson(res, 200, await lib.setReview(body.path, body.verdict, body.note));
      return;
    }
    if (req.method === "DELETE") {
      sendJson(res, 200, await lib.clearReview(requireQuery(url, "path")));
      return;
    }
    throw new lib.StudioError(405, "Method not allowed");
  }
  if (pathName === "/api/file" && req.method === "PUT") {
    const body = await readBody(req);
    if (typeof body.short !== "string" || typeof body.file !== "string") {
      throw new lib.StudioError(400, "short and file are required");
    }
    const saved = await lib.saveTextFile({
      short: body.short,
      file: body.file,
      content: body.content,
      baseHash: body.baseHash,
      eol: body.eol,
    });
    sendJson(res, 200, saved);
    return;
  }
  if (req.method !== "GET") {
    throw new lib.StudioError(405, "Method not allowed");
  }
  if (pathName === "/api/shorts") {
    sendJson(res, 200, await lib.listShorts());
    return;
  }
  if (pathName === "/api/files") {
    sendJson(res, 200, await lib.listFiles(requireQuery(url, "short")));
    return;
  }
  if (pathName === "/api/file") {
    const data = await lib.readText(requireQuery(url, "short"), requireQuery(url, "file"));
    delete data.raw;
    sendJson(res, 200, data);
    return;
  }
  if (pathName === "/api/control") {
    sendJson(res, 200, await lib.readControl());
    return;
  }
  if (pathName === "/api/resolve") {
    sendJson(res, 200, await lib.resolveInputPath(requireQuery(url, "path")));
    return;
  }
  throw new lib.StudioError(404, "Not found");
}

function onRequest(req, res) {
  route(req, res).catch((err) => sendError(res, err));
}

function listen(host) {
  const server = http.createServer(onRequest);
  server.on("error", (err) => {
    if (host === "::1") return;
    if (err.code === "EADDRINUSE") {
      console.error("Port " + PORT + " is already in use.");
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });
  server.listen(PORT, host, () => {
    if (host === "127.0.0.1") {
      console.log("Shorts Studio  http://localhost:" + PORT);
      console.log("SHORTS_ROOT    " + lib.getRoot());
    }
  });
  return server;
}

if (require.main === module) {
  listen("127.0.0.1");
  listen("::1");
}

module.exports = { onRequest };
