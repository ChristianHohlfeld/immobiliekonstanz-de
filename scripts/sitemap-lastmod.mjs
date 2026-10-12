import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Call only after the published homepage content changes, never for an unchanged crawl.
export function updateSitemapLastmod(root, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('Invalid lastmod');
  const file = join(root, 'sitemap.xml');
  const xml = readFileSync(file, 'utf8');
  const pattern = /(<loc>https:\/\/immobiliekonstanz\.de\/<\/loc>\s*<lastmod>)[^<]+(<\/lastmod>)/;
  if (!pattern.test(xml)) throw new Error('Homepage sitemap entry missing');
  const next = xml.replace(pattern, (_, before, after) => before + date + after);
  if (next !== xml) writeFileSync(file, next);
}
