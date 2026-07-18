import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pagesDir = "/workspace/equipdiag/raw-sources/jcb-extracted/pages";

function parseFaultCodePage(md) {
  const code = [];
  const description = [];
  const ecu = [];
  const effects = [];
  const possibleCauses = [];
  const relatedCodes = [];
  let currentSection = null;

  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.match(/^## (U\d+|P\d+)/)) {
      code.push(line.replace(/^## /, "").replace(/\s*\{#.*\}\s*$/, "").trim());
    }

    if (line === "Fault Code Description") {
      currentSection = "description";
      continue;
    }
    if (line === "Information") {
      currentSection = "information";
      continue;
    }
    if (line === "Service Procedure") {
      currentSection = "service";
      continue;
    }
    if (line === "Related Fault FTB Codes" || line === "Related Fault Codes") {
      currentSection = "related";
      continue;
    }
    if (/^#/.test(line)) {
      if (!["description", "information", "service", "related"].includes(line.replace(/#{1,6}\s*/, "").trim())) {
        currentSection = null;
      }
    }

    if (currentSection === "description" && line && !line.startsWith("|") && !line.startsWith("[") && !line.startsWith("\\") && !line.startsWith("Important")) {
      description.push(line);
    }

    if (currentSection === "information") {
      if (line.startsWith("| ECU")) {
        ecu.push(line.replace(/\| ECU \| (.*) \|/, "$1").trim());
      }
      if (line.startsWith("| Effect")) {
        const val = line.replace(/\| Effect \| (.*) \|/, "$1").trim();
        effects.push(val);
      }
      if (line.startsWith("| Possible Cause")) {
        const val = line.replace(/\| Possible Cause \| (.*) \|/, "$1").trim();
        possibleCauses.push(val);
      }
    }

    if (currentSection === "related" && line.startsWith("|")) {
      const parts = line.split("|").map(p => p.trim());
      // | Fault Code | Description |
      // | P0001-13 | Open circuit |
      if (parts.length >= 3 && /^[PU]\d+/i.test(parts[1])) {
        // e.g. P0001-13 or P0001-00
        relatedCodes.push({
          code: parts[1],
          description: parts[2]?.replace(/\\u[0-9a-f]{4}/gi, "").trim() || "",
        });
      }
    }
  }

  return {
    code: code[0] || "",
    description: description.filter(d => d.length > 2).join(" ").replace(/\s+/g, " ").trim(),
    ecu: ecu.join("; "),
    effects: effects.join("; ").replace(/•/g, "").trim(),
    possibleCauses: possibleCauses.join("; ").replace(/•/g, "").trim(),
    relatedCodes,
  };
}

// Work out which files in the pages dir are fault codes
const allFiles = await readdir(pagesDir);
const faultCodeFiles = allFiles.filter(f => /^[pu]\d+\.md$/i.test(f));
console.log(`Found ${faultCodeFiles.length} fault code pages`);

const records = [];
const rawFiles = [];

for (const file of faultCodeFiles) {
  const md = await readFile(join(pagesDir, file), "utf-8");
  const parsed = parseFaultCodePage(md);
  rawFiles.push({ file, parsed });

  const baseCode = parsed.code.replace(/\s+/g, "").toUpperCase();

  // Main code entry (no sub-code)
  records.push({
    code: baseCode,
    fmi: null,
    description: parsed.description,
    ecu: parsed.ecu,
    effects: parsed.effects,
    possibleCauses: parsed.possibleCauses,
    source: "JCB TH BSIV Help",
  });

  // Related fault FTB codes (sub-codes)
  for (const rc of parsed.relatedCodes) {
    const parts = rc.code.split("-");
    const subCode = parts[0].toUpperCase();
    const fmi = parseInt(parts[1], 10);
    records.push({
      code: subCode,
      fmi: isNaN(fmi) ? null : fmi,
      description: rc.description,
      ecu: parsed.ecu,
      effects: parsed.effects,
      possibleCauses: parsed.possibleCauses,
      source: "JCB TH BSIV Help",
    });
  }
}

// ======== Parse BHL Error Codes ========
const bhlMd = await readFile("/workspace/equipdiag/raw-sources/jcb-bhl-extracted/pages/BHL_Error_Codes 3.md", "utf-8");
const bhlLines = bhlMd.split("\n");
const bhlRecords = [];
let inBhlTable = false;

for (const line of bhlLines) {
  if (line.includes("Fault Code") && line.includes("Cluster Message") && line.includes("JCB Fault Description")) {
    inBhlTable = true;
    continue;
  }
  if (!inBhlTable) continue;
  if (!line.startsWith("|") || line.trim() === "|" || line.includes("---")) continue;

  const parts = line.split("|").map(p => p.trim());
  if (parts.length < 6) continue;

  const faultCodeRaw = parts[1];
  const clusterMsg = parts[2];
  const faultDesc = parts[3];
  const source = parts[4];
  const severity = parts[5];
  const hyperlink = parts[6]?.replace(/\\/g, "").trim() || faultCodeRaw;

  if (!faultCodeRaw || /^[Bb\s]*$/.test(faultCodeRaw)) continue;

  // Parse combined fault code like P000113 -> P0001, FMI 13
  // Or B00B729 -> B00B7, FMI 29
  const match = faultCodeRaw.match(/^([PU]\d{4})(\d{2})$/i);
  if (match) {
    const code = match[1].toUpperCase();
    const fmi = parseInt(match[2], 10);
    bhlRecords.push({
      code,
      fmi,
      description: faultDesc.replace(/•/g, "").trim(),
      clusterMessage: clusterMsg.replace(/•/g, "").trim(),
      source,
      severity,
      sourceName: "JCB BHL Error Codes",
    });
  } else {
    // B-codes and other formats
    const bMatch = faultCodeRaw.match(/^([B]\d{3})(\d{3})$/i);
    if (bMatch) {
      const code = bMatch[1].toUpperCase();
      const fmi = parseInt(bMatch[2], 10);
      bhlRecords.push({
        code,
        fmi,
        description: faultDesc.replace(/•/g, "").trim(),
        clusterMessage: clusterMsg.replace(/•/g, "").trim(),
        source,
        severity,
        sourceName: "JCB BHL Error Codes",
      });
    } else {
      // Fallback: store as-is
      bhlRecords.push({
        code: faultCodeRaw,
        fmi: null,
        description: faultDesc.replace(/•/g, "").trim(),
        clusterMessage: clusterMsg.replace(/•/g, "").trim(),
        source,
        severity,
        sourceName: "JCB BHL Error Codes",
      });
    }
  }
}

console.log(`\nBHL records extracted: ${bhlRecords.length}`);

// Dedup BHL
const bhlSeen = new Set();
const bhlUnique = [];
for (const r of bhlRecords) {
  const key = `${r.code}-${r.fmi ?? "null"}`;
  if (!bhlSeen.has(key)) {
    bhlSeen.add(key);
    bhlUnique.push(r);
  }
}
console.log(`BHL unique: ${bhlUnique.length}`);

// Write BHL output
const bhlOutput = {
  source: "JCB BHL Error Codes",
  sourceFile: "BHL_Error_Codes.chm",
  manufacturer: "JCB",
  machineFamily: "BHL (Backhoe Loader)",
  totalRecords: bhlUnique.length,
  records: bhlUnique,
};

await writeFile(
  "/workspace/equipdiag/raw-sources/jcb-bhl-parsed.json",
  JSON.stringify(bhlOutput, null, 2)
);

await writeFile(
  "/workspace/equipdiag/raw-sources/jcb-bhl-parsed.min.json",
  JSON.stringify(bhlOutput)
);

console.log("Written to raw-sources/jcb-bhl-parsed.json");

console.log(`\nTotal records extracted: ${records.length}`);

// Deduplicate
const seen = new Set();
const unique = [];
for (const r of records) {
  const key = `${r.code}-${r.fmi ?? "null"}`;
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(r);
  } else {
    // Keep the one with longer description
    const existing = unique.find(u => `${u.code}-${u.fmi ?? "null"}` === key);
    if (r.description.length > (existing?.description?.length || 0)) {
      Object.assign(existing, r);
    }
  }
}

console.log(`Unique records after dedup: ${unique.length}`);

const output = {
  source: "JCB TH BSIV Help",
  sourceFile: "TH_BSIV_Help.chm",
  manufacturer: "JCB",
  engineFamily: "BSIV (Bharat Stage IV)",
  totalRecords: unique.length,
  records: unique,
};

await writeFile(
  "/workspace/equipdiag/raw-sources/jcb-parsed.json",
  JSON.stringify(output, null, 2)
);

await writeFile(
  "/workspace/equipdiag/raw-sources/jcb-parsed.min.json",
  JSON.stringify(output)
);

console.log("Written to raw-sources/jcb-parsed.json");
