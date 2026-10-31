// Stands in for S3 on this machine: accepts the browser's pre-signed form POST, counts the bytes, keeps nothing, answers 204 like S3.
import http from "node:http";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-expose-headers": "ETag" };
http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let bytes = 0; req.on("data", (c) => (bytes += c.length));
  req.on("end", () => {
    const key = (req.headers["content-type"] || "").includes("multipart") ? "form-post" : "other";
    console.log(new Date().toLocaleTimeString(), req.method, req.headers.host, req.url, `${Math.round(bytes / 1024)} KB`, key);
    res.writeHead(req.method === "POST" ? 204 : 200, cors); res.end();
  });
}).listen(4500, () => console.log("fake S3 on 4500"));
