// Renders a Markdown document (headings, paragraphs, lists, tables, code, quotes) to a styled A4 PDF with Chrome.
// Usage: node md-to-pdf.mjs <input.md> <output.pdf> "<footer title>"
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const [input, output, footer = path.basename(input)] = process.argv.slice(2);
const md = fs.readFileSync(input, 'utf8').replace(/\r\n/g, '\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  const parts = s.split(/(`[^`]+`)/g);
  return parts.map((p) => (p.startsWith('`') && p.endsWith('`') && p.length > 1
    ? `<code>${esc(p.slice(1, -1))}</code>`
    : esc(p).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1'))).join('');
}
const cells = (row) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());

const lines = md.split('\n');
let html = '';
let first = true;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.startsWith('```')) {
    const buf = [];
    while (++i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i]);
    html += `<pre>${esc(buf.join('\n'))}</pre>`;
  } else if (/^#{1,3} /.test(l)) {
    const level = l.match(/^#+/)[0].length;
    if (level === 1 && first) { html += `<div class="cover"><h1>${inline(l.slice(2))}</h1>`; first = 'cover'; continue; }
    html += `<h${level}>${inline(l.replace(/^#+ /, ''))}</h${level}>`;
  } else if (l.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    i--;
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    html += `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${
      body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  } else if (l.startsWith('> ')) {
    const buf = [];
    while (i < lines.length && lines[i].startsWith('> ')) buf.push(lines[i++].slice(2));
    i--;
    html += `<div class="note">${inline(buf.join(' '))}</div>`;
  } else if (/^[-*] /.test(l)) {
    const buf = [];
    while (i < lines.length && /^[-*] /.test(lines[i])) buf.push(lines[i++].slice(2));
    i--;
    html += `<ul>${buf.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>`;
  } else if (/^---+$/.test(l.trim())) {
    if (first === 'cover') { html += '</div>'; first = false; }
  } else if (l.trim()) {
    const buf = [l];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||> |```|[-*] |---)/.test(lines[i + 1])) buf.push(lines[++i]);
    html += `<p>${inline(buf.join(' '))}</p>`;
  }
}
if (first === 'cover') html += '</div>';

const page = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #1f2937; font-size: 9.4pt; line-height: 1.45; margin: 0; }
  .cover { background: linear-gradient(120deg, #0b1435, #1c2a5e); color: #c9d4ef; border-radius: 12px; padding: 22px 26px; margin-bottom: 14px; }
  .cover h1 { color: #fff; font-size: 22pt; margin: 0 0 6px; letter-spacing: -0.02em; }
  .cover p { color: #b3c0e2; margin: 0 0 4px; }
  .cover code { background: rgba(255,255,255,.12); color: #fff; }
  h2 { font-size: 13pt; color: #0b1435; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 2px solid #e4e8ef; break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 12px 0 5px; }
  p { margin: 0 0 7px; }
  ul { margin: 0 0 8px; padding-left: 18px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 8.5pt; }
  th { background: #f1f4f9; color: #475569; text-align: left; font-weight: 600; font-size: 7.6pt; text-transform: uppercase; letter-spacing: .04em; padding: 6px 7px; border-bottom: 1px solid #d3d9e3; }
  td { padding: 5px 7px; border-bottom: 1px solid #edf0f5; vertical-align: top; }
  tr { break-inside: avoid; }
  code { font-family: Consolas, 'Cascadia Code', monospace; font-size: 8pt; background: #f1f4f8; padding: 0 4px; border-radius: 3px; word-break: break-word; }
  pre { font-family: Consolas, 'Cascadia Code', monospace; font-size: 7.8pt; background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 8px; white-space: pre-wrap; word-break: break-word; break-inside: avoid; margin: 4px 0 10px; }
  .note { background: #fff6e5; border: 1px solid #f7dca8; border-left: 3px solid #d97706; border-radius: 6px; padding: 7px 10px; margin: 6px 0 10px; font-size: 8.6pt; color: #78350f; }
</style></head><body>${html}</body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const p = await browser.newPage();
await p.setContent(page, { waitUntil: 'networkidle' });
await p.pdf({
  path: output, format: 'A4', printBackground: true,
  margin: { top: '15mm', bottom: '16mm', left: '14mm', right: '14mm' },
  displayHeaderFooter: true, headerTemplate: '<div></div>',
  footerTemplate: `<div style="font-size:7pt;color:#94a3b8;width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial"><span>${esc(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log(output, `${(fs.statSync(output).size / 1024).toFixed(0)} KB`);
