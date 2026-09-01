import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import process from "node:process";
import handler from "./api/gastos.js";
import balancesHandler from "./api/saldos.js";
import ocaHandler from "./api/oca.js";
import personalHandler from "./api/personal.js";

const root = process.cwd();
const port = Number(process.env.PORT || 3002);

async function loadLocalEnv() {
  try {
    const contents = await readFile(join(root, ".env.local"), "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await loadLocalEnv();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function addVercelResponseHelpers(response) {
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(pathname, response) {
  const routeFiles = {
    "/": "index.html",
    "/enzo": "enzo.html",
    "/carmen": "carmen.html"
  };
  const requested = routeFiles[pathname] || pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const contents = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(contents);
  } catch {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("No encontrado");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/gastos") {
      addVercelResponseHelpers(response);
      request.body = await readJsonBody(request);
      await handler(request, response);
      return;
    }
    if (url.pathname === "/api/saldos") {
      addVercelResponseHelpers(response);
      await balancesHandler(request, response);
      return;
    }
    if (url.pathname === "/api/oca") {
      addVercelResponseHelpers(response);
      await ocaHandler(request, response);
      return;
    }
    if (url.pathname === "/api/personal") {
      addVercelResponseHelpers(response);
      if (request.method === "POST") request.body = await readJsonBody(request);
      await personalHandler(request, response);
      return;
    }
    await serveStatic(decodeURIComponent(url.pathname), response);
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Error local" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Aplicación disponible en http://localhost:${port}`);
  if (process.env.DRY_RUN === "true") {
    console.log("Modo de prueba activo: no se escribirán datos en Google Sheets.");
  }
});
