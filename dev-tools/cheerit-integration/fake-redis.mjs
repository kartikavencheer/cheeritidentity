// Answers every Redis command with "nothing cached" so an app that wants a cache can start. Keeps nothing.
import net from "node:net";
function parse(buf) {
  const cmds = []; let i = 0;
  while (i < buf.length) {
    if (buf[i] !== 0x2a) break; // '*'
    let e = buf.indexOf("\r\n", i); if (e < 0) break;
    const n = Number(buf.toString("utf8", i + 1, e)); let p = e + 2; const args = [];
    for (let k = 0; k < n; k++) {
      if (buf[p] !== 0x24) return { cmds, rest: buf.subarray(i) };
      const le = buf.indexOf("\r\n", p); if (le < 0) return { cmds, rest: buf.subarray(i) };
      const len = Number(buf.toString("utf8", p + 1, le)); const end = le + 2 + len;
      if (buf.length < end + 2) return { cmds, rest: buf.subarray(i) };
      args.push(buf.toString("utf8", le + 2, end)); p = end + 2;
    }
    cmds.push(args); i = p;
  }
  return { cmds, rest: buf.subarray(i) };
}
net.createServer((s) => {
  let pending = Buffer.alloc(0);
  s.on("data", (d) => {
    const { cmds, rest } = parse(Buffer.concat([pending, d])); pending = rest;
    for (const [c = ""] of cmds) {
      const name = c.toUpperCase();
      if (name === "PING") s.write("+PONG\r\n");
      else if (name === "HELLO") s.write("-ERR unknown command 'HELLO'\r\n");
      else if (["GET", "HGET"].includes(name)) s.write("$-1\r\n");
      else if (["KEYS", "HGETALL", "SMEMBERS", "LRANGE", "MGET"].includes(name)) s.write("*0\r\n");
      else if (["DEL", "INCR", "EXISTS", "TTL", "LLEN", "SADD", "HSET"].includes(name)) s.write(":0\r\n");
      else s.write("+OK\r\n");
    }
  });
  s.on("error", () => {});
}).listen(6379, () => console.log("fake redis on 6379"));
