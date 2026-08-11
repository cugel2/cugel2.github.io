import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src",
  base: "./",
  publicDir: "public",
  build: {
    outDir: "..",
    emptyOutDir: false,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/app[extname]",
      },
    },
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
  },
});
