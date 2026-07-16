import { readFileSync, writeFileSync } from 'fs';

const rawDir = '/workspace/equipdiag/raw-sources';

// ---------- GM Flash Codes (fix) ----------
function parseGMFlash(text) {
  const codes = [];
  // Match patterns like "16   Crank Never Synced at Start" through all text
  // Codes are 2-4 digit numbers at start of entries
  const re = /(\d{2,4})\s{2,}([A-Z][A-Za-z\s\/,()-]+?)(?=\d{2,4}\s{2,}[A-Z]|DTC|LPG|Gasoline|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = parseInt(m[1]);
    let desc = m[2].trim().replace(/\s+/g, ' ');
    // Filter headers and junk
    if (num < 10 || num > 9999) continue;
    if (desc.includes('DTC') || desc.includes('Description') || desc.length < 2) continue;
    codes.push({
      type: 'GM-FLASH', code: num, desc,
      standard: 'GM', source: 'GM Diagnostic Trouble Codes Flash (1.6L / 3.0L)',
      file: 'gm-flash-codes'
    });
  }
  return codes;
}

// ---------- LT7500 Forklift Codes (fix) ----------
function parseLT7500(text) {
  const codes = [];
  // Format: "12   NONE   Signifies the end of one pass through the fault list"
  const re = /(\d{2})\s{2,}([A-Z][A-Za-z0-9]+)\s{2,}([A-Z].+?)(?=\d{2}\s{2,}[A-Z]|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = parseInt(m[1]);
    const name = m[2].trim();
    const desc = m[3].trim().replace(/\s+/g, ' ');
    if (num >= 10 && num <= 99 && name.length > 1 && desc.length > 3) {
      codes.push({
        type: 'LT7500', code: num, name, desc,
        standard: 'Daewoo', source: 'Daewoo LT7500-E4 Tier II Fuel System Fault Codes',
        file: 'lt7500-forklift-codes'
      });
    }
  }
  return codes;
}

// ---------- Skypower Diagnostics ----------
function parseSkypower(text) {
  // This is more of a procedure note than codes
  return [];
}

// ---------- Main ----------
const existing = JSON.parse(readFileSync('/workspace/equipdiag/spn-database/unified-codes.json', 'utf-8'));

const gmText = readFileSync(`${rawDir}/gm-flash-codes.txt`, 'utf-8');
const gmCodes = parseGMFlash(gmText);
console.log(`GM Flash (fixed): ${gmCodes.length} codes`);
writeFileSync(`${rawDir}/gm-flash-codes-parsed.json`, JSON.stringify(gmCodes, null, 2));

const ltText = readFileSync(`${rawDir}/lt7500-forklift-codes.txt`, 'utf-8');
const ltCodes = parseLT7500(ltText);
console.log(`LT7500 (fixed): ${ltCodes.length} codes`);
writeFileSync(`${rawDir}/lt7500-forklift-codes-parsed.json`, JSON.stringify(ltCodes, null, 2));

// Merge remaining
let added = 0;
for (const nc of [...gmCodes, ...ltCodes]) {
  const dup = existing.find(e => e.type === nc.type && e.code === nc.code && e.desc === nc.desc && e.source === nc.source);
  if (!dup) { existing.push(nc); added++; }
}
console.log(`Added more codes: ${added}`);
console.log(`Total unified codes: ${existing.length}`);

// Update sources
const sources = JSON.parse(readFileSync('/workspace/equipdiag/spn-database/sources.json', 'utf-8'));
if (!sources['gm-flash-codes']) sources['gm-flash-codes'] = { name: 'GM Diagnostic Trouble Codes Flash (1.6L / 3.0L)', type: 'GM', count: gmCodes.length };

const sourceCounts = {};
for (const c of existing) {
  if (!sourceCounts[c.file]) sourceCounts[c.file] = 0;
  sourceCounts[c.file]++;
}
for (const [file, count] of Object.entries(sourceCounts)) {
  if (sources[file]) sources[file].count = count;
}

writeFileSync('/workspace/equipdiag/spn-database/unified-codes.json', JSON.stringify(existing, null, 2));
writeFileSync('/workspace/equipdiag/spn-database/sources.json', JSON.stringify(sources, null, 2));

const min = existing.map(c => ({ c: c.code, d: c.desc, t: c.type, s: c.standard, r: c.source, f: c.file }));
writeFileSync('/workspace/equipdiag/spn-database/unified-codes.min.json', JSON.stringify(min));

console.log('DONE');
