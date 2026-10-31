import http from "node:http"; import { readFileSync } from "node:fs";
let release; const done = new Promise((r) => (release = r)); let result = null;
http.createServer(async (req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end('<!doctype html><title>t</title><body><script src="/h.js"></script><img src="/wait">'); }
  if (req.url === "/h.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(readFileSync(new URL("./h.js", import.meta.url))); }
  if (req.url === "/wait") { await done; res.writeHead(200, { "content-type": "image/gif" }); return res.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64")); }
  if (req.url === "/result") { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { result = JSON.parse(b); console.log("RESULT", JSON.stringify(result)); res.end("ok"); setTimeout(() => { release(); setTimeout(() => process.exit(0), 3000); }, 300); }); return; }
  res.writeHead(404); res.end();
}).listen(4700, () => console.log("harness on 4700"));
