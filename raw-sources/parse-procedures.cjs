const { readFileSync, writeFileSync, mkdirSync } = require('fs');

const rawDir = '/workspace/equipdiag/raw-sources';
const procDir = '/workspace/equipdiag/procedures';
mkdirSync(procDir, { recursive: true });

const procedures = [];

// ===== Extract steps from a text section =====
function extractSteps(section) {
  const steps = [];
  const stepRe = /(\d+)\.?\s{3,}([A-Z][A-Za-z0-9\s\/,;'".()\-]+?)(?=(?:\s+\d+)\.?\s{3,}[A-Z]|$)/g;
  let sm;
  const seen = new Set();
  while ((sm = stepRe.exec(section)) !== null) {
    const num = parseInt(sm[1]);
    const text = sm[2].trim();
    if (text.length >= 10 && num <= 80 && !seen.has(num)) {
      seen.add(num);
      steps.push({ num, text });
    }
  }
  // If that didn't work, try with fewer spaces
  if (steps.length < 2) {
    const altRe = /(\d+)\.?\s{2,}([A-Z][A-Za-z].+?)(?=\s{2,}\d+\.?\s{2,}[A-Z]|$)/g;
    const seen2 = new Set();
    while ((sm = altRe.exec(section)) !== null) {
      const num = parseInt(sm[1]);
      const text = sm[2].trim();
      if (text.length >= 15 && num <= 80 && !seen2.has(num) && !text.match(/^[A-Z][a-z]+\s{2,}/)) {
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
  const sectionRe = /(\d+)\.(\d+)\s{3,}([A-Z][A-Za-z0-9\s,\/\-()#&]{5,60}?)(?=\s{2,}\d)/g;
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
  { file: 'genie-gth5519-manual.txt', model: 'Genie GTH-5519', parser: 'genie' },
  { file: 'jlg800s860sj-manual.txt', model: 'JLG 800S / 860SJ', parser: 'jlg' },
  { file: 'jlg-450aj-manual.txt', model: 'JLG 450AJ', parser: 'jlg' },
  { file: 'skyjack-4632-manual.txt', model: 'Skyjack 4632 / 3226 / 4626', parser: 'jlg' },
  { file: 'skyjack-sj46aj-manual.txt', model: 'Skyjack SJ46AJ / SJIII Series', parser: 'jlg' },
];

let totalProcs = 0;

for (const manual of manuals) {
  try {
    const text = readFileSync(`${rawDir}/${manual.file}`, 'utf-8');
    const prefix = manual.file.replace('-manual.txt', '');
    let procs;

    if (manual.parser === 'genie') {
      procs = extractGenie(text, manual.model);
    } else {
      procs = extractJLG(text, manual.model);
    }

    console.log(`${manual.model}: ${procs.length} procedures`);

    for (const proc of procs) {
      const filename = procToMarkdown(proc, prefix);
      procedures.push({
        id: filename.replace('.md', ''),
        title: proc.title,
        equipment: proc.equipment,
        file: filename,
        steps: proc.subSections && proc.subSections.length > 0
          ? proc.subSections.reduce((a, s) => a + s.steps.length, 0)
          : proc.steps.length
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
