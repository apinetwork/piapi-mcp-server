import { build } from "esbuild";

await build({
  entryPoints: ["ui/media-gallery.ts"],
  outfile: "dist/ui/media-gallery.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
});
