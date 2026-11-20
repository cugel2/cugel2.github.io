import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Without the trailing slash the dev server would answer /brush-test with the main app. */
function brushTestSlash(): Plugin {
  return {
    name: "brush-test-slash",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/brush-test") return next();
        response.statusCode = 302;
        response.setHeader("Location", "/brush-test/");
        response.end();
      });
    },
  };
}

export default defineConfig({
  root: "src",
  base: "./",
  publicDir: "public",
  plugins: [brushTestSlash(), ...(process.env.HTTPS_DEV ? [basicSsl()] : [])],
  build: {
    // The build output is committed and served from GitHub Pages at /nicolaides/.
    outDir: "..",
    emptyOutDir: false,
    assetsDir: "assets",
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        app: resolve(__dirname, "src/index.html"),
        "brush-test": resolve(__dirname, "src/brush-test/index.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: { root: ".", include: ["tests/**/*.test.ts"] },
});
