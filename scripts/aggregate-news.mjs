#!/usr/bin/env node
/**
 * Clone/pull ChristianHohlfeld/aktuell.digitalisierungsplanung.de and
 * write data/news.json + regenerate the news block in index.html.
 *
 * DigiPlan taxonomy (same order as SITE.categories):
 *   KI, Prozesse, Wohnungswirtschaft, Makler, Energie, Finanzen, Regulierung
 * Automatisierung → Prozesse.
 *
 * SEO / no-duplicate rule for immobiliekonstanz.de:
 *   - Do NOT copy DigiPlan article bodies or long summaries.
 *   - Hub pattern: category, title, date, short unique teaser (≤160 chars,
 *     original wording on this site), dofollow link to canonical DigiPlan URL.
 *   - Attribution on every card: „Quelle: Digitalisierungsplanung Aktuell“.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE_REPO = 'ChristianHohlfeld/aktuell.digitalisierungsplanung.de';
const SOURCE_DIR = process.env.AKTUELL_SRC || join(ROOT, '.tmp', 'aktuell-src');
const ARTICLE_BASE = 'https://aktuell.digitalisierungsplanung.de/artikel';
const SOURCE_HOME = 'https://aktuell.digitalisierungsplanung.de/';
const SOURCE_LABEL = 'Digitalisierungsplanung Aktuell';

/** DigiPlan SITE.categories — all branch sections on this hub. */
const CATEGORY_ORDER = [
  'KI',
  'Prozesse',
  'Wohnungswirtschaft',
  'Makler',
  'Energie',
  'Finanzen',
  'Regulierung'
];
const KEEP = new Set(CATEGORY_ORDER);
const LIMIT_PER_CATEGORY = Number(process.env.NEWS_LIMIT_PER_CATEGORY || 8);
const TEASER_MAX = 160;

const SECTION_LEADS = {
  KI: 'KI-Themen aus Digitalisierungsplanung Aktuell — Titel und Link, Volltext bei der Quelle.',
  Prozesse: 'Prozesse und Automatisierung — Überblick hier, Details auf Digitalisierungsplanung Aktuell.',
  Wohnungswirtschaft: 'Wohnungswirtschaft und Bestand — Meldungen verlinkt zur Quellseite.',
  Makler: 'Markt und Vertrieb für Immobilienmakler — Artikel öffnen auf der Quellseite.',
  Energie: 'Energie und Gebäude — Kurzüberblick mit Link zu Digitalisierungsplanung Aktuell.',
  Finanzen: 'Finanzierung und Rahmenbedingungen — vollständige Beiträge bei der Quelle.',
  Regulierung: 'Regeln und Aufsicht — Index mit Link zu Digitalisierungsplanung Aktuell.'
};

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts
  });
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed (${res.status}): ${err}`);
  }
  return res.stdout || '';
}

function ensureSource() {
  mkdirSync(dirname(SOURCE_DIR), { recursive: true });
  if (existsSync(join(SOURCE_DIR, '.git'))) {
    console.log(`Pulling ${SOURCE_REPO} in ${SOURCE_DIR}`);
    run('git', ['-C', SOURCE_DIR, 'fetch', '--depth', '1', 'origin', 'main']);
    run('git', ['-C', SOURCE_DIR, 'reset', '--hard', 'origin/main']);
    return;
  }
  if (existsSync(SOURCE_DIR)) rmSync(SOURCE_DIR, { recursive: true, force: true });
  console.log(`Cloning ${SOURCE_REPO} → ${SOURCE_DIR}`);
  const gh = spawnSync('gh', ['repo', 'clone', SOURCE_REPO, SOURCE_DIR, '--', '--depth', '1'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });
  if (gh.status === 0) return;
  console.warn('gh clone failed, trying git…', (gh.stderr || '').trim());
  run('git', [
    'clone',
    '--depth', '1',
    `https://github.com/${SOURCE_REPO}.git`,
    SOURCE_DIR
  ]);
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  return meta;
}

function canonicalCategory(category) {
  if (!category) return '';
  if (category === 'Automatisierung') return 'Prozesse';
  return category;
}

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Short hub-only teaser (original wording). Never reuse DigiPlan summary/body.
 * Pattern: category cue + title hook + pointer to source.
 */
function hubTeaser(title, category) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const hook = cleanTitle.length > 90 ? `${cleanTitle.slice(0, 87).trim()}…` : cleanTitle;
  let teaser = `${category}: „${hook}“ — Volltext bei ${SOURCE_LABEL}.`;
  if (teaser.length > TEASER_MAX) {
    const budget = TEASER_MAX - ` — Volltext bei ${SOURCE_LABEL}.`.length - `${category}: „“`.length;
    const shortHook = cleanTitle.slice(0, Math.max(40, budget)).trim() + (cleanTitle.length > budget ? '…' : '');
    teaser = `${category}: „${shortHook}“ — Volltext bei ${SOURCE_LABEL}.`;
  }
  if (teaser.length > TEASER_MAX) {
    teaser = teaser.slice(0, TEASER_MAX - 1).trim() + '…';
  }
  return teaser;
}

function loadArticles() {
  const contentDir = join(SOURCE_DIR, 'content');
  const files = readdirSync(contentDir).filter((f) => f.endsWith('.md'));
  const articles = [];
  for (const file of files) {
    const raw = readFileSync(join(contentDir, file), 'utf8');
    const meta = parseFrontmatter(raw);
    if (!meta) continue;
    const category = canonicalCategory(meta.category || '');
    if (!KEEP.has(category)) continue;
    const slug = meta.slug || file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const date = meta.published || meta.updated || meta.date || '';
    const title = meta.title || slug;
    // Intentionally ignore meta.summary and markdown body (no duplicate content).
    articles.push({
      title,
      slug,
      date,
      updated: meta.updated || date,
      category,
      teaser: hubTeaser(title, category),
      author: meta.author || 'Christian Hohlfeld',
      url: `${ARTICLE_BASE}/${slug}/`,
      sourceFile: file,
      source: SOURCE_LABEL,
      sourceUrl: SOURCE_HOME
    });
  }
  articles.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return articles;
}

function groupByCategory(articles) {
  const by = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, []]));
  for (const a of articles) {
    if (!by[a.category]) by[a.category] = [];
    if (by[a.category].length < LIMIT_PER_CATEGORY) by[a.category].push(a);
  }
  return by;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Berlin'
  }).format(d);
}

function renderSection(category, items) {
  const lead = SECTION_LEADS[category] || '';

  const cards = items.length
    ? `<div class="cards">${items
        .map(
          (a) => `<article class="card">
  <span class="tag">${esc(a.category)}</span>
  <h3><a href="${esc(a.url)}" rel="noopener noreferrer">${esc(a.title)}</a></h3>
  <p class="summary">${esc(a.teaser)}</p>
  <p class="date">${esc(formatDate(a.date))}</p>
  <p class="source">Quelle: <a href="${esc(SOURCE_HOME)}" rel="noopener noreferrer">${esc(SOURCE_LABEL)}</a></p>
</article>`
        )
        .join('\n')}</div>`
    : `<div class="empty">Aktuell keine Beiträge in „${esc(category)}“.</div>`;

  return `<section class="section" id="news-${esc(category.toLowerCase())}" data-category="${esc(category)}">
  <div class="section-head">
    <div>
      <h2>${esc(category)}</h2>
      <p>${esc(lead)}</p>
      <p class="source">Quelle: <a href="${esc(SOURCE_HOME)}" rel="noopener noreferrer">${esc(SOURCE_LABEL)}</a></p>
    </div>
  </div>
  ${cards}
</section>`;
}

function renderNewsHtml(byCategory, generatedAt) {
  const parts = CATEGORY_ORDER.map((c) => renderSection(c, byCategory[c] || []));
  const catList = CATEGORY_ORDER.join(', ');
  return `<!-- NEWS:START -->
<!-- generated: ${esc(generatedAt)} -->
${parts.join('\n')}
<p class="note">Branchenmeldungen als Link-Index von <a href="${esc(SOURCE_HOME)}" rel="noopener noreferrer">${esc(SOURCE_LABEL)}</a> — Kategorien: ${esc(catList)}. Vollständige Artikel nur auf der Quellseite (kein Textübernahme).</p>
<!-- NEWS:END -->`;
}

function writeNewsJson(articles, byCategory, generatedAt) {
  const counts = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, (byCategory[c] || []).length])
  );
  const totalKept = articles.length;
  const payload = {
    generatedAt,
    source: SOURCE_REPO,
    sourceLabel: SOURCE_LABEL,
    sourceHome: SOURCE_HOME,
    articleBase: ARTICLE_BASE,
    categories: CATEGORY_ORDER,
    counts,
    totalMatching: totalKept,
    limitPerCategory: LIMIT_PER_CATEGORY,
    // Hub payload only — no DigiPlan summary/body fields.
    articles: CATEGORY_ORDER.flatMap((c) => byCategory[c] || [])
  };
  const outDir = join(ROOT, 'data');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, 'news.json');
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${path} (${totalKept} matching, showing ${payload.articles.length})`);
  console.log('Counts:', counts);
  return payload;
}

function patchIndex(newsHtml) {
  const indexPath = join(ROOT, 'index.html');
  let html = readFileSync(indexPath, 'utf8');
  const re = /<!-- NEWS:START -->[\s\S]*?<!-- NEWS:END -->/;
  if (!re.test(html)) {
    throw new Error('index.html missing <!-- NEWS:START --> … <!-- NEWS:END --> markers');
  }
  html = html.replace(re, newsHtml);
  writeFileSync(indexPath, html, 'utf8');
  console.log('Updated news block in index.html');
}

function main() {
  ensureSource();
  const all = loadArticles();
  const byCategory = groupByCategory(all);
  const generatedAt = new Date().toISOString();
  writeNewsJson(all, byCategory, generatedAt);
  const newsHtml = renderNewsHtml(byCategory, generatedAt);
  if (existsSync(join(ROOT, 'index.html'))) {
    patchIndex(newsHtml);
  } else {
    writeFileSync(join(ROOT, 'data', 'news-block.html'), newsHtml, 'utf8');
    console.warn('index.html not found yet — wrote data/news-block.html');
  }
}

main();
