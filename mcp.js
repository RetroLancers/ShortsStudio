// MCP stdio server for Shorts Studio.
// Logs go to stderr only. stdout is the MCP transport.
// Register it with the example in .mcp.example.json.

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const lib = require("./studio-lib");

const commandSchema = z
  .object({
    action: z.string().min(1),
  })
  .passthrough();

function textResult(data) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolError(err) {
  const message = err && err.message ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

async function run(fn) {
  try {
    return textResult(await fn());
  } catch (err) {
    return toolError(err);
  }
}

function register(server) {
  server.registerTool(
    "list_shorts",
    {
      title: "List shorts",
      description:
        "List short folders under SHORTS_ROOT, newest .md/.txt change first. Each entry includes text and media files.",
      annotations: { readOnlyHint: true },
    },
    async () => run(() => lib.listShorts())
  );

  server.registerTool(
    "list_files",
    {
      title: "List files in a short",
      description:
        "List .md/.txt files and .wav/.mp3/.mp4/.png/.jpg/.jpeg/.webp files inside one short. Paths are relative to the short folder. .studio_backups is hidden.",
      inputSchema: {
        short: z.string().describe("Short folder name"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ short }) => run(() => lib.listFiles(short))
  );

  server.registerTool(
    "read_file",
    {
      title: "Read a text file",
      description: "Read a .md or .txt file. Returns content, mtime, and sha256 hash of the file bytes. Media cannot be read with this tool.",
      inputSchema: {
        short: z.string().describe("Short folder name"),
        file: z.string().describe("Relative path inside the short, for example script_v1.md"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ short, file }) =>
      run(async () => {
        const data = await lib.readText(short, file);
        data.content = data.raw;
        delete data.raw;
        return data;
      })
  );

  server.registerTool(
    "write_file",
    {
      title: "Write a text file",
      description:
        "Write a .md or .txt file. If the file already exists, copy it to <short>/.studio_backups/<filename>.<YYYYMMDD-HHMMSS>.bak first. Does not touch media files.",
      inputSchema: {
        short: z.string().describe("Short folder name"),
        file: z.string().describe("Relative .md or .txt path inside the short"),
        content: z.string().describe("Full new file contents"),
      },
    },
    async ({ short, file, content }) => run(() => lib.writeTextFile(short, file, content))
  );

  server.registerTool(
    "replace_lines",
    {
      title: "Replace lines",
      description:
        "Replace a 1-based inclusive line range in a .md or .txt file, then save. Backs up the current file first and keeps its newline style. newText may contain newlines. An empty newText deletes the range.",
      inputSchema: {
        short: z.string(),
        file: z.string(),
        startLine: z.number().int().describe("First line to replace, 1-based"),
        endLine: z.number().int().describe("Last line to replace, inclusive"),
        newText: z.string().describe("Replacement text"),
      },
    },
    async ({ short, file, startLine, endLine, newText }) =>
      run(() => lib.replaceLines(short, file, startLine, endLine, newText))
  );

  server.registerTool(
    "control",
    {
      title: "Drive the studio viewer",
      description:
        "Bump control.json seq by 1 and replace its commands. The Shorts Studio page runs commands only when seq changes. Actions: open, close, closeAll, goto, banner, open_review, notify_ready.",
      inputSchema: {
        commands: z.array(commandSchema).describe("Commands for the open studio page"),
      },
    },
    async ({ commands }) => run(() => lib.writeCommands(commands))
  );

  server.registerTool(
    "open_review",
    {
      title: "Open a review tab",
      description:
        "Validate a file or folder inside SHORTS_ROOT, then write control.json so the studio opens it and shows a banner with the note. path is short/file, a folder such as short/art, or an absolute path inside SHORTS_ROOT. An image opens an image tab. A folder opens a gallery of the images in that folder.",
      inputSchema: {
        path: z.string().describe("short/file, short/folder, or an absolute path inside SHORTS_ROOT"),
        note: z.string().optional().describe("Banner text"),
      },
    },
    async ({ path: filePath, note }) =>
      run(async () => {
        await lib.resolveInputPath(filePath);
        return lib.writeCommands([
          { action: "open_review", path: filePath, note: note || "" },
        ]);
      })
  );

  server.registerTool(
    "notify_ready",
    {
      title: "Notify ready for review",
      description:
        "Open a file, image, or image folder in a review tab and show a prominent Ready for review banner. A folder opens a gallery. kind is audio, short, or image. Writes control.json.",
      inputSchema: {
        path: z.string().describe("short/file, short/folder, or an absolute path inside SHORTS_ROOT"),
        kind: z.enum(["audio", "short", "image"]).describe("audio, short, or image"),
        note: z.string().optional().describe("Note shown on the ready banner"),
      },
    },
    async ({ path: filePath, kind, note }) =>
      run(async () => {
        await lib.resolveInputPath(filePath);
        return lib.writeCommands([
          { action: "notify_ready", path: filePath, kind, note: note || "" },
        ]);
      })
  );
}

async function main() {
  const server = new McpServer({ name: "shorts-studio", version: "1.0.0" });
  register(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { register };
