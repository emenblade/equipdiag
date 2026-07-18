import { readFile, writeFile } from "node:fs/promises";

const dbPath = "/workspace/equipdiag/spn-database/unified-codes.json";
const dbMinPath = "/workspace/equipdiag/spn-database/unified-codes.min.json";
const sourcesPath = "/workspace/equipdiag/spn-database/sources.json";

const db = JSON.parse(await readFile(dbPath, "utf-8"));
const sources = JSON.parse(await readFile(sourcesPath, "utf-8"));

const jcbTh = JSON.parse(await readFile("/workspace/equipdiag/raw-sources/jcb-parsed.min.json", "utf-8"));
const jcbBhl = JSON.parse(await readFile("/workspace/equipdiag/raw-sources/jcb-bhl-parsed.min.json", "utf-8"));

// Add TH BSIV records
let thAdded = 0;
for (const r of jcbTh.records) {
  const existing = db.find(e => e.c === r.code && e.fmi === r.fmi);
  if (!existing) {
    db.push({
      c: r.code,
      fmi: r.fmi ?? undefined,
      d: r.description,
      t: "DTC",
      s: "JCB TH BSIV Help",
      r: "JCB TeleHandler BSIV Help Files",
      f: "jcb-th-bsiv-codes",
    });
    thAdded++;
  }
}

// Add BHL records
let bhlAdded = 0;
for (const r of jcbBhl.records) {
  const existing = db.find(e => e.c === r.code && e.fmi === r.fmi);
  if (!existing) {
    db.push({
      c: r.code,
      fmi: r.fmi ?? undefined,
      d: r.description,
      t: "DTC",
      s: "JCB BHL Error Codes",
      r: "JCB Backhoe Loader BHL Error Codes",
      f: "jcb-bhl-codes",
    });
    bhlAdded++;
  }
}

// Add sources
sources["jcb-th-bsiv-codes"] = {
  name: "JCB TeleHandler BSIV Help Files",
  type: "DTC",
  count: jcbTh.records.length,
};

sources["jcb-bhl-codes"] = {
  name: "JCB Backhoe Loader BHL Error Codes",
  type: "DTC",
  count: jcbBhl.records.length,
};

await writeFile(dbPath, JSON.stringify(db, null, 2));
await writeFile(dbMinPath, JSON.stringify(db));
await writeFile(sourcesPath, JSON.stringify(sources, null, 2));

console.log(`TH BSIV added: ${thAdded} (existing: ${jcbTh.records.length - thAdded})`);
console.log(`BHL added: ${bhlAdded} (existing: ${jcbBhl.records.length - bhlAdded})`);
console.log(`Total records now: ${db.length}`);
console.log(`Sources now: ${Object.keys(sources).length}`);
