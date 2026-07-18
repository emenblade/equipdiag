import { convertChm } from "@chm-md/core";
import { mkdir } from "node:fs/promises";

const chmPath = process.argv[2];
const outDir = process.argv[3] || "/tmp/opencode/chm-output";

await mkdir(outDir, { recursive: true });

const result = await convertChm({
  sourcePath: chmPath,
  outputDir: outDir,
  force: true,
  onPhaseStart(phase) {
    console.error("Phase:", phase);
  },
  onPhaseEnd(phase, dur) {
    console.error(`  done in ${dur}ms`);
  },
});

console.log(JSON.stringify({
  sourcePath: result.sourcePath,
  outputDir: result.outputDir,
  pageCount: result.pageCount,
  entryCount: result.entryCount,
  assetCount: result.assetCount,
  tocNodeCount: result.tocNodeCount,
  indexNodeCount: result.indexNodeCount,
  errorCount: result.errorCount,
  durationMs: result.durationMs,
  cacheHit: result.cacheHit,
}, null, 2));
