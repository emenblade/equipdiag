const { readFileSync, writeFileSync } = require('fs');
const pdfjs = require('pdfjs-dist');

const manuals = {
  'jlg800s860sj': '/mnt/Share/Equipment Manuals/Jlg 800.pdf',
  'genie-s65': '/mnt/Share/Equipment Manuals/Genie_s65_service.pdf',
  'genie-gs1930': '/mnt/Share/Equipment Manuals/gs1930and up genie service.pdf',
  'skyjack-4632': '/mnt/Share/Equipment Manuals/Skyjack_4632legacyservice.pdf',
  'genie-gth5519': '/mnt/Share/Equipment Manuals/Genie_gth5519_service.pdf',
  'genie-s80': '/mnt/Share/Equipment Manuals/Genie_s80_service.pdf',
  'jlg-450aj': '/mnt/Share/Equipment Manuals/jlg aj 450 service manual.pdf',
  'skyjack-sj46aj': '/mnt/Share/Equipment Manuals/sj46aj skyjack service.pdf',
};

const outDir = '/workspace/equipdiag/raw-sources';

async function extract(name, path, maxPages) {
  try {
    const data = new Uint8Array(readFileSync(path));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const totalPages = Math.min(doc.numPages, maxPages || doc.numPages);
    let text = '';
    for (let i = 1; i <= totalPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str || '').join(' ');
      text += 'PAGE ' + i + '\n' + pageText + '\n\n';
      if (i % 50 === 0) process.stderr.write(`  ${name}: page ${i}/${totalPages}\n`);
    }
    const out = `${outDir}/${name}-manual.txt`;
    writeFileSync(out, text);
    return { name, pages: totalPages, bytes: text.length };
  } catch (e) {
    return { name, error: e.message };
  }
}

(async () => {
  const results = [];
  for (const [name, path] of Object.entries(manuals)) {
    process.stderr.write(`Extracting ${name}...\n`);
    results.push(await extract(name, path));
  }
  for (const r of results) {
    if (r.error) console.log(`FAIL ${r.name}: ${r.error}`);
    else console.log(`OK ${r.name}: ${r.pages} pages, ${r.bytes} bytes`);
  }
})();
