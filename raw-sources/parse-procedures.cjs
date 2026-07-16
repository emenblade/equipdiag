const { readFileSync, writeFileSync, mkdirSync } = require('fs');

const rawDir = '/workspace/equipdiag/raw-sources';
const procDir = '/workspace/equipdiag/procedures';
mkdirSync(procDir, { recursive: true });

const procedures = [];

// ===== Extract steps from a text section =====
function extractSteps(section) {
  const steps = [];
  const stepRe = /(\d+)\.?\s{2,}([A-Z][A-Za-z0-9\s\/,;'".()\-]+?)(?=(?:\s+\d+)\.?\s{2,}[A-Z]|$)/g;
  let sm;
  const seen = new Set();
  while ((sm = stepRe.exec(section)) !== null) {
    const num = parseInt(sm[1]);
    let text = sm[2].trim();
    const nlIdx = text.indexOf('\n');
    if (nlIdx > 0) text = text.substring(0, nlIdx).trim();
    if (text.length >= 10 && num <= 30 && !seen.has(num) &&
        !/^(January|February|March|April|May|June|July|August|September|October|November|December|Part No|Table of|Serial|INDEX|FIGURE|SECTION)/.test(text) &&
        !/\bPart No\b/.test(text)) {
      seen.add(num);
      steps.push({ num, text });
    }
  }
  // If that didn't work, try with fewer spaces
  if (steps.length < 2) {
    const altRe = /(\d+)\.?\s{2,}([A-Z][A-Za-z].+?)(?=\s{1,}\d+\.?\s{2,}[A-Z]|$)/g;
    const seen2 = new Set();
    while ((sm = altRe.exec(section)) !== null) {
      const num = parseInt(sm[1]);
      const text = sm[2].trim();
      if (text.length >= 15 && num <= 30 && !seen2.has(num) && !text.match(/^[A-Z][a-z]+\s{2,}/) &&
          !/^(January|February|March|April|May|June|July|August|September|October|November|December|Part No|Table of|Serial|INDEX|FIGURE|SECTION)/.test(text)) {
        seen2.add(num);
        steps.push({ num, text });
      }
    }
  }
  steps.sort((a, b) => a.num - b.num);
  return steps;
}

// ===== Genie-style "How to ..." =====
function extractGenie(text, model) {
  const pages = text.split(/\nPAGE \d+/);
  const fullText = pages.join('\n');

  const results = [];
  const howRe = /How to ([A-Z][A-Za-z0-9\s,/\-']{5,80}?)(?:\s{2,}|\.)/g;
  const howMatches = [];

  let m;
  while ((m = howRe.exec(fullText)) !== null) {
    const title = m[1].trim();
    const before = fullText.substring(Math.max(0, m.index - 80), m.index);
    if (before.includes('Refer to') || before.includes('Refer to Repair')) continue;
    if (title.length < 8) continue;
    const afterToc = fullText.substring(m.index + m[0].length, m.index + m[0].length + 40);
    if (/\.{3,}/.test(afterToc)) continue;
    howMatches.push({ index: m.index, title });
  }

  for (let i = 0; i < howMatches.length; i++) {
    const hm = howMatches[i];
    const next = i + 1 < howMatches.length ? howMatches[i + 1].index : fullText.length;
    const section = fullText.substring(hm.index, Math.min(hm.index + 5000, next));

    const steps = extractSteps(section);
    if (steps.length < 2) continue;

    // Extract warnings
    const warnings = [];
    const warnRe = /(TIP-OVER HAZARD|CRUSHING HAZARD|BODILY INJURY HAZARD|COMPONENT DAMAGE HAZARD|ELECTROCUTION|FALL HAZARD|BURN HAZARD)\.[^.]*\./g;
    let wm;
    while ((wm = warnRe.exec(section)) !== null) {
      warnings.push(wm[0].trim());
    }

    // Extract notes
    const notes = [];
    const noteRe = /Note:\s*([A-Z][^.]{10,200}\.)/g;
    let nm;
    while ((nm = noteRe.exec(section)) !== null) {
      notes.push(nm[1].trim());
    }

    results.push({ title: hm.title, equipment: model, steps, warnings, notes });
  }
  return results;
}

// ===== JLG-style section.subsection + steps =====
function extractJLG(text, model) {
  const pages = text.split(/\nPAGE \d+/);
  const fullText = pages.join('\n');

  const results = [];

  // Find sections with numbered steps: "X.Y   TITLE" followed by steps
  const sectionRe = /(\d+)\.(\d+)\s{3,}([A-Z][A-Za-z0-9\s,\/\-()#&]{5,60}?)(?=\s{2,}\d|\s{2,}[A-Z][a-z])/g;
  let m;
  const sections = [];
  while ((m = sectionRe.exec(fullText)) !== null) {
    sections.push({ index: m.index, title: m[3].trim(), major: parseInt(m[1]), minor: parseInt(m[2]) });
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const next = i + 1 < sections.length ? sections[i + 1].index : fullText.length;
    const section = fullText.substring(s.index, Math.min(s.index + 5000, next));

    const steps = extractSteps(section);
    if (steps.length < 2) continue;

    const warnings = [];
    const warnRe = /([A-Z][A-Z\s\/,;'.()\-]{20,100}?)(?=\d+\.?\s{3,}[A-Z]|$)/g;
    let wm;
    while ((wm = warnRe.exec(section)) !== null) {
      const txt = wm[1].trim();
      if (txt.length > 25 && !txt.match(/^(SECTION|FIGURE|TABLE|INDEX|PART)/) &&
          !txt.includes('Part No') && !txt.includes('Serial')) {
        warnings.push(txt);
      }
    }

    const notes = [];
    const noteRe = /NOTE:\s*([A-Z][^.]{10,200}\.)/g;
    let nm;
    while ((nm = noteRe.exec(section)) !== null) {
      notes.push(nm[1].trim());
    }

    // Also look for sub-procedures within the section (REMOVAL, INSTALLATION headings)
    // Check for REMOVAL-like sub-sections with their own steps
    const subRe = /(REMOVAL\s*(?:AND\s*(?:DISASSEMBLY|INSTALLATION))?|INSTALLATION|ASSEMBLY\s*(?:AND\s*INSTALLATION)?|DISASSEMBLY|INSPECTION|MAINTENANCE|REPLACEMENT|ADJUSTMENT|TEST|SERVICE)\s{2,}/g;
    let sm;
    const subSections = [];
    while ((sm = subRe.exec(section)) !== null) {
      const subSection = section.substring(sm.index, Math.min(sm.index + 3000, next));
      const subSteps = extractSteps(subSection);
      if (subSteps.length >= 2) {
        subSections.push({ heading: sm[1].trim(), steps: subSteps });
      }
    }

    results.push({
      title: s.title,
      equipment: model,
      steps,
      warnings,
      notes,
      subSections
    });
  }
  return results;
}

// ===== John Deere-style "Group XXXX—Title" with steps =====
function extractJohnDeere(text, model) {
  const pp = text.split(/\nPAGE \d+/);
  const fullText = pp.join('\n');
  const results = [];
  const seen = new Set();

  // Find all step blocks (sequences of 3+ consecutive numbered steps)
  const stepRe = /(\d+)\.\s{3,}([A-Z][A-Za-z0-9\s\/,;'".()\-]+?)(?=\s+\d+\.\s{3,}[A-Z]|$)/g;
  const allSteps = [];
  let m;
  while ((m = stepRe.exec(fullText)) !== null) {
    const num = parseInt(m[1]);
    const text = m[2].trim();
    if (text.length >= 10 && num <= 60) {
      allSteps.push({ index: m.index, num, text, end: m.index + m[0].length });
    }
  }

  let i = 0;
  while (i < allSteps.length) {
    if (allSteps[i].num !== 1) { i++; continue; }
    const group = [allSteps[i]];
    let j = i + 1;
    while (j < allSteps.length && allSteps[j].num === group.length + 1 &&
           (allSteps[j].index - allSteps[j-1].end) < 5000) {
      group.push(allSteps[j]);
      j++;
    }
    if (group.length >= 3) {
      const firstIdx = group[0].index;
      const before = fullText.substring(Math.max(0, firstIdx - 400), firstIdx);
      const titleMatch = before.match(/([A-Z][A-Za-z\s\/\-]{4,80}(?:Remove|Install|Disassemble|Assemble|Test|Check|Inspect|Adjust(?:ment)?|Service|Replace|Repair|Fill|Clean|Purge|Bleed|Calibrate[et]?|Lubricate[et]?|Drain|Charge|Recommendation|Procedure|Specification|Description))[\.\s]*$/m);
      const title = titleMatch ? titleMatch[1].trim() : 'JD Procedure';
      const key = title + '|' + group.length;
      if (!seen.has(key) && titleQualityJD(title)) {
        seen.add(key);
        results.push({
          title,
          equipment: model,
          steps: group.map(s => ({ num: s.num, text: s.text })),
          warnings: [], notes: [], subSections: []
        });
      }
    }
    // Skip past this group
    while (i < allSteps.length && allSteps[i].num !== 1) i++;
    const curr = allSteps[i] ? allSteps[i].num : 0;
    while (i < allSteps.length && allSteps[i].num === curr) i++;
  }
  return results;
}

// ===== Genie GTH-5519 table-based maintenance checklist =====
function extractGTH(text, model) {
  const pp = text.split(/\nPAGE \d+/);
  const fullText = pp.join('\n');
  const results = [];

  const itemRe = /([A-D])-(\d{1,2})\s{2,}([A-Z][A-Za-z0-9\s\/,;'.()\-]{8,100}?)(?=\s{2,}(?:[A-D]-\d|\d{1,3}\s|$))/g;
  let m;
  const seen = new Set();
  while ((m = itemRe.exec(fullText)) !== null) {
    const code = m[1] + '-' + m[2];
    let title = m[3].trim();
    const nlIdx = title.indexOf('\n');
    if (nlIdx > 0) title = title.substring(0, nlIdx).trim();
    title = title.replace(/\.+$/, '').trim();
    if (seen.has(code)) continue;
    seen.add(code);

    // Find the detailed section for this item (if any exists after the table)
    const detailIdx = fullText.indexOf(code, m.index + 10);
    let detailText = '';
    if (detailIdx > 0 && detailIdx < m.index + 5000) {
      const nextItem = fullText.slice(detailIdx + code.length).match(/[A-D]-\d{1,2}\s{2,}/);
      const endIdx = nextItem ? detailIdx + code.length + nextItem.index : Math.min(detailIdx + 2000, fullText.length);
      detailText = fullText.substring(detailIdx, endIdx);
    }

    const steps = [];
    const stepRe = /(\d+)\.\s{2,}([A-Z][A-Za-z0-9\s\/,;'.()\-]{8,100}?)(?=\s+\d+\.|$)/g;
    let sm;
    if (detailText) {
      while ((sm = stepRe.exec(detailText)) !== null) {
        const num = parseInt(sm[1]);
        const txt = sm[2].trim();
        if (txt.length >= 8 && num <= 30) steps.push({ num, text: txt });
      }
    }

    results.push({
      title: code + ' ' + title,
      equipment: model,
      steps: steps.length >= 1 ? steps : [{ num: 1, text: title }],
      warnings: [],
      notes: [],
      subSections: []
    });
  }
  return results;
}

// ===== Doosan DGK-style "Checking the X" / "Oil Change" with steps =====
function titleQuality(title) {
  const badPatterns = [/^[A-Z][a-z]+$/, /^\d/, /^XX/, /Violet of CN/, /Exciter Field Current/, /Measurements taken/, /^\s{0,10}$/];
  for (const p of badPatterns) if (p.test(title)) return false;
  if (title.length < 6) return false;
  return true;
}

function extractDoosan(text, model) {
  const pp = text.split(/\nPAGE \d+/);
  const fullText = pp.join('\n');
  const results = [];

  // Find procedures: title followed by step numbering (2+ spaces then step num)
  const stepBlockRe = /(\d+)\.\s{3,}([A-Z][A-Za-z0-9\s\/,;'".()\-]+?)(?=\s+\d+\.\s{3,}[A-Z]|$)/g;
  const allSteps = [];
  let m;
  while ((m = stepBlockRe.exec(fullText)) !== null) {
    const num = parseInt(m[1]);
    const txt = m[2].trim();
    if (txt.length >= 10 && num <= 50) {
      allSteps.push({ index: m.index, num, txt });
    }
  }

  const titleSkipRe = /^(Necessary|Note|Refer|All|This|A|The)/;
  let i = 0;
  while (i < allSteps.length) {
    if (allSteps[i].num !== 1) { i++; continue; }
    const group = [allSteps[i]];
    let j = i + 1;
    while (j < allSteps.length && allSteps[j].num === group.length + 1 &&
           (allSteps[j].index - allSteps[j-1].index) < 3000) {
      group.push(allSteps[j]);
      j++;
    }
    if (group.length >= 2) {
      const before = fullText.substring(Math.max(0, group[0].index - 500), group[0].index);
      let title = null;
      // Search from the end backward: look for "X Frequency" or "X Procedure"
      const freqMatch = before.match(/([A-Z][A-Za-z0-9\s\/()]{4,60})\s+Frequency(?:\s+.*?)?\s*$/m);
      if (freqMatch) title = freqMatch[1].trim();
      if (!title || title.length < 6) {
        const procMatch = before.match(/([A-Z][A-Za-z0-9\s\/()]{4,60})\s+Procedure\s*$/m);
        if (procMatch) title = procMatch[1].trim();
      }
      // Search FULL before text (not just end) for Checking/Measuring/Replacing
      if (!title || title.length < 6) {
        const ckMatch = before.match(/(Checking the [A-Za-z0-9\s\/()]{4,60})/);
        if (ckMatch) title = ckMatch[1].trim();
      }
      if (!title || title.length < 6) {
        const msMatch = before.match(/(Measuring [A-Za-z0-9\s]{4,60})/);
        if (msMatch) title = msMatch[1].trim();
      }
      if (!title || title.length < 6) {
        const rpMatch = before.match(/(Replacing the [A-Za-z0-9\s]{4,60})/);
        if (rpMatch) title = rpMatch[1].trim();
      }
      if (!title || title.length < 6) {
        const ocMatch = before.match(/(Oil Change|Oil Filter Change|Cleaning\/Changing [A-Za-z\s]+|Draining [A-Za-z\s]+|Changing [A-Za-z\s]+)/);
        if (ocMatch) title = ocMatch[1].trim();
      }
      if (!title || title.length < 6) {
        title = group[0].txt.substring(0, 60);
      }
      // Clean up trailing noise
      title = title.replace(/\s{2,}.*$/, '').replace(/\s+(All Models.*|Necessary.*)$/, '').trim();
      const nearBefore = fullText.substring(Math.max(0, group[0].index - 200), group[0].index);
      if (titleQuality(title) && !/^(If |Stop |Open |Check |Gain |Disconnect|Then |Note|Notes)/.test(title) && !nearBefore.includes('Notes:')) {
        const key = title + '|' + group.length;
        if (!results.some(r => r.title === title && r.steps.length === group.length)) {
          results.push({
            title,
            equipment: model,
            steps: group.map(s => ({ num: s.num, text: s.txt })),
            warnings: [], notes: [], subSections: []
          });
        }
      }
    }
    const curr = allSteps[i] ? allSteps[i].num : 0;
    while (i < allSteps.length && allSteps[i].num === curr) i++;
  }
  return results;
}

// Same title filter for John Deere
function titleQualityJD(title) {
  const badPatterns = [/^[A-Z][a-z]+$/, /^\d/, /^\s{0,10}$/];
  for (const p of badPatterns) if (p.test(title)) return false;
  if (title.length < 6) return false;
  return true;
}

// ===== Detect quick-access procedures (service mode, diagnostics, calibration entry) =====
function isQuickAccess(proc) {
  const t = proc.title.toLowerCase();
  // Only match specific title patterns — these are the "in a pinch" procedures
  const quickPatterns = [
    /access level/i,
    /calibrat(?:ion|e).*(?:menu|system|sensor|level|overload|outrigger)/i,
    /calibrations menu/i,
    /personalities menu/i,
    /setup the machine/i,
    /set up the/i,
    /determine the (?:software|revision)/i,
    /change the software/i,
    /software (?:config|revision)/i,
    /hand held analyzer/i,
    /mobile analyzer/i,
    /analyzer usage/i,
    /machine data access/i,
    /machine set.up menu/i,
    /fault code/i,
    /diagnostic trouble/i,
    /gauge fault/i,
    /retrieve.*fault/i,
    /retrieve.*(?:control|engine|platform)/i,
    /clear.*fault/i,
    /clear.*ecm/i,
    /towing/i,
    /emergency (?:stop|descent|lowering)/i,
    /manual platform lowering/i,
    /adjust.*(?:relief|speed|threshold|max.out|ramp rate)/i,
    /restore.*default/i,
    /prime the pump/i,
    /test the (?:hydraulic|pump)/i,
    /system test/i,
    /install and calibrate/i,
    /activate the battery drain/i,
    /adjust the (?:lift|steer|system) (?:speed|relief)/i,
  ];
  return quickPatterns.some(p => p.test(t));
}

// ===== Generate markdown =====
function procToMarkdown(proc, manualPrefix) {
  const slug = proc.title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 65);
  let md = `# ${proc.title}\n\n`;
  md += `**Equipment:** ${proc.equipment}\n\n`;

  for (const w of [...new Set(proc.warnings)]) {
    md += `> ⚠ **${w}**\n>\n`;
  }

  if (proc.subSections && proc.subSections.length > 0) {
    // Use sub-section structure
    for (const sub of proc.subSections) {
      md += `## ${sub.heading}\n\n`;
      for (const step of sub.steps) {
        md += `${step.num}. ${step.text}\n`;
      }
      md += '\n';
    }
  } else {
    for (const step of proc.steps) {
      md += `${step.num}. ${step.text}\n`;
    }
  }

  for (const n of [...new Set(proc.notes)]) {
    md += `\n> **Note:** ${n}\n`;
  }

  if (md.length > 35000) {
    md = md.substring(0, 35000) + '\n\n*(Procedure truncated - see full manual for complete details)*\n';
  }

  const filename = `${manualPrefix}-${slug}.md`;
  writeFileSync(`${procDir}/${filename}`, md);
  return filename;
}

// ===== Main =====
const manuals = [
  { file: 'genie-s65-manual.txt', model: 'Genie S-60 / S-65 / S-60 TRAX / S-65 TRAX', parser: 'genie' },
  { file: 'genie-gs1930-manual.txt', model: 'Genie GS-1930 / GS-2632 / GS-3232', parser: 'genie' },
  { file: 'genie-s80-manual.txt', model: 'Genie S-80 / S-85', parser: 'genie' },
  { file: 'genie-gth5519-manual.txt', model: 'Genie GTH-5519', parser: 'gth' },
  { file: 'jlg800s860sj-manual.txt', model: 'JLG 800S / 860SJ', parser: 'jlg' },
  { file: 'jlg-450aj-manual.txt', model: 'JLG 450AJ', parser: 'jlg' },
  { file: 'skyjack-4632-manual.txt', model: 'Skyjack 4632 / 3226 / 4626', parser: 'jlg' },
  { file: 'skyjack-sj46aj-manual.txt', model: 'Skyjack SJ46AJ / SJIII Series', parser: 'jlg' },
  { file: 'john-deere-skidsteer.txt', model: 'John Deere 326D / 328D / 329D / 332D / 333D', parser: 'johnDeere' },
  { file: 'doosan-dgk-service.txt', model: 'Doosan DGK25B / 45A / 45C / 60A / 70B / 100B', parser: 'doosan' },
  { file: 'onan-hdkbc-service.txt', model: 'Onan HDKBC Generator', parser: 'genie' },
  { file: 'genie-z80-service.txt', model: 'Genie Z-80 / Z-80/60', parser: 'genie' },
  { file: 'genie-gr15-service.txt', model: 'Genie GR-15 / GR-20', parser: 'genie' },
  { file: 'genie-1932-service.txt', model: 'Genie 1932 / 2032 / 2046', parser: 'genie' },
  { file: 'jlg-g5-18a-service.txt', model: 'JLG G5-18A', parser: 'jlg' },
  { file: 'wacker-g25-repair.txt', model: 'Wacker Neuson G25', parser: 'genie' },
  { file: 'wacker-g85-repair.txt', model: 'Wacker Neuson G85', parser: 'genie' },
  { file: 'wacker-g50-service.txt', model: 'Wacker Neuson G50', parser: 'genie' },
  { file: 'doosan-dca150-service.txt', model: 'Doosan DCA25-150 Generator', parser: 'jlg' },
];

let totalProcs = 0;

for (const manual of manuals) {
  try {
    const text = readFileSync(`${rawDir}/${manual.file}`, 'utf-8');
    const prefix = manual.file.replace('-manual.txt', '');
    let procs;

    if (manual.parser === 'genie') {
      procs = extractGenie(text, manual.model);
    } else if (manual.parser === 'johnDeere') {
      procs = extractJohnDeere(text, manual.model);
    } else if (manual.parser === 'doosan') {
      procs = extractDoosan(text, manual.model);
    } else if (manual.parser === 'gth') {
      procs = extractGTH(text, manual.model);
    } else {
      procs = extractJLG(text, manual.model);
    }

    console.log(`${manual.model}: ${procs.length} procedures`);

    for (const proc of procs) {
      const filename = procToMarkdown(proc, prefix);
      const qa = isQuickAccess(proc);
      procedures.push({
        id: filename.replace('.md', ''),
        title: proc.title,
        equipment: proc.equipment,
        file: filename,
        steps: proc.subSections && proc.subSections.length > 0
          ? proc.subSections.reduce((a, s) => a + s.steps.length, 0)
          : proc.steps.length,
        quickAccess: qa
      });
      totalProcs++;
    }
  } catch (e) {
    console.log(`${manual.model}: ERROR - ${e.message}`);
  }
}

writeFileSync(`${procDir}/procedures.json`, JSON.stringify(procedures, null, 2));
console.log(`\nTotal procedures extracted: ${totalProcs}`);
console.log('DONE');
