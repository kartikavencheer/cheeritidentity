// Turns PRODUCTION_DEPLOYMENT_GUIDE.md into one self-contained HTML page (static content first; script only adds copy buttons, ticks and the contents highlight).
import { readFileSync, writeFileSync } from "node:fs";
import { marked } from "marked";

const SRC = new URL("../../PRODUCTION_DEPLOYMENT_GUIDE.md", import.meta.url).pathname;
const OUT = new URL("./guide.html", import.meta.url).pathname;
const md = readFileSync(SRC, "utf8");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = (s) => s.replace(/`/g, "").replace(/\*\*/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").trim();
const slug = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const tokens = marked.lexer(md);
const heads = tokens.filter((t) => t.type === "heading");
const title = plain(heads.find((h) => h.depth === 1).text);
const seen = new Map();
const idOf = (text) => {
  const base = slug(text) || "section";
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
};

// contents: every H1 except the page title, with its H2 steps under it
const toc = [];
let titleSkipped = false;
const idsInOrder = [];
for (const h of heads) {
  const id = idOf(h.text);
  idsInOrder.push(id);
  if (h.depth === 1 && !titleSkipped) {
    titleSkipped = true;
    continue;
  }
  if (h.depth === 1) toc.push({ id, text: plain(h.text), kids: [] });
  else if (h.depth === 2 && toc.length) toc[toc.length - 1].kids.push({ id, text: plain(h.text) });
  else if (h.depth === 2) {
    if (!toc.length) toc.push({ id, text: "Start here", kids: [] });
    toc[0].kids.push({ id, text: plain(h.text) });
  }
}

let headingCounter = 0;
let codeCounter = 0;
marked.use({
  gfm: true,
  renderer: {
    heading(text, level) {
      const id = idsInOrder[headingCounter++];
      if (level === 1 && headingCounter === 1) return ""; // the page title is drawn in the header
      return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${text}</h${level}>\n`;
    },
    code(code, lang) {
      const id = `code-${++codeCounter}`;
      const label = lang === "nginx" ? "nginx" : lang === "json" ? "json" : lang === "sql" ? "sql" : "";
      let html = esc(code).replace(/&lt;([^&\n]*?)&gt;/g, '<span class="ph">&lt;$1&gt;</span>');
      return `<div class="code"><div class="code-bar"><span class="code-lang">${label || "shell"}</span><button type="button" class="copy" data-target="${id}">Copy</button></div><pre><code id="${id}">${html}</code></pre></div>\n`;
    },
  },
});

let body = marked.parser(tokens);

// "You should see" and "If not" are often one paragraph in the markdown: make them two boxes
body = body.replace(/<p>(<strong>You should see:<\/strong>[\s\S]*?)\n<strong>(If not:)<\/strong>([\s\S]*?)<\/p>/g, '<p>$1</p>\n<p><strong>$2</strong>$3</p>');
// label paragraphs: You should see / If not / Where
body = body
  .replace(/<p><strong>(You should see:)<\/strong>/g, '<p class="note see"><strong>$1</strong>')
  .replace(/<p><strong>(If not:)<\/strong>/g, '<p class="note ifnot"><strong>$1</strong>')
  .replace(/<p><strong>(Where:)<\/strong>/g, '<p class="note where"><strong>$1</strong>');

// page-only wording: no editor tip, "page" instead of "file"
body = body.replace(/<blockquote>\s*<p>Tip:[\s\S]*?<\/blockquote>\n?/, "");
body = body.replace("Follow this file from top to bottom", "Follow this page from top to bottom").replace("Nothing secret is written in this file.", "Nothing secret is written on this page.");
// tick boxes: enabled, with ids, so the page can remember them
let boxes = 0;
body = body.replace(/<input disabled="" type="checkbox">/g, () => `<input type="checkbox" class="chk" id="chk-${++boxes}">`);
body = body.replace(/<li>(\s*<input type="checkbox" class="chk" id="chk-\d+">)/g, '<li class="task">$1');

// wrap each H1 in a section so the contents highlight can follow it
body = body.replace(/<h1 id=/g, '<h1 class="part" id=');

const tocHtml = toc
  .map(
    (p) =>
      `<li><a href="#${p.id}" data-id="${p.id}">${esc(p.text)}</a>${
        p.kids.length ? `<ul>${p.kids.map((k) => `<li><a href="#${k.id}" data-id="${k.id}">${esc(k.text)}</a></li>`).join("")}</ul>` : ""
      }</li>`
  )
  .join("\n");

const page = `<title>CheerIT Rollout Guide</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: a calm reference page. Contents rail on the left, one narrow column of steps on the right, dark code blocks that carry the commands. */
:root{
  --bg:#F4F7F9; --surface:#FFFFFF; --fg:#16212B; --muted:#586674; --line:#D9E0E6;
  --accent:#0B6E6E; --accent-ink:#FFFFFF; --accent-soft:#E2F1F0;
  --see-bg:#E8F5EE; --see-line:#2E8B57; --warn-bg:#FFF4DD; --warn-line:#C28100; --where-bg:#EEF2F6; --where-line:#7C8B99;
  --code-bg:#0F1821; --code-fg:#E3EAF1; --code-bar:#18232E; --ph:#FFB454; --code-muted:#8DA0B1;
  --font-body:"Source Sans 3",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0C1218; --surface:#131B23; --fg:#E5EBF1; --muted:#93A1AE; --line:#26313C;
  --accent:#3FC3B6; --accent-ink:#06211E; --accent-soft:#12302E;
  --see-bg:#112619; --see-line:#3DAE78; --warn-bg:#2A2110; --warn-line:#E3A63A; --where-bg:#18212A; --where-line:#6F7F8E;
  --code-bg:#0A0F14; --code-fg:#DCE4EC; --code-bar:#121B24; color-scheme:dark;}}
:root[data-theme="dark"]{
  --bg:#0C1218; --surface:#131B23; --fg:#E5EBF1; --muted:#93A1AE; --line:#26313C;
  --accent:#3FC3B6; --accent-ink:#06211E; --accent-soft:#12302E;
  --see-bg:#112619; --see-line:#3DAE78; --warn-bg:#2A2110; --warn-line:#E3A63A; --where-bg:#18212A; --where-line:#6F7F8E;
  --code-bg:#0A0F14; --code-fg:#DCE4EC; --code-bar:#121B24; color-scheme:dark;}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:20px}
body{background:var(--bg);color:var(--fg);font-family:var(--font-body);font-size:17px;line-height:1.65;
  padding-block:0;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.shell{max-width:1180px;margin:0 auto}
header.top{padding-block:36px 22px;border-bottom:1px solid var(--line);display:flex;gap:16px 32px;flex-wrap:wrap;align-items:flex-end;justify-content:space-between}
header.top h1{font-size:clamp(28px,4.6vw,42px);line-height:1.1;margin:0 0 8px;font-weight:700;letter-spacing:-.01em;text-wrap:balance}
header.top p{margin:0;color:var(--muted);max-width:62ch}
.meta{font-size:14px;color:var(--muted);display:flex;gap:8px 18px;flex-wrap:wrap;align-items:center}
.meta b{color:var(--fg);font-weight:600}
.themebtn{font:inherit;font-size:14px;border:1px solid var(--line);background:var(--surface);color:var(--fg);padding:6px 12px;border-radius:8px;cursor:pointer}
.themebtn:hover{border-color:var(--accent)}
.grid{display:grid;grid-template-columns:270px minmax(0,1fr);gap:48px;align-items:start;padding-block:28px 80px}
nav.toc{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto;font-size:15px;padding-right:6px}
nav.toc summary{font-weight:600;cursor:pointer;list-style:none;padding:8px 0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
nav.toc summary::-webkit-details-marker{display:none}
nav.toc ul{list-style:none;margin:0;padding:0}
nav.toc>details>ul>li{margin:10px 0 2px}
nav.toc>details>ul>li>a{font-weight:600;color:var(--fg)}
nav.toc ul ul{margin:4px 0 8px;padding-left:12px;border-left:2px solid var(--line)}
nav.toc ul ul li{margin:1px 0}
nav.toc a{display:block;color:var(--muted);text-decoration:none;padding:3px 8px;border-radius:6px;line-height:1.35}
nav.toc a:hover{color:var(--fg);background:var(--accent-soft)}
nav.toc a.on{color:var(--accent);background:var(--accent-soft);font-weight:600}
main{min-width:0;max-width:78ch}
main h1.part{font-size:clamp(23px,3.2vw,30px);line-height:1.2;margin:64px 0 12px;padding:14px 16px;border-left:5px solid var(--accent);background:var(--surface);border-radius:0 10px 10px 0;font-weight:700;text-wrap:balance}
main h1.part:first-child{margin-top:0}
main h2{font-size:clamp(20px,2.6vw,24px);line-height:1.25;margin:44px 0 10px;font-weight:700;text-wrap:balance}
main h3{font-size:19px;line-height:1.3;margin:30px 0 8px;font-weight:700}
.anchor{opacity:0;margin-left:-1.1em;padding-right:.35em;color:var(--muted);text-decoration:none;font-weight:400}
h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,.anchor:focus{opacity:1}
main p,main li{max-width:72ch}
main p{margin:12px 0}
main ul,main ol{padding-left:1.35em;margin:12px 0}
main li{margin:6px 0}
main li>ul,main li>ol{margin:4px 0}
main a{color:var(--accent)}
main hr{border:0;border-top:1px solid var(--line);margin:40px 0}
main blockquote{margin:16px 0;padding:12px 16px;border-left:4px solid var(--accent);background:var(--accent-soft);border-radius:0 10px 10px 0}
main blockquote p{margin:0}
main code{font-family:var(--font-mono);font-size:.86em;background:var(--accent-soft);padding:.12em .4em;border-radius:5px;overflow-wrap:anywhere}
.code{margin:14px 0 18px;border-radius:12px;overflow:hidden;background:var(--code-bg);border:1px solid var(--line)}
.code-bar{display:flex;justify-content:space-between;align-items:center;background:var(--code-bar);padding:6px 8px 6px 14px}
.code-lang{font:500 12px var(--font-mono);color:var(--code-muted);letter-spacing:.06em;text-transform:uppercase}
.copy{font:600 13px var(--font-body);color:#fff;background:#0B6E6E;border:0;border-radius:7px;padding:5px 12px;cursor:pointer;min-width:64px}
.copy:hover{background:#0E8585}
.copy.done{background:#2E8B57}
.copy:focus-visible,.themebtn:focus-visible,nav.toc a:focus-visible,.chk:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.code pre{margin:0;padding:14px 16px;overflow-x:auto;color:var(--code-fg);font:400 14px/1.6 var(--font-mono);tab-size:2}
.code pre code{background:none;padding:0;font-size:inherit;color:inherit;overflow-wrap:normal}
.ph{color:var(--ph);font-weight:500}
p.note{padding:11px 14px;border-radius:10px;border-left:4px solid var(--where-line);background:var(--where-bg);margin:14px 0}
p.note.see{border-left-color:var(--see-line);background:var(--see-bg)}
p.note.ifnot{border-left-color:var(--warn-line);background:var(--warn-bg)}
p.note strong:first-child{display:inline-block;margin-right:.35em}
ul:has(>li.task){padding-left:0}
li.task{list-style:none;position:relative;margin:8px 0;padding:10px 14px 10px 48px;background:var(--surface);border:1px solid var(--line);border-radius:10px}
li.task .chk{position:absolute;left:15px;top:14px;width:20px;height:20px;margin:0;accent-color:var(--accent)}
li.task.done{opacity:.62;text-decoration:line-through;text-decoration-color:var(--muted)}
.progress{font-size:14px;color:var(--muted)}
footer{border-top:1px solid var(--line);padding-block:20px 40px;color:var(--muted);font-size:14px}
@media (max-width:900px){
  .grid{grid-template-columns:minmax(0,1fr);gap:8px;padding-top:16px}
  nav.toc{position:static;max-height:none;border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:4px 14px}
  nav.toc summary::after{content:" (tap to open)";text-transform:none;letter-spacing:0;font-weight:400}
  nav.toc details[open] summary::after{content:""}
  .anchor{display:none}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{
  :root:root:root{--bg:#fff;--surface:#fff;--fg:#111;--muted:#444;--line:#c9d1d8;--accent:#0B6E6E;--accent-soft:#e8f2f1;--see-bg:#eaf6ef;--see-line:#2E8B57;--warn-bg:#fff5df;--warn-line:#C28100;--where-bg:#eef2f6;--code-bg:#f3f5f7;--code-fg:#111;--code-bar:#e4e9ee;--ph:#b35c00;--code-muted:#555;color-scheme:light}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{background:#fff}
  body{font-size:11pt;line-height:1.5;padding:0}
  .copy,.themebtn,nav.toc,.progress,.anchor{display:none}
  .shell{max-width:none}
  .grid{display:block;padding:0}
  main{max-width:none}
  header.top{padding-block:0 12px}
  .code pre{white-space:pre-wrap;word-break:break-word;font-size:8.8pt}
  main h1.part{break-before:page;margin-top:0}
  main h1.part:first-of-type{break-before:auto}
  h1,h2,h3{break-after:avoid}
  p.note,li.task,.code-bar{break-inside:avoid}
  footer{display:none}
}
</style>

<div class="shell">
  <header class="top">
    <div>
      <h1>${esc(title)}</h1>
      <p>Follow it from top to bottom. Each step says where to run it, what to run, what you should see, and what to do if you don't.</p>
    </div>
    <div class="meta">
      <span><b>Updated</b> 2 Nov 2026</span>
      <span class="progress" id="progress" aria-live="polite"></span>
      <button type="button" class="themebtn" id="themebtn" aria-label="Switch between light and dark">Light / dark</button>
    </div>
  </header>
  <div class="grid">
    <nav class="toc" aria-label="Contents">
      <details id="tocbox" open>
        <summary>Contents</summary>
        <ul>
${tocHtml}
        </ul>
      </details>
    </nav>
    <main id="main">
${body}
    </main>
  </div>
  <footer>This page is generated from <code>PRODUCTION_DEPLOYMENT_GUIDE.md</code> in the <code>cheeritidentity</code> repository. Orange text inside a command is a value you must replace. Never put a password or key in chat, a ticket or Git.</footer>
</div>

<script>
(function(){
  var KEY="cheerit-rollout-ticks";
  function safeGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function safeSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}

  // copy buttons
  document.querySelectorAll(".copy").forEach(function(btn){
    btn.addEventListener("click",function(){
      var code=document.getElementById(btn.getAttribute("data-target"));
      var text=code.textContent.replace(/\\n$/,"");
      function done(){btn.textContent="Copied";btn.classList.add("done");setTimeout(function(){btn.textContent="Copy";btn.classList.remove("done")},1600)}
      function fallback(){
        var r=document.createRange();r.selectNodeContents(code);var s=window.getSelection();s.removeAllRanges();s.addRange(r);
        btn.textContent="Selected: press Ctrl/Cmd+C";setTimeout(function(){btn.textContent="Copy"},2600);
      }
      try{ if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,fallback)}else{fallback()} }catch(e){fallback()}
    });
  });

  // tick boxes, remembered in this browser only
  var saved={};try{saved=JSON.parse(safeGet(KEY)||"{}")}catch(e){saved={}}
  var boxes=[].slice.call(document.querySelectorAll(".chk"));
  function refresh(){
    var n=0;boxes.forEach(function(b){var li=b.closest("li");if(b.checked){n++;li.classList.add("done")}else{li.classList.remove("done")}});
    var p=document.getElementById("progress");if(p&&boxes.length)p.textContent=n+" of "+boxes.length+" checks ticked";
  }
  boxes.forEach(function(b){
    if(saved[b.id])b.checked=true;
    b.addEventListener("change",function(){saved[b.id]=b.checked;safeSet(KEY,JSON.stringify(saved));refresh()});
  });
  refresh();

  // theme toggle (system by default)
  var root=document.documentElement;
  var t=safeGet("cheerit-rollout-theme");if(t==="dark"||t==="light")root.setAttribute("data-theme",t);
  document.getElementById("themebtn").addEventListener("click",function(){
    var cur=root.getAttribute("data-theme");
    var dark=cur?cur==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;
    var next=dark?"light":"dark";root.setAttribute("data-theme",next);safeSet("cheerit-rollout-theme",next);
  });

  // contents: collapsed on a phone, highlight follows the reader
  var tocbox=document.getElementById("tocbox");
  if(window.matchMedia("(max-width:900px)").matches)tocbox.removeAttribute("open");
  var links={};document.querySelectorAll("nav.toc a[data-id]").forEach(function(a){links[a.getAttribute("data-id")]=a});
  var heads=[].slice.call(document.querySelectorAll("main h1[id],main h2[id]"));
  if("IntersectionObserver" in window&&heads.length){
    var current=null;
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){if(e.isIntersecting){current=e.target.id}});
      if(current){Object.keys(links).forEach(function(k){links[k].classList.toggle("on",k===current)})}
    },{rootMargin:"0px 0px -70% 0px",threshold:0});
    heads.forEach(function(h){io.observe(h)});
  }
})();
</script>
`;
writeFileSync(OUT, page);
console.log("wrote", OUT, "bytes:", Buffer.byteLength(page), "| headings in contents:", toc.length, "parts,", toc.reduce((n, p) => n + p.kids.length, 0), "steps | code blocks:", codeCounter, "| tick boxes:", boxes);
