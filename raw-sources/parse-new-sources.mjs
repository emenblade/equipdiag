import { readFileSync, writeFileSync, existsSync } from 'fs';

const rawDir = '/workspace/equipdiag/raw-sources';
const codesDir = '/workspace/equipdiag/spn-database';

function readTxt(name) {
  const p = `${rawDir}/${name}.txt`;
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf-8');
}

// ===================== EMR5 DTC Codes (cleanest format) =====================
function parseEMR5(text) {
  const codes = [];
  const seen = new Set();
  // Split into individual code entries
  // Pattern: optional prefix (FTB/F0/F1/etc) + P + 3-4 alphanumeric + SPN + FMI + German + English
  const re = /(?:FT?[0-9A-F]?)?P[0-9A-F]{3}[0-9A-F]?\s+(\d{1,6})\s+(\d{1,2})\s+(Motor|Exhaust|Maschine|Abgasnachbehandlung|Engine).+?(?=Engine - |Exhaust - |Machine - )([A-Z][^-]*?(?:Engine - |Exhaust - |Machine - )(.{10,}?))(?=(?:FT?[0-9A-F]?)?P[0-9A-F]{3}[0-9A-F]?\s+\d{1,6}\s+\d{1,2}\s|$)/g;
  
  // Simpler: just find SPN FMI pairs and capture after Engine/Exhaust/Machine
  const lines = text.split('--- PAGE BREAK ---');
  for (const page of lines) {
    // Remove headers
    const clean = page.replace(/DEUTZ DTC-Codes EMR5/g, ' ')
      .replace(/Diagnosis- and Error codes/g, ' ')
      .replace(/DTC-Code SPN FMI Fehlerbescheibung Fault description/g, ' ')
      .replace(/Date:.*?2026/g, ' ')
      .replace(/Overview of all active error codes/g, ' ')
      .replace(/regardless of engine series/g, ' ')
      .replace(/FTB/g, ' ')
      .replace(/Revision.*?(?=\n|$)/g, ' ')
      .replace(/\s+/g, ' ').trim();

    // Find all P-code entries
    const entryRe = /((?:F[0-9A-F])?\d*)?(P[0-9A-F]{3}[0-9A-F]?)\s+(\d{1,6})\s+(\d{1,2})\s+([A-Za-z].*?)(?=(?:F[0-9A-F])?\d*P[0-9A-F]{3}[0-9A-F]?\s+\d{1,6}\s+\d{1,2}\s|$)/g;
    let m;
    while ((m = entryRe.exec(clean)) !== null) {
      const dtcCode = m[2];
      const spn = parseInt(m[3]);
      const fmi = parseInt(m[4]);
      let fullDesc = m[5].trim();
      
      if (spn < 1 || spn > 999999 || fmi > 31 || fmi < 0 || fullDesc.length < 5) continue;

      // Extract English description
      let desc = '';
      const engPrefixes = ['Engine - ', 'Exhaust - ', 'Machine - '];
      for (const prefix of engPrefixes) {
        const idx = fullDesc.indexOf(prefix);
        if (idx !== -1) {
          desc = fullDesc.substring(idx + prefix.length).trim();
          break;
        }
      }
      if (!desc || desc.length < 3) desc = fullDesc.replace(/\s+/g, ' ').trim().substring(0, 250);
      
      // Clean up
      desc = desc.replace(/\s+/g, ' ').trim();
      if (desc.length > 255) desc = desc.substring(0, 255);

      const key = `${spn}-${fmi}-${desc.substring(0, 40)}`;
      if (!seen.has(key)) {
        seen.add(key);
        codes.push({ type: 'SPN', code: spn, fmi, dtc: dtcCode, desc, standard: 'DEUTZ', source: 'Deutz EMR5 DTC Codes (MD1 ECU - DTCList_MD1_DE_EN.pdf)', file: 'deutz-emr5-dtc-codes' });
      }
    }
  }
  return codes;
}

// ===================== EMR4 KWP Codes =====================
function parseEMR4(text) {
  const codes = [];
  const seen = new Set();
  const pages = text.split('--- PAGE BREAK ---');
  for (const page of pages) {
    const clean = page.replace(/DEUTZ KWP-Codes EMR4/g, ' ')
      .replace(/Diagnosis- and Error codes/g, ' ')
      .replace(/KWP-Code\s+SPN\s+FMI\s+Blink code\s+Fehlerbescheibung\s+Error description/g, ' ')
      .replace(/Date:.*?2026/g, ' ')
      .replace(/Overview of all active error codes/g, ' ')
      .replace(/regardless of engine series/g, ' ')
      .replace(/\s+/g, ' ').trim();

    // Each entry: KWP-Code SPN FMI BlinkCode GermanDesc EnglishDesc
    const entryRe = /(\d{1,5})\s+(\d{1,6})\s+(\d{1,2})\s+\d{1,3}\s+([A-Za-z].*?)(?=\d{1,5}\s+\d{1,6}\s+\d{1,2}\s+\d{1,3}\s|$)/g;
    let m;
    while ((m = entryRe.exec(clean)) !== null) {
      const kwpCode = parseInt(m[1]);
      const spn = parseInt(m[2]);
      const fmi = parseInt(m[3]);
      let fullDesc = m[4].trim();
      
      if (spn < 1 || spn > 999999 || fmi > 31 || fmi < 0 || fullDesc.length < 5) continue;

      let desc = '';
      const engPrefixes = ['Engine - ', 'Exhaust - ', 'Machine - '];
      for (const prefix of engPrefixes) {
        const idx = fullDesc.indexOf(prefix);
        if (idx !== -1) {
          desc = fullDesc.substring(idx + prefix.length).trim();
          break;
        }
      }
      if (!desc || desc.length < 3) desc = fullDesc.replace(/\s+/g, ' ').trim().substring(0, 250);
      
      desc = desc.replace(/\s+/g, ' ').trim();
      if (desc.length > 255) desc = desc.substring(0, 255);

      const key = `${spn}-${fmi}-${desc.substring(0, 40)}`;
      if (!seen.has(key)) {
        seen.add(key);
        codes.push({ type: 'SPN', code: spn, fmi, kwp: kwpCode, desc, standard: 'DEUTZ', source: 'Deutz EMR4 KWP Codes (KWPList_EMR4_DE_EN.pdf)', file: 'deutz-emr4-kwp-codes' });
      }
    }
  }
  return codes;
}

// ===================== GTH-1256 Fault Codes =====================
function parseGTH1256(text) {
  const codes = [];
  const seen = new Set();
  // Remove page indicators and headers
  let clean = text.replace(/--- PAGE \d+ ---/g, ' ')
    .replace(/FAULT CODES/g, ' ')
    .replace(/GTH-1256 FINAL.*?(?=\d{1,6}\s+\d{1,2}\s+|$)/g, ' ')
    .replace(/Part No\. 1279410/g, ' ')
    .replace(/January 2017/g, ' ')
    .replace(/Section 4 • Fault Codes/g, ' ')
    .replace(/\s+/g, ' ');

  // Extract all SPN FMI Description triplets
  const re = /(\d{1,6})\s+(\d{1,2})\s+([A-Z].*?)(?=\d{1,6}\s+\d{1,2}\s+[A-Z]|$)/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const spn = parseInt(m[1]);
    const fmi = parseInt(m[2]);
    let desc = m[3].trim();
    
    // Filter junk
    if (spn < 1 || spn > 700000 || fmi > 31 || desc.length < 5) continue;
    if (desc.startsWith('Sensor') || desc.startsWith('Physical') || desc.startsWith('High') || desc.startsWith('Low') || desc.startsWith('Short') || desc.startsWith('Open') || desc.startsWith('No detail') || desc.startsWith('SPN') || desc.startsWith('FMI')) continue;
    
    // Clean up garbled concatenation from PDF extraction
    desc = desc
      .replace(/sensorNo detail/g, 'sensor. No detail')
      .replace(/sensorPhysical/g, 'sensor. Physical')
      .replace(/sensorVoltage/g, 'sensor. Voltage')
      .replace(/sensorShort/g, 'sensor. Short')
      .replace(/informationen!/g, 'informationen')
      .replace(/warning threshold/g, '; warning threshold')
      .replace(/shut off threshold/g, '; shut off threshold')
      .replace(/warning threshold/g, '; warning threshold')
      .replace(/shut off threshold/g, '; shut off threshold')
      .replace(/No detail informationen/g, '')
      .replace(/^No detail/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (desc.length <= 3) continue;
    if (desc.length > 255) desc = desc.substring(0, 255);

    const key = `${spn}-${fmi}-${desc.substring(0, 40)}`;
    if (!seen.has(key)) {
      seen.add(key);
      codes.push({ type: 'SPN', code: spn, fmi, desc, standard: 'DEUTZ', source: 'Genie GTH-1256 Deutz TCD 3.6 L4 Fault Codes (Service Manual 1279410)', file: 'genie-gth1256-fault-codes' });
    }
  }
  return codes;
}

// ===================== 1500AJP Engine Codes =====================
function parse1500AJPEngine(text) {
  const codes = [];
  const seen = new Set();
  
  // Split by SPN FMI patterns, extract first meaningful sentence
  const pages = text.replace(/--- PAGE \d+ ---/g, '|---PAGE---|').split('|---PAGE---|');
  
  for (const page of pages) {
    // Find entries - each starts with SPN FMI
    const clean = page.replace(/SECTION 3 - CHASSIS & TURNTABLE/g, ' ')
      .replace(/Table 3-10\. Engine Fault Codes/g, ' ')
      .replace(/3121735\s+\d+-\d+/g, ' ')
      .replace(/\s+/g, ' ').trim();

    const entryRe = /(\d{1,6})\s+(\d{1,2})\s+([A-Z].*?)(?=\d{1,6}\s+\d{1,2}\s+[A-Z]|$)/g;
    let m;
    while ((m = entryRe.exec(clean)) !== null) {
      const spn = parseInt(m[1]);
      const fmi = parseInt(m[2]);
      let desc = m[3].trim();
      
      if (spn < 1 || spn > 700000 || fmi > 31 || desc.length < 5) continue;
      
      // Extract first sentence or core description before troubleshooting details
      // Look for known diagnostic phase markers
      const cutoffMarkers = [
        'Threshold for error detection', 'Check ', 'Suspected Components',
        'Suspected components', 'If the signal', 'In case', 'The accelerator',
        'If this', 'There is no healing', 'Short cut', 'cable break',
        'measure Voltage', 'Check wiring', 'Check cabling', 'Check sensor',
        'Case "', 'See substitute', 'Measure Voltage', 'Switch is blocked',
        'Temperature ', 'The Sensed', 'The filtered'
      ];
      
      let coreDesc = desc;
      for (const marker of cutoffMarkers) {
        const idx = desc.indexOf(marker);
        if (idx > 10) {
          coreDesc = desc.substring(0, idx).trim();
          break;
        }
      }
      
      // Also try to split at "Possible Cause" or similar
      const actionMarkers = ['Possible Cause', 'Possible cause'];
      for (const marker of actionMarkers) {
        const idx = coreDesc.indexOf(marker);
        if (idx > 10) {
          coreDesc = coreDesc.substring(0, idx).trim();
        }
      }
      
      desc = coreDesc.replace(/\s+/g, ' ').trim();
      // Remove trailing punctuation + incomplete words
      desc = desc.replace(/\.(Threshold|If|Check|the|a\s+|to\s+|for\s+).*$/, '');
      desc = desc.replace(/\.$/, '');
      if (desc.length < 5) continue;
      if (desc.length > 255) desc = desc.substring(0, 255);

      const key = `${spn}-${fmi}-${desc.substring(0, 40)}`;
      if (!seen.has(key)) {
        seen.add(key);
        codes.push({ type: 'SPN', code: spn, fmi, desc, standard: 'DEUTZ', source: 'Genie 1500AJP Deutz Engine Fault Codes (Service Manual 3121735)', file: 'genie-1500ajp-engine-codes' });
      }
    }
  }
  return codes;
}

// ===================== 1500AJP JLG Control System DTCs =====================
function parse1500AJPAJPJLG(text) {
  const codes = [];
  const seen = new Set();
  
  // Remove page indicators and headers
  let clean = text.replace(/--- PAGE \d+ ---/g, ' ')
    .replace(/SECTION 6 - JLG CONTROL SYSTEM/g, ' ')
    .replace(/Table 6-15\. Diagnostic Trouble Code Chart/g, ' ')
    .replace(/3121735\s+\d+-\d+/g, ' ')
    .replace(/DTC\s+FlashCode\s+Sequence\s+Fault Message\s+Fault Description\s+Check/g, ' ')
    .replace(/\s+/g, ' ').trim();

  // Pattern: DTC(1-5dig) FlashCode(1-2dig) Sequence(1-2dig) FaultMessage Description
  // DTC can include leading zeros (0015 -> 15). Some have DTC=0 for section headers.
  const entryRe = /(\d{1,5})\s+(\d{1,2})\s+(\d{1,2})\s+([A-Z<].*?)(?=\d{1,5}\s+\d{1,2}\s+\d{1,2}\s+[A-Z<]|$)/g;
  let m;
  while ((m = entryRe.exec(clean)) !== null) {
    const dtc = parseInt(m[1]);
    const flash = parseInt(m[2]);
    const seq = parseInt(m[3]);
    let desc = m[4].trim();
    
    if (dtc < 0 || dtc > 999999 || desc.length < 5) continue;
    
    // Keep raw combined text (fault message + description concatenated from PDF)
    let finalDesc = desc.replace(/\s+/g, ' ').trim();
    
    const key = `${dtc}-${flash}-${finalDesc.substring(0, 40)}`;
    if (!seen.has(key)) {
      seen.add(key);
      codes.push({ type: 'JLG', code: dtc, flash, seq, desc: finalDesc, standard: 'JLG', source: 'Genie 1500AJP JLG Control System Diagnostic Trouble Codes (Service Manual 3121735)', file: 'genie-1500ajp-jlg-codes' });
    }
  }
  return codes;
}

// ===================== Merge into unified-codes.json =====================
function mergeCodes(newCodes) {
  const unifiedPath = `${codesDir}/unified-codes.json`;
  const existing = JSON.parse(readFileSync(unifiedPath, 'utf-8'));
  
  console.log(`Existing unified codes: ${existing.length}`);
  console.log(`New codes from parsing: ${newCodes.length}`);

  let added = 0;
  for (const nc of newCodes) {
    const dup = existing.find(e => 
      e.type === nc.type && 
      e.code === nc.code && 
      e.fmi === nc.fmi &&
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

  writeFileSync(unifiedPath, JSON.stringify(existing, null, 2));
  
  const min = existing.map(c => ({ c: c.code, d: c.desc, t: c.type, s: c.standard, r: c.source, f: c.file }));
  writeFileSync(`${codesDir}/unified-codes.min.json`, JSON.stringify(min));
  
  // Update sources.json
  const sourcesPath = `${codesDir}/sources.json`;
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf-8'));
  
  for (const nc of newCodes) {
    if (!sources[nc.file]) {
      sources[nc.file] = {
        name: nc.source,
        type: nc.standard,
        count: 0
      };
    }
  }
  
  const sourceCounts = {};
  for (const c of existing) {
    const f = c.file || 'unknown';
    if (!sourceCounts[f]) sourceCounts[f] = 0;
    sourceCounts[f]++;
  }
  for (const [file, count] of Object.entries(sourceCounts)) {
    if (sources[file]) sources[file].count = count;
  }

  writeFileSync(sourcesPath, JSON.stringify(sources, null, 2));
  
  console.log('Updated unified-codes.json, unified-codes.min.json, sources.json');
  return existing;
}

// ===================== Main =====================
function main() {
  let allNew = [];

  // 1. EMR5
  const emr5 = parseEMR5(readTxt('deutz-emr5-dtc-codes'));
  console.log(`EMR5: ${emr5.length} codes`);
  writeFileSync(`${rawDir}/deutz-emr5-dtc-codes-parsed.json`, JSON.stringify(emr5, null, 2));
  allNew.push(...emr5);

  // 2. EMR4 KWP
  const emr4 = parseEMR4(readTxt('deutz-emr4-kwp-codes'));
  console.log(`EMR4: ${emr4.length} codes`);
  writeFileSync(`${rawDir}/deutz-emr4-kwp-codes-parsed.json`, JSON.stringify(emr4, null, 2));
  allNew.push(...emr4);

  // 3. GTH-1256
  const gth1256 = parseGTH1256(readTxt('genie-gth1256-fault-codes'));
  console.log(`GTH-1256: ${gth1256.length} codes`);
  writeFileSync(`${rawDir}/genie-gth1256-fault-codes-parsed.json`, JSON.stringify(gth1256, null, 2));
  allNew.push(...gth1256);

  // 4. 1500AJP Engine
  const ajpEngine = parse1500AJPEngine(readTxt('genie-1500ajp-engine-codes'));
  console.log(`1500AJP Engine: ${ajpEngine.length} codes`);
  writeFileSync(`${rawDir}/genie-1500ajp-engine-codes-parsed.json`, JSON.stringify(ajpEngine, null, 2));
  allNew.push(...ajpEngine);

  // 5. 1500AJP JLG
  const ajpJLG = parse1500AJPAJPJLG(readTxt('genie-1500ajp-jlg-codes'));
  console.log(`1500AJP JLG: ${ajpJLG.length} codes`);
  writeFileSync(`${rawDir}/genie-1500ajp-jlg-codes-parsed.json`, JSON.stringify(ajpJLG, null, 2));
  allNew.push(...ajpJLG);

  // Merge all
  mergeCodes(allNew);
  console.log('DONE');
}

main();
