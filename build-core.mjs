import { build } from "esbuild";
await build({
  entryPoints: [
    "src/core/importer.ts",
    "src/core/archive.ts",
    "src/core/import-index.ts",
    "src/core/xlsx-preview.ts",
    "src/core/database-supplement.ts",
    "src/core/tabular-supplement.ts",
    "src/core/block-data.ts",
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  legalComments: "none",
  logLevel: "info",
});
