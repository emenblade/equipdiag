import { readFileSync, writeFileSync, existsSync } from 'fs';

const rawDir = '/workspace/equipdiag/raw-sources';
const codesDir = '/workspace/equipdiag/spn-database';

function readTxt(name) {
  const p = `${rawDir}/${name}.txt`;
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf-8');
}

// ---------- 1. Genie GTH-844 Deutz TCD3.6 + Perkins 1104 ----------
function parseGenieDeutz(text) {
  const codes = [];
  const lines = text.split('\n');
  // Each line is a page of PDF text. Join and split by known patterns.
  const all = text.replace(/\n/g, ' ');
  // Extract SPN FMI Description patterns
  // Pattern: number(s) followed by number followed by text description
  const re = /(\d{1,5})\s+(?:\d{1,5}\s+)?(\d{1,2})\s+(.+?)(?=\d{1,5}\s+(?:\d{1,5}\s+)?\d{1,2}\s+|https|Service and Repair|April 2017|Page|$)/g;
  let m;
  while ((m = re.exec(all)) !== null) {
    const spn = parseInt(m[1]);
    const fmi = parseInt(m[2]);
    let desc = m[3].trim().replace(/\s+/g, ' ');
    // Filter junk
    if (spn > 0 && spn < 70000 && fmi >= 0 && fmi <= 31 && desc.length > 3 && !desc.startsWith('SPN') && !desc.startsWith('ASPN')) {
      // Check if it's Deutz or Perkins section
      const sectionBefore = all.substring(Math.max(0, m.index - 200), m.index);
      const standard = sectionBefore.includes('Perkins') ? 'Perkins' : 'DEUTZ';
      // Deduplicate by spn+fmi+desc
      const key = `${spn}-${fmi}`;
      if (!codes.find(c => c.code === spn && c.fmi === fmi && c.desc === desc)) {
        codes.push({ type: 'SPN', code: spn, fmi, desc, standard, source: 'Genie GTH-844 Deutz TCD3.6 / Perkins 1104 Fault Codes', file: 'genie-gth844-deutz-codes' });
      }
    }
  }
  return codes;
}

// ---------- 2. Doosan Compressor SECU Codes ----------
function parseDoosanSECU(text) {
  const codes = [];
  const re = /CODE\s+(\d+)\s+(.+?)Explanation:/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = parseInt(m[1]);
    const name = m[2].trim();
    const fullText = text.substring(m.index, m.index + 800).replace(/\s+/g, ' ');
    const effectM = fullText.match(/Effect:\s*(.+?)(?:Circuit|$)/);
    const effect = effectM ? effectM[1].trim() : '';
    codes.push({
      type: 'SECU', code: num, desc: name,
      effect, standard: 'Doosan',
      source: 'Doosan Compressor SECU Fault Codes (Book 23307366)',
      file: 'doosan-compressor-secu-codes'
    });
  }
  return codes;
}

// ---------- 3. MEC3226 Fault Codes ----------
function parseMEC(text) {
  const codes = [];
  // Pattern: two-digit number followed by description... Models... Solutions
  const re = /(\d{2})\s+(.+?)(?:\s+(All Models|Micro19|1930SE|1930SE\/Micro))/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = parseInt(m[1]);
    let desc = m[2].trim();
    // Skip section headers
    if (desc.includes('Fault Codes') || desc.includes('Option Code') || desc.includes('Parameter')) continue;
    if (num < 1 || num > 99) continue;
    if (desc.length < 3) continue;
    // Find the solution text
    const afterText = text.substring(m.index, m.index + 500).replace(/\s+/g, ' ');
    const solM = afterText.match(/Solutions:\s*(.+?)(?:\d{2}\s+|Option Code|Sect|$)/);
    const solution = solM ? solM[1].trim() : '';
    codes.push({
      type: 'MEC', code: num, desc, solution,
      standard: 'MEC', source: 'MEC SEAC Slab Series Service & Parts Manual March 2022',
      file: 'mec3226-fault-codes'
    });
  }
  return codes;
}

// ---------- 4. Isuzu 4JJ1 DTCs ----------
function parseIsuzu4JJ1(text) {
  const codes = [];
  const all = text.replace(/\n/g, ' ');
  // Pattern: P-codes with flash code number
  const re = /(P\d{4})\s+(\d{1,3})\s+(.+?)(?=P\d{4}\s+\d{1,3}\s+|$)/g;
  let m;
  while ((m = re.exec(all)) !== null) {
    const dtc = m[1];
    const flash = parseInt(m[2]);
    let desc = m[3].trim().replace(/\s+/g, ' ');
    // Clean up - get the main description before "Item to be detected"
    const cleanM = desc.match(/^(.+?)(?:\s+Item to be detected|\s+Open\/short|\s+•|$)/);
    if (cleanM) desc = cleanM[1].trim();
    if (desc.length < 2) continue;
    const codeNum = parseInt(dtc.replace('P', ''));
    codes.push({
      type: 'DTC', code: dtc, flash, desc,
      standard: 'Isuzu', source: 'Isuzu 4JJ1 Electronic Control Fuel Injection System DTC List',
      file: 'isuzu-4jj1-codes'
    });
    // Also add numeric version
    codes.push({
      type: 'FLASH', code: flash, dtc, desc,
      standard: 'Isuzu', source: 'Isuzu 4JJ1 Electronic Control Fuel Injection System DTC List',
      file: 'isuzu-4jj1-codes'
    });
  }
  return codes;
}

// ---------- 5. GM Flash Codes ----------
function parseGMFlash(text) {
  const codes = [];
  const sections = text.split(/\d\.\d+L\s+GM\s+engine\s+codes/i);
  let engineSize = '1.6L';
  for (const sec of sections) {
    const lines = sec.split('\n');
    for (const line of lines) {
      const m = line.match(/(\d{3,4})\s+(.+)/);
      if (m) {
        const num = parseInt(m[1]);
        const desc = m[2].trim();
        if (num > 0 && desc.length > 2 && !desc.includes('DTC') && !desc.includes('Code')) {
          codes.push({
            type: 'GM-FLASH', code: num, desc,
            standard: 'GM', source: `GM ${engineSize} Diagnostic Trouble Codes Flash`,
            file: 'gm-flash-codes'
          });
        }
      }
    }
    engineSize = '3.0L';
  }
  return codes;
}

// ---------- 6. LT7500 Forklift Codes ----------
function parseLT7500(text) {
  const codes = [];
  const lines = text.split('\n');
  let inTable = false;
  for (const line of lines) {
    const m = line.match(/(\d{2})\s+(\w+)\s+(.+)/);
    if (m) {
      const num = parseInt(m[1]);
      const name = m[2].trim();
      const desc = m[3].trim();
      if (num >= 12 && num <= 99 && name.length > 0) {
        codes.push({
          type: 'LT7500', code: num, name, desc,
          standard: 'Daewoo', source: 'Daewoo LT7500-E4 Tier II Fuel System Fault Codes',
          file: 'lt7500-forklift-codes'
        });
      }
    }
  }
  return codes;
}

// ---------- 7. TEMSA TS-45 (Cummins) ----------
function parseTS45(text) {
  const codes = [];
  const all = text.replace(/\n/g, ' ');
  // SPN FMI TEMSA_DTC Description ... Cummins_Code ... Cummins_Description
  const re = /(\d{1,5})\s+(\d{1,2})\s+(\d{1,3})\s+(.+?)(?=\d{1,5}\s+\d{1,2}\s+\d{1,3}\s+|$)/g;
  let m;
  while ((m = re.exec(all)) !== null) {
    const spn = parseInt(m[1]);
    const fmi = parseInt(m[2]);
    const tcode = parseInt(m[3]);
    let desc = m[4].trim().replace(/\s+/g, ' ');
    // Extract just the J1939 description (before Cummins code appears)
    const cleanM = desc.match(/^(.+?)(?:\s+\d{3,4}\s+|$)/);
    if (cleanM) desc = cleanM[1].trim();
    if (spn > 0 && spn < 70000 && fmi >= 0 && fmi <= 31 && desc.length > 5) {
      codes.push({
        type: 'SPN', code: spn, fmi, desc, tcode,
        standard: 'J1939-Cummins', source: 'TEMSA TS-45 Fault Code Manual (Cummins/Allison/WABCO)',
        file: 'ts45-fault-codes'
      });
    }
  }
  return codes;
}

// ---------- Merge into unified-codes.json ----------
function mergeCodes(newCodes) {
  const unifiedPath = `${codesDir}/unified-codes.json`;
  const existing = JSON.parse(readFileSync(unifiedPath, 'utf-8'));
  
  console.log(`Existing unified codes: ${existing.length}`);
  console.log(`New codes from parsing: ${newCodes.length}`);

  // Filter out duplicates (same type, code, desc - but keep if from different source)
  let added = 0;
  for (const nc of newCodes) {
    const dup = existing.find(e => 
      e.type === nc.type && 
      e.code === nc.code && 
      e.desc === nc.desc &&
      e.source === nc.source
    );
    if (!dup) {
      existing.push(nc);
      added++;
    }
  }
  
  console.log(`Added new codes: ${added}`);
  console.log(`Total unified codes: ${existing.length}`);

  // Update sources.json
  const sourcesPath = `${codesDir}/sources.json`;
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf-8'));
  
  for (const nc of newCodes) {
    if (!sources[nc.file]) {
      sources[nc.file] = {
        name: nc.source,
        type: nc.standard,
        count: 1
      };
    } else {
      // count will be approximate, recount at the end
    }
  }
  
  // Recount all source counts
  const sourceCounts = {};
  for (const c of existing) {
    if (!sourceCounts[c.file]) sourceCounts[c.file] = 0;
    sourceCounts[c.file]++;
  }
  for (const [file, count] of Object.entries(sourceCounts)) {
    if (sources[file]) sources[file].count = count;
  }

  writeFileSync(unifiedPath, JSON.stringify(existing, null, 2));
  writeFileSync(sourcesPath, JSON.stringify(sources, null, 2));
  
  // Build minified version
  const min = existing.map(c => ({ c: c.code, d: c.desc, t: c.type, s: c.standard, r: c.source, f: c.file }));
  writeFileSync(`${codesDir}/unified-codes.min.json`, JSON.stringify(min));
  
  console.log('Updated unified-codes.json, unified-codes.min.json, sources.json');
  return existing;
}

// ---------- Main ----------
function main() {
  let allNew = [];

  const genieText = readTxt('genie-gth844-deutz-codes');
  const genieCodes = parseGenieDeutz(genieText);
  console.log(`Genie/Deutz: ${genieCodes.length} codes`);
  // Save parsed
  writeFileSync(`${rawDir}/genie-gth844-deutz-codes-parsed.json`, JSON.stringify(genieCodes, null, 2));
  allNew.push(...genieCodes);

  const secuCodes = parseDoosanSECU(readTxt('doosan-compressor-secu-codes'));
  console.log(`Doosan SECU: ${secuCodes.length} codes`);
  writeFileSync(`${rawDir}/doosan-compressor-secu-codes-parsed.json`, JSON.stringify(secuCodes, null, 2));
  allNew.push(...secuCodes);

  const mecCodes = parseMEC(readTxt('mec3226-fault-codes'));
  console.log(`MEC: ${mecCodes.length} codes`);
  writeFileSync(`${rawDir}/mec3226-fault-codes-parsed.json`, JSON.stringify(mecCodes, null, 2));
  allNew.push(...mecCodes);

  const isuzuCodes = parseIsuzu4JJ1(readTxt('isuzu-4jj1-codes'));
  console.log(`Isuzu 4JJ1: ${isuzuCodes.length} codes`);
  writeFileSync(`${rawDir}/isuzu-4jj1-codes-parsed.json`, JSON.stringify(isuzuCodes, null, 2));
  allNew.push(...isuzuCodes);

  const gmCodes = parseGMFlash(readTxt('gm-flash-codes'));
  console.log(`GM Flash: ${gmCodes.length} codes`);
  writeFileSync(`${rawDir}/gm-flash-codes-parsed.json`, JSON.stringify(gmCodes, null, 2));
  allNew.push(...gmCodes);

  const ltCodes = parseLT7500(readTxt('lt7500-forklift-codes'));
  console.log(`LT7500: ${ltCodes.length} codes`);
  writeFileSync(`${rawDir}/lt7500-forklift-codes-parsed.json`, JSON.stringify(ltCodes, null, 2));
  allNew.push(...ltCodes);

  const tsCodes = parseTS45(readTxt('ts45-fault-codes'));
  console.log(`TS-45: ${tsCodes.length} codes`);
  writeFileSync(`${rawDir}/ts45-fault-codes-parsed.json`, JSON.stringify(tsCodes, null, 2));
  allNew.push(...tsCodes);

  mergeCodes(allNew);
  console.log('DONE');
}

main();
