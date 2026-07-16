const { readFileSync, writeFileSync } = require('fs');
const pdfjs = require('pdfjs-dist');

const manuals = {
  'john-deere-skidsteer': '/mnt/Share/Equipment Manuals/pdf-john-deere-326d-328d-329d-332d-333d-servie-repair-manual (1).pdf',
  'doosan-dgk-service': '/mnt/Share/Equipment Manuals/DGK25B,45A,45C,60A,70B,100B-Service-Manual.pdf',
  'onan-hdkbc-service': '/mnt/Share/Equipment Manuals/onan HDKBC service manual.pdf',
  'genie-z80-service': '/mnt/Share/Equipment Manuals/genie z80 service.pdf',
  'genie-gr15-service': '/mnt/Share/Equipment Manuals/Genie_gr-15_service.pdf',
  'genie-1932-service': '/mnt/Share/Equipment Manuals/Genie_1932_service.pdf',
  'jlg-g5-18a-service': '/mnt/Share/Equipment Manuals/31211325_A_G5-18A (ANSI)_JLG_Service_English.pdf',
  'wacker-g25-repair': '/mnt/Share/Equipment Manuals/Wacker g25 repair.pdf',
  'wacker-g85-repair': '/mnt/Share/Equipment Manuals/Wacker g85 repair.pdf',
  'wacker-g50-service': '/mnt/Share/Equipment Manuals/Wacker_g50_service.pdf',
  'doosan-dca150-service': '/mnt/Share/Equipment Manuals/DCA25-150_Service_Manual.pdf',
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
      if (i % 30 === 0) process.stderr.write(`  ${name}: page ${i}/${totalPages}\n`);
    }
    const out = `${outDir}/${name}.txt`;
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
