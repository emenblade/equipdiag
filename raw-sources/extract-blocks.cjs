const { readFileSync, writeFileSync, mkdirSync } = require('fs');

const rawDir = '/workspace/equipdiag/raw-sources';
const procDir = '/workspace/equipdiag/procedures';
mkdirSync(procDir, { recursive: true });

const procedures = [];

function isQuickAccess(title) {
  const t = title.toLowerCase();
  const exclude = /^(Remove|Install|Replace|Bleed|Prime)/i;
  if (exclude.test(t)) return false;
  const patterns = [
    /access level/i,
    /calibrat(?:ion|e)/i,
    /setup machine/i,
    /machine set.?up/i,
    /set up the (?:machine|analyzer)/i,
    /determine the (?:software|revision)/i,
    /change the software/i,
    /software (?:config|revision)/i,
    /hand held analyzer/i,
    /mobile analyzer/i,
    /analyzer usage/i,
    /machine data access/i,
    /fault code/i,
    /retrieve.*fault/i,
    /retrieve.*(?:control|engine|platform)/i,
    /clear.*fault/i,
    /clear.*ecm/i,
    /towing/i,
    /adjust.*(?:threshold|max[.-]out|ramp\s*rate)/i,
    /restore.*default/i,
    /system test/i,
    /load sensor/i,
    /platform overload/i,
    /platform level/i,
    /pressure setting/i,
  ];
  // Also exclude titles with known bad patterns (figure refs, parts listing)
  const badPatterns = /^Figure|^Table|^AB\s|^AD,\s|^F\s+T\s|^B\s+\d|^Axle|^Steer|^Telescope|^Jib\s+Lift|^Main\s+Lift|^Slave\s+\(|^AXLE/i;
  if (badPatterns.test(t)) return false;
  return patterns.some(p => p.test(t));
}

function extractTitle(afterHow) {
  const m3 = /\s{3,}/.exec(afterHow);
  const mDot = /\.\s{2,}/.exec(afterHow);
  const m2 = /\s{2,}(?=the\s|The\s|a\s|A\s|an\s|An\s|is\s|are\s|will\s|should\s|must\s|may\s|can\s|This\s|this\s|that\s|Note:|NOTE:|Proper|Calibration|At\s|Perform|Perfo|Function\s|Result)/.exec(afterHow);

  let end = -1;
  if (m3 && mDot) end = Math.min(m3.index, mDot.index);
  else if (m3) end = m3.index;
  else if (mDot) end = mDot.index;
  else if (m2) end = m2.index;
  else end = 60;

  let t = afterHow.substring(0, end).replace(/\.$/, '').trim();
  t = t.replace(/^How to\s+/i, '');
  // Collapse double spaces from PDF artifacts
  t = t.replace(/\s{2,}/g, ' ');
  return t;
}

function extractSteps(section) {
  const steps = [];
  const re = /(\d+)\.?\s{2,}([A-Z][A-Za-z0-9\s\/,;'".()\-#:]+?)(?=(?:\s+\d+\.?\s{2,}[A-Z])|$)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(section)) !== null) {
    const num = parseInt(m[1]);
    let text = m[2].trim();
    const nl = text.indexOf('\n');
    if (nl > 0) text = text.substring(0, nl).trim();
    // Clean step text: remove warning labels that bleed in from PDF
    text = text.replace(/^Electrocution\/burn hazard\.\s*/i, '');
    text = text.replace(/\s+Electrocution\/burn hazard\..*$/i, '');
    text = text.replace(/\s+Component damage hazard\..*$/i, '');
    text = text.replace(/\s+Tip-over hazard\..*$/i, '');
    text = text.replace(/\s+Bodily injury hazard\..*$/i, '');
    // Remove "Result:" continuation as trailing text
    text = text.replace(/\s+Result:.*$/, '');
    text = text.trim();

    if (text.length >= 5 && num >= 1 && num <= 25 && !seen.has(num) &&
        !/^(January|February|March|April|May|June|July|August|September|October|November|December)\s/.test(text) &&
        !/\bPart No\b/.test(text) &&
        !/^(Table of|Section|Serial|FIGURE|INDEX|Safety|Specifications)/i.test(text) &&
        !/^[A-Z][a-z]+\s{2,}\d/.test(text) &&
        !/^(Value at|Value too|Function is|Limited speed|Reduced speed|Normal function|Valve is|Direction frozen|Motor speed|Initiate|Function Cutback|Platform Path|DTC|SPN)\s/.test(text)) {
      seen.add(num);
      steps.push({ num, text });
    }
  }
  steps.sort((a, b) => a.num - b.num);
  if (steps.length > 0 && steps[0].num !== 1) return [];
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].num !== steps[i-1].num + 1) {
      if (steps[i].num - steps[i-1].num > 3) return steps.slice(0, i);
    }
  }
  return steps;
}

function extractNotes(section) {
  const notes = [];
  const re = /Note:\s*([A-Z][^.]{10,300}\.)/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    notes.push(m[1].trim());
  }
  return notes;
}

function extractWarnings(section) {
  const warnings = [];
  const re = /(Electrocution[^.]*\.)/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    warnings.push(m[0].trim());
  }
  return warnings;
}

function extractGenie(text, model) {
  const cleaned = text.split(/\nPAGE \d+/).join(' ');

  const results = [];
  const seenTitles = new Set();

  let pos = -1;
  const positions = [];
  while ((pos = cleaned.indexOf('How to ', pos + 1)) !== -1) {
    // Skip cross-references: "Refer to ... How to" or "See ... How to" within 100 chars
    const before = cleaned.substring(Math.max(0, pos - 100), pos);
    if (/\b(Refer to|See)\b[^.]{0,60}How to\s*$/i.test(before + 'How to ')) continue;
    positions.push(pos);
  }

  for (let i = 0; i < positions.length; i++) {
    const howIdx = positions[i];
    const afterHow = cleaned.substring(howIdx + 7, howIdx + 150);

    let title = extractTitle(afterHow);
    if (!title || title.length < 5 || title.length > 70) continue;

    // Skip general maintenance topics that aren't quick-access
    // But keep everything with >= 2 steps
    const key = title.toLowerCase();
    if (seenTitles.has(key)) continue;

    const nextHow = i + 1 < positions.length ? positions[i + 1] : cleaned.length;
    const sectionEnd = Math.min(howIdx + 8000, nextHow);
    let section = cleaned.substring(howIdx, sectionEnd);

    const steps = extractSteps(section);
    if (steps.length < 2) {
      const shortSection = cleaned.substring(howIdx, Math.min(howIdx + 4000, nextHow));
      const shortSteps = extractSteps(shortSection);
      if (shortSteps.length >= 2) {
        section = shortSection;
        steps.length = 0;
        steps.push(...shortSteps);
      } else {
        continue;
      }
    }

    if (steps.length > 18) {
      const trimmed = steps.filter(s => s.num <= 12);
      if (trimmed.length < 2) continue;
      steps.length = 0;
      steps.push(...trimmed);
    }

    seenTitles.add(key);

    const notes = extractNotes(section);
    const warnings = extractWarnings(section);

    results.push({ title, equipment: model, steps, warnings, notes });
  }
  return results;
}

function cleanJLGTitles(page) {
  let title = '';
  const stepMatch = page.match(/STEP\s+\d+\s*:\s*([A-Z][A-Za-z0-9\s\/\-]{5,80}?)(?=\s*\d+\.?\s{2,})/);
  if (stepMatch) title = stepMatch[1].trim();

  if (!title || title.length < 5) {
    const secMatch = page.match(/\b(\d+\.\d+|\d+-\d+)\s{2,}([A-Z][A-Za-z0-9\s\/,;\-()]{5,60}?)(?=\s{3,}[A-Z0-9\-])/);
    if (secMatch) {
      const t = secMatch[2].trim();
      if (t.length >= 5 && t.length <= 60 &&
          !/^(SPECIFICATION|INTRODUCTION|SAFETY|DISCLAIMER|SECTION\s|FIGURE|TABLE\s|INDEX)/i.test(t)) {
        title = t;
      }
    }
  }

  if (!title || title.length < 5) {
    const ctxMatch = page.match(/(?:Calibrating|Calibration|Pressure Setting|Access Level|System Test|Towing|Hand Held Analyzer|Machine Data|Fault Code|Load Sensor)\s{0,3}[A-Z][A-Za-z0-9\s\/\-]{0,60}/);
    if (ctxMatch) title = ctxMatch[0].trim();
  }

  if (!title || title.length < 5) return '';
  title = title.replace(/\s{2,}/g, ' ');
  title = title.replace(/\s*NOTE:\s*Refer to.*/i, '');
  title = title.replace(/\s*\.{2,}.*$/, '');
  return title.trim().substring(0, 65);
}

function extractJLG(text, model) {
  const cleaned = text.split(/\nPAGE \d+/).join(' ');
  const results = [];
  const seenTitles = new Set();

  const stepBlockRe = /STEP\s+\d+\s*:\s*([A-Z].*?)(?=STEP\s+\d+\s*:|$)/gs;
  let m;
  const positions = [];
  while ((m = stepBlockRe.exec(cleaned)) !== null) {
    positions.push({ index: m.index, title: cleanJLGTitles(m[0]), block: m[0] });
  }

  if (positions.length === 0) {
    const pages = text.split('PAGE ');
    for (let pi = 1; pi < pages.length; pi++) {
      const page = pages[pi];
      if (page.length < 200) continue;
      const title = cleanJLGTitles(page);
      if (!title) continue;
      const steps = extractSteps(page);
      if (steps.length < 2) continue;
      if (steps.length > 20) {
        const trimmed = steps.filter(s => s.num <= 12);
        if (trimmed.length >= 2) { steps.length = 0; steps.push(...trimmed); }
        else continue;
      }
      const key = title + '|' + steps.length;
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      results.push({ title, equipment: model, steps, warnings: [], notes: [] });
    }
    return results;
  }

  for (const pos of positions) {
    let title = pos.title;
    if (!title || title.length < 5) continue;
    const steps = extractSteps(pos.block);
    if (steps.length < 2) continue;
    if (steps.length > 20) {
      const trimmed = steps.filter(s => s.num <= 12);
      if (trimmed.length >= 2) { steps.length = 0; steps.push(...trimmed); }
      else continue;
    }
    const key = title + '|' + steps.length + '|' + model;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    results.push({ title, equipment: model, steps, warnings: [], notes: [] });
  }
  return results;
}

function procToMarkdown(proc, prefix) {
  const slug = proc.title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 65);
  let md = `# ${proc.title}\n\n`;
  md += `**Equipment:** ${proc.equipment}\n\n`;

  for (const w of [...new Set(proc.warnings)]) {
    md += `> **${w}**\n>\n`;
  }

  for (const step of proc.steps) {
    md += `${step.num}. ${step.text}\n`;
  }

  for (const n of [...new Set(proc.notes)]) {
    md += `\n> **Note:** ${n}\n`;
  }

  if (md.length > 35000) {
    md = md.substring(0, 35000) + '\n\n*(Procedure truncated)*\n';
  }

  const filename = `${prefix}-${slug}.md`;
  writeFileSync(`${procDir}/${filename}`, md);
  return filename;
}

const manuals = [
  { file: 'genie-s65-manual.txt', model: 'Genie S-60 / S-65 / S-60 TRAX / S-65 TRAX', parser: 'genie' },
  { file: 'genie-gs1930-manual.txt', model: 'Genie GS-1930 / GS-2632 / GS-3232', parser: 'genie' },
  { file: 'genie-s80-manual.txt', model: 'Genie S-80 / S-85', parser: 'genie' },
  { file: 'genie-z80-service.txt', model: 'Genie Z-80 / Z-80/60', parser: 'genie' },
  { file: 'genie-gr15-service.txt', model: 'Genie GR-15 / GR-20', parser: 'genie' },
  { file: 'genie-1932-service.txt', model: 'Genie 1932 / 2032 / 2046', parser: 'genie' },
  { file: 'jlg-450aj-manual.txt', model: 'JLG 450AJ', parser: 'jlg' },
  { file: 'jlg800s860sj-manual.txt', model: 'JLG 800S / 860SJ', parser: 'jlg' },
  { file: 'jlg-g5-18a-service.txt', model: 'JLG G5-18A', parser: 'jlg' },
  { file: 'skyjack-4632-manual.txt', model: 'Skyjack 4632 / 3226 / 4626', parser: 'jlg' },
  { file: 'skyjack-sj46aj-manual.txt', model: 'Skyjack SJ46AJ / SJIII Series', parser: 'jlg' },
];

let totalProcs = 0;

for (const manual of manuals) {
  try {
    const text = readFileSync(`${rawDir}/${manual.file}`, 'utf-8');
    const prefix = manual.file.replace(/-manual\.txt|-service\.txt/, '');
    let procs;

    if (manual.parser === 'genie') {
      procs = extractGenie(text, manual.model);
    } else {
      procs = extractJLG(text, manual.model);
    }

    console.log(`${manual.model}: ${procs.length} procedures`);

    const seenKeys = new Set();
    for (const proc of procs) {
      const filename = procToMarkdown(proc, prefix);
      const qa = isQuickAccess(proc.title);
      const key = proc.title + '|' + proc.equipment;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      procedures.push({
        id: filename.replace('.md', ''),
        title: proc.title,
        equipment: proc.equipment,
        file: filename,
        steps: proc.steps.length,
        quickAccess: qa
      });
      totalProcs++;
    }
  } catch (e) {
    console.log(`${manual.model}: ERROR - ${e.message}`);
  }
}

procedures.sort((a, b) => {
  if (a.quickAccess !== b.quickAccess) return a.quickAccess ? -1 : 1;
  return a.title.localeCompare(b.title);
});

writeFileSync(`${procDir}/procedures.json`, JSON.stringify(procedures, null, 2));
console.log(`\nTotal procedures extracted: ${totalProcs}`);
console.log(`Quick access: ${procedures.filter(p => p.quickAccess).length}`);
