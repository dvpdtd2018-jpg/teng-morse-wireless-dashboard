import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const logoPath = path.resolve(__dirname, "../logo.jpg.webp");
const HTTP_PORT = Number(process.env.PORT || 3001);

const files = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};

async function serveStatic(res, entry) {
  try {
    const body = await readFile(path.join(publicDir, entry.file));
    res.writeHead(200, { "Content-Type": entry.type, "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Local dashboard file could not be loaded.");
  }
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, mode: "direct-esp32-stream" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/brand-logo.webp") {
    try {
      const body = await readFile(logoPath);
      res.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  const entry = files[url.pathname];
  if (req.method === "GET" && entry) return serveStatic(res, entry);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`Local Morse Signal Lab: http://localhost:${HTTP_PORT}`);
  console.log("The browser receives a persistent direct stream from the ESP32.");
});
