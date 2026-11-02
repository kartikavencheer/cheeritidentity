# The deployment guide as a web page and a PDF

`build.mjs` turns `../../PRODUCTION_DEPLOYMENT_GUIDE.md` into one self-contained page (`guide.html`) with a contents list, a **Copy** button on every command,
tick boxes that the browser remembers, and a light/dark switch. The same page prints cleanly (wrapped commands, light colours).

Rebuild after you change the guide:

```bash
cd dev-tools/guide-page
npm install marked@12.0.2
node build.mjs
```

Make the PDF (Chrome or Chromium):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --print-to-pdf="$PWD/../../PRODUCTION_DEPLOYMENT_GUIDE.pdf" "file://$PWD/guide.html"
```

Always edit the markdown file, never the generated page or PDF.
