import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * PDF.js fetches its image decoders (JPEG 2000, JBIG2), colour profiles and
 * standard fonts at run time from URLs we pass it. Serve them from
 * node_modules in dev and copy them, under the same stable names, into
 * `pdfjs/` in the build. CMaps (only needed for CJK text) are left out.
 */
const PDFJS_DIR = resolve(__dirname, "node_modules/pdfjs-dist");
const PDFJS_RUNTIME_DIRS = ["wasm", "iccs", "standard_fonts"];
// QuickJS runs PDF form scripts, which Copy mode never needs.
const PDFJS_SKIP = new Set(["quickjs-eval.js", "quickjs-eval.wasm", "LICENSE_QUICKJS", "LICENSE_PDFJS_QUICKJS"]);
const PDFJS_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".icc": "application/vnd.iccprofile",
  ".ttf": "font/ttf",
  ".pfb": "application/octet-stream",
};

function pdfjsRuntimeFiles(): Plugin {
  const files = (): string[] => PDFJS_RUNTIME_DIRS.flatMap((dir) =>
    readdirSync(join(PDFJS_DIR, dir))
      .filter((name) => !PDFJS_SKIP.has(name) && statSync(join(PDFJS_DIR, dir, name)).isFile())
      .map((name) => `${dir}/${name}`));
  return {
    name: "pdfjs-runtime-files",
    configureServer(server) {
      // Without the slash the dev server falls back to the main app.
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/pdf-test") return next();
        response.statusCode = 302;
        response.setHeader("Location", "/pdf-test/");
        response.end();
      });
      server.middlewares.use("/pdfjs/",(request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?")[0]).replace(/^\/+/, "");
        if (!files().includes(path)) return next();
        // Dev only: note which decoder files each device asks for (WebAssembly
        // or the slower JavaScript fallback), for the PDF test.
        try {
          mkdirSync(join(__dirname, "node_modules/.pdf-test"), { recursive: true });
          appendFileSync(join(__dirname, "node_modules/.pdf-test/requests.log"),
            `${new Date().toISOString()} ${request.socket.remoteAddress} ${path} ${request.headers["user-agent"] ?? ""}\n`);
        } catch { /* logging is best effort */ }
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", PDFJS_TYPES[extname(path)] ?? "application/octet-stream");
        response.end(readFileSync(join(PDFJS_DIR, path)));
      });
    },
    generateBundle() {
      for (const path of files()) {
        this.emitFile({ type: "asset", fileName: `pdfjs/${path}`, source: readFileSync(join(PDFJS_DIR, path)) });
      }
    },
  };
}

export default defineConfig({
  root: "src",
  base: "./",
  publicDir: "public",
  // `npm run dev:https` serves over https with a self-signed certificate, so
  // the iPad can try features Safari keeps for secure pages (the share sheet).
  plugins: [pdfjsRuntimeFiles(), ...(process.env.HTTPS_DEV ? [basicSsl()] : [])],
  build: {
    outDir: "..",
    emptyOutDir: false,
    assetsDir: "assets",
    // Safari has native modulepreload; without this the multi-page build
    // splits the polyfill into a shared chunk that app.js would import.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        app: resolve(__dirname, "src/index.html"),
        "pdf-test": resolve(__dirname, "src/pdf-test/index.html"),
      },
      output: {
        // Every file keeps its own stable, unhashed name: the build output is
        // committed and served from GitHub Pages. The main page's files stay
        // assets/app.js and assets/app.css.
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
  },
});
