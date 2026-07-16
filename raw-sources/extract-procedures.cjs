const { readFileSync, writeFileSync, mkdirSync } = require('fs');

const rawDir = '/workspace/equipdiag/raw-sources';
const procDir = '/workspace/equipdiag/procedures';
mkdirSync(procDir, { recursive: true });

const procedures = [];

// ===== Extract steps from a section of text =====
function extractSteps(section) {
  const steps = [];
  // Match: number + 2+ spaces + text (until next number + 2+ spaces or end)
  const re = /(\d+)\s{2,}([A-Z][A-Za-z0-9\s\/,;'".()\-_]+?)(?=\s{1,}\d+\s{2,}[A-Z]|$)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(section)) !== null) {
    const num = parseInt(m[1]);
    let text = m[2].trim();
    // Truncate at newline (takes only first line)
    const nl = text.indexOf('\n');
    if (nl > 0) text = text.substring(0, nl).trim();
    // Filter out table entries, TOC entries, page headers
    if (
      text.length >= 5 &&
      num <= 30 &&
      !seen.has(num) &&
      !/^(January|February|March|April|May|June|July|August|September|October|November|December)\s/.test(text) &&
      !/\bPart No\b/.test(text) &&
      !/^(Section|Table of|Serial|INDEX|FIGURE|Error Source|Result:)/.test(text) &&
      !/^\d+\s{2,}[A-Z]/.test(text) &&
      text.length < 120 // table entries tend to be very short
    ) {
      // Skip entries that look like fault code table data (short value descriptions)
      if (/^(Value at|Value too|Not calibrated|Function is|Limited speed|Reduced speed|Normal function|Valve is|Direction frozen|Motor speed|Initiate)/.test(text)) {
        // Check if this is really in a table context
        const before = section.substring(Math.max(0, m.index - 80), m.index);
        if (/Error Source|Error Type|ID\s{2,}Name/.test(before)) continue;
      }
      seen.add(num);
      steps.push({ num, text });
    }
  }
  steps.sort((a, b) => a.num - b.num);
  // Validate sequential
  if (steps.length > 0 && steps[0].num !== 1) return [];
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].num !== steps[i-1].num + 1) {
      // Allow small gaps but not large ones
      if (steps[i].num - steps[i-1].num > 3) return steps.slice(0, i);
    }
  }
  return steps;
}

// ===== Extract notes from a section =====
function extractNotes(section) {
  const notes = [];
  const re = /Note:\s*([A-Z][^.]{10,300}\.)/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    notes.push(m[1].trim());
  }
  return notes;
}

// ===== Genie-style "How to ..." =====
function extractGenie(text, model) {
  const cleaned = text.split(/\nPAGE \d+/).join(' ');

  const results = [];
  const seenTitles = new Set();

  // Find all "How to" positions
  const positions = [];
  let pos = -1;
  while ((pos = cleaned.indexOf('How to ', pos + 1)) !== -1) {
    positions.push(pos);
  }

  for (let i = 0; i < positions.length; i++) {
    const howIdx = positions[i];
    const before = cleaned.substring(Math.max(0, howIdx - 150), howIdx);

    // Skip "Refer to" and "See" references
    if (/(?:Refer to|See)\s[^.]*How to\s/.test(cleaned.substring(Math.max(0, howIdx - 150), howIdx + 20))) continue;
    // Skip TOC entries (followed by page number pattern like ".... 102")
    const tocCheck = cleaned.substring(howIdx + 7, howIdx + 100);
    if (/\.{3,}\s*\d+\s/.test(tocCheck)) continue;

    // Extract title: text after "How to " up to 3+ spaces or ".  " (period + 2+ spaces)
    const afterHow = cleaned.substring(howIdx + 7, howIdx + 150);
    const boundary = afterHow.search(/\s{2,}|\.\s{2,}/);
    let title;
    if (boundary > 0) {
      title = afterHow.substring(0, boundary).trim();
    } else {
      // No clear boundary, take first ~60 chars
      title = afterHow.substring(0, 60).trim();
    }
    // Remove trailing period
    title = title.replace(/\.$/, '').trim();
    if (title.length < 5 || title.length > 70) continue;
    // Skip non-procedure titles
    if (/^(Specifications?|Section|Table of|Serial|Part No|FIGURE)/i.test(title)) continue;

    const key = title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    // Section: from this "How to" to next "How to" or +8000 chars
    const nextHow = i + 1 < positions.length ? positions[i + 1] : cleaned.length;
    const sectionEnd = Math.min(howIdx + 8000, nextHow);
    let section = cleaned.substring(howIdx, sectionEnd);

    const steps = extractSteps(section);
    if (steps.length < 2) continue;
    // Trim if too many steps (likely table data leaked in)
    if (steps.length > 20) {
      const trimmed = steps.filter(s => s.num <= 12);
      if (trimmed.length < 2) continue;
      steps.length = 0;
      steps.push(...trimmed);
    }

    const notes = extractNotes(section);
    const warnings = [];
    const warnRe = /(TIP-OVER HAZARD|CRUSHING HAZARD|BODILY INJURY HAZARD|COMPONENT DAMAGE HAZARD|ELECTROCUTION|FALL HAZARD|BURN HAZARD|Electrocution)[^.]*\./g;
    let wm;
    while ((wm = warnRe.exec(section)) !== null) {
      warnings.push(wm[0].trim());
    }

    results.push({ title, equipment: model, steps, warnings, notes });
  }
  return results;
}

// ===== JLG-style section.subsection + steps =====
function extractJLG(text, model) {
  const cleaned = text.split(/\nPAGE \d+/).join(' ');

  const results = [];
  const seenTitles = new Set();

  // Find sections that look like procedure titles (not fault code tables)
  const sectionRe = /(\d+)\.(\d+)\s{3,}([A-Z][A-Za-z0-9\s,\/\-()#&]{5,80}?)(?=\s{2,}\d|\s{2,}[A-Z][a-z])/g;
  let m;
  const sections = [];
  while ((m = sectionRe.exec(cleaned)) !== null) {
    const title = m[3].trim();
    // Filter out non-procedure titles
    if (/^(SPECIFICATIONS?|DISCLAIMER|SAFETY|SECTION \d|OPERATOR|TROUBLESHOOTING|INTRODUCTION)/i.test(title)) continue;
    if (title.length < 5) continue;
    sections.push({ index: m.index, title, major: parseInt(m[1]), minor: parseInt(m[2]) });
  }

  for (let i = 0; i < sections.length; i++) {
    const { index, title } = sections[i];
    const nextIdx = i + 1 < sections.length ? sections[i + 1].index : cleaned.length;
    const section = cleaned.substring(index, Math.min(index + 5000, nextIdx));

    const steps = extractSteps(section);
    if (steps.length < 2) continue;
    if (steps.length > 20) {
      // Trim table data
      const trimmed = steps.filter(s => s.num <= 12);
      if (trimmed.length < 2) continue;
      steps.length = 0;
      steps.push(...trimmed);
    }

    const key = title + '|' + steps.length;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    const notes = extractNotes(section);

    results.push({ title, equipment: model, steps, warnings: [], notes });
  }
  return results;
}

// ===== Quick-access classification =====
function isQuickAccess(proc) {
  const t = proc.title.toLowerCase();
  const patterns = [
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
    /retrieve.*fault/i,
    /retrieve.*(?:control|engine|platform)/i,
    /clear.*fault/i,
    /clear.*ecm/i,
    /towing/i,
    /adjust.*(?:threshold|max.out|ramp rate)/i,
    /restore.*default/i,
    /system test/i,
    /install and calibrate/i,
    /activate the battery drain/i,
    /alarm option/i,
    /battery voltage/i,
  ];
  return patterns.some(p => p.test(t));
}

// ===== Generate markdown =====
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
    md = md.substring(0, 35000) + '\n\n*(Procedure truncated - see full manual for complete details)*\n';
  }

  const filename = `${prefix}-${slug}.md`;
  writeFileSync(`${procDir}/${filename}`, md);
  return filename;
}

// ===== Main =====
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

    const seenProcKeys = new Set();
    for (const proc of procs) {
      const filename = procToMarkdown(proc, prefix);
      const qa = isQuickAccess(proc);
      const key = proc.title + '|' + proc.equipment;
      if (seenProcKeys.has(key)) continue;
      seenProcKeys.add(key);
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

// Write ALL procedures, not just quickAccess filtered
writeFileSync(`${procDir}/procedures.json`, JSON.stringify(procedures, null, 2));
console.log(`\nTotal procedures extracted: ${totalProcs}`);
