#!/usr/bin/env node
/**
 * Clone/pull ChristianHohlfeld/aktuell.digitalisierungsplanung.de and
 * write data/news.json + regenerate the news block in index.html.
 *
 * Hub taxonomy for immobiliekonstanz.de (Makler / Wohnungswirtschaft landing):
 *   Makler, Wohnungswirtschaft, Energie, Regulierung, Finanzen
 * EXCLUDE: KI, Prozesse, Automatisierung.
 *
 * Soft filters:
 *   - Finanzen only when immobilien/makler/wohnung-relevant
 *   - Spain/Andalucía/etc. only when clearly Makler / Immobilienvermittlung /
 *     Regulierung für Makler
 *   - Drop pure tech/AI stories
 *
 * SEO / no-duplicate rule:
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

/** Categories shown on this Makler landing (order on the page). */
const CATEGORY_ORDER = [
  'Makler',
  'Wohnungswirtschaft',
  'Energie',
  'Regulierung',
  'Finanzen'
];
const KEEP = new Set(CATEGORY_ORDER);
/** Explicitly out of scope for this hub. */
const EXCLUDE = new Set(['KI', 'Prozesse', 'Automatisierung']);
const LIMIT_PER_CATEGORY = Number(process.env.NEWS_LIMIT_PER_CATEGORY || 8);
const TEASER_MAX = 160;

const SECTION_LEADS = {
  Makler: 'Markt, Vermittlung und Rahmen für Immobilienmakler — Beiträge öffnen auf der Quellseite.',
  Wohnungswirtschaft: 'Wohnungswirtschaft und Bestand — Meldungen mit Link zur Quellseite.',
  Energie: 'Energie und Gebäude — Kurzüberblick mit Link zu Digitalisierungsplanung Aktuell.',
  Regulierung: 'Regeln und Aufsicht mit Bezug zu Immobilien und Vermittlung — Details auf der Quellseite.',
  Finanzen: 'Finanzierung und Rahmenbedingungen mit Immobilienbezug — Beiträge bei der Quelle.'
};

/** Immobilie / Makler / Wohnung relevance (title + slug). */
const IMMO_RE =
  /\b(immobilie|immobilien|makler|wohnung|wohnungs|wohneinheit|wohnraum|vermittlung|hypothek|miet|eigentum|grundbuch|gebäude|wohnbau|neubau|sanier|heizung|wärmepumpe|fernwärme|beg\b|kfn\b|bestand|bauleit|baugenehm|baupreis|häuserpreis|wohnimmobil|kaufvertrag|provision|kyc|geldwäsche)\b/i;

/** Pure tech / AI — drop even if category would otherwise keep. */
const PURE_TECH_AI_RE =
  /\b(ki\b|künstliche intelligenz|\bai\b|gpt|llm|copilot|openai|anthropic|nvidia|agenten?|agentic|cyber[\s-]?resilience|nis2\b|gpu|rechenzentrum|rechenzentren|hyperscaler|\baws\b|\bazure\b|cloudwatch|chatgpt|ai[\s-]?act|bondmarkt|capex|oracle|coreweave|palantir|servicenow|salesforce|cisco|ibm q|alphabet plant|meta plant|microsoft cloud|microsoft investiert|amazon:|aws wächst|data[\s-]?center|model hardware|zero data retention|gemini|bitkom|schatten[\s-]?ki|sponsored agents|managed runtime|ai[\s-]?infrastruktur|ai[\s-]?wirtschaft|ai[\s-]?economy|ai[\s-]?nachfrage|ai überschreitet|cloud[\s-]?backlog|cloud[\s-]?infrastruktur|digital[\s-]?tech[\s-]?to[\s-]?product|eudi[\s-]?wallet|d[\s-]?you startet|dma:|data act|produkthaftung erfasst software|digitaler produktpass|agentic ai hub|vida[\s-]?fahrplan)\b/i;

/** Spain / Andalucía / regional soft filter. */
const SPAIN_GEO_RE =
  /\b(spanien|spanisch|andalus|andaluc|madrid|barcelona|balearen|katalonien|mallorca|ibiza|marbella|valencia|málaga|malaga|sevilla|costa del|canaren|kanaren)\b/i;

/** Keep Spain items only when clearly Makler / Immobilienvermittlung / Makler-Regulierung. */
const SPAIN_MAKLER_RE =
  /\b(makler|immobilienvermittlung|immobilienmakler|maklerregister|maklerregel|maklerprovision|maklervertrag|vermittlung|immobilien|hypothek\w*|wohnungsk[aä]uf\w*|wohnpreis\w*|kaufnachfrage|transaktions\w*|geldw[aä]sche|kurzzeitvermiet\w*)/i;

const dropStats = {
  excludedCategory: Object.create(null),
  softSpain: 0,
  softTechAi: 0,
  softFinanzen: 0,
  kept: Object.create(null),
  matchingBeforeLimit: Object.create(null)
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
  // Automatisierung stays Automatisierung (excluded); do not map into Prozesse.
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
 */
function hubTeaser(title, category) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const suffix = ` — Quelle: ${SOURCE_LABEL}.`;
  const prefix = `${category}: „`;
  const close = '“';
  const hookBudget = TEASER_MAX - prefix.length - close.length - suffix.length;
  let hook = cleanTitle;
  if (hook.length > Math.max(40, hookBudget)) {
    hook = `${cleanTitle.slice(0, Math.max(40, hookBudget) - 1).trim()}…`;
  }
  let teaser = `${prefix}${hook}${close}${suffix}`;
  if (teaser.length > TEASER_MAX) {
    teaser = teaser.slice(0, TEASER_MAX - 1).trim() + '…';
  }
  return teaser;
}

/**
 * Soft-filter: return drop reason string, or null if article should be kept.
 */
function softDropReason(title, slug, category) {
  const text = `${title} ${slug}`;

  if (category === 'Finanzen' && !IMMO_RE.test(text)) {
    return 'finanzen-not-immo';
  }

  if (SPAIN_GEO_RE.test(text) && !SPAIN_MAKLER_RE.test(text)) {
    return 'spain-not-makler';
  }

  // Pure tech/AI: always drop on this landing (Makler-Schiene).
  if (PURE_TECH_AI_RE.test(text)) {
    // Exception: Makler-category pieces that mention KI only in passing with clear Makler focus
    // are still rare; keep rule strict — drop tech/AI product & infra stories.
    return 'pure-tech-ai';
  }

  return null;
}

function loadArticles() {
  const contentDir = join(SOURCE_DIR, 'content');
  const files = readdirSync(contentDir).filter((f) => f.endsWith('.md'));
  const articles = [];
  let scanned = 0;

  for (const file of files) {
    const raw = readFileSync(join(contentDir, file), 'utf8');
    const meta = parseFrontmatter(raw);
    if (!meta) continue;
    scanned += 1;
    const category = canonicalCategory(meta.category || '');

    if (EXCLUDE.has(category) || !KEEP.has(category)) {
      const key = category || '(empty)';
      dropStats.excludedCategory[key] = (dropStats.excludedCategory[key] || 0) + 1;
      continue;
    }

    const slug = meta.slug || file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const date = meta.published || meta.updated || meta.date || '';
    const title = meta.title || slug;

    const soft = softDropReason(title, slug, category);
    if (soft === 'spain-not-makler') {
      dropStats.softSpain += 1;
      continue;
    }
    if (soft === 'pure-tech-ai') {
      dropStats.softTechAi += 1;
      continue;
    }
    if (soft === 'finanzen-not-immo') {
      dropStats.softFinanzen += 1;
      continue;
    }

    dropStats.matchingBeforeLimit[category] =
      (dropStats.matchingBeforeLimit[category] || 0) + 1;

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
  console.log(`Scanned ${scanned} articles with frontmatter`);
  return articles;
}

function groupByCategory(articles) {
  const by = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, []]));
  for (const a of articles) {
    if (!by[a.category]) by[a.category] = [];
    if (by[a.category].length < LIMIT_PER_CATEGORY) {
      by[a.category].push(a);
      dropStats.kept[a.category] = (dropStats.kept[a.category] || 0) + 1;
    }
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
  // Skip empty categories on the page (less clutter); still listed in news.json.
  const parts = CATEGORY_ORDER
    .filter((c) => (byCategory[c] || []).length > 0)
    .map((c) => renderSection(c, byCategory[c] || []));
  const shown = CATEGORY_ORDER.filter((c) => (byCategory[c] || []).length > 0);
  const catList = (shown.length ? shown : CATEGORY_ORDER).join(', ');
  return `<!-- NEWS:START -->
<!-- generated: ${esc(generatedAt)} -->
${parts.join('\n')}
<p class="note">Branchenmeldungen von <a href="${esc(SOURCE_HOME)}" rel="noopener noreferrer">${esc(SOURCE_LABEL)}</a> — Kategorien: ${esc(catList)}. Artikel öffnen auf der Quellseite.</p>
<!-- NEWS:END -->`;
}

function writeNewsJson(articles, byCategory, generatedAt) {
  const counts = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, (byCategory[c] || []).length])
  );
  const totalMatching = articles.length;
  const droppedCategoryTotal = Object.values(dropStats.excludedCategory).reduce(
    (n, v) => n + v,
    0
  );
  const softDropped =
    dropStats.softSpain + dropStats.softTechAi + dropStats.softFinanzen;
  const payload = {
    generatedAt,
    source: SOURCE_REPO,
    sourceLabel: SOURCE_LABEL,
    sourceHome: SOURCE_HOME,
    articleBase: ARTICLE_BASE,
    categories: CATEGORY_ORDER,
    counts,
    countsMatchingBeforeLimit: { ...dropStats.matchingBeforeLimit },
    dropped: {
      byExcludedCategory: { ...dropStats.excludedCategory },
      excludedCategoryTotal: droppedCategoryTotal,
      softSpainNotMakler: dropStats.softSpain,
      softPureTechAi: dropStats.softTechAi,
      softFinanzenNotImmo: dropStats.softFinanzen,
      softTotal: softDropped
    },
    totalMatching,
    limitPerCategory: LIMIT_PER_CATEGORY,
    articles: CATEGORY_ORDER.flatMap((c) => byCategory[c] || [])
  };
  const outDir = join(ROOT, 'data');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, 'news.json');
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${path} (${totalMatching} matching, showing ${payload.articles.length})`);
  console.log('Counts (shown):', counts);
  console.log('Matching before limit:', dropStats.matchingBeforeLimit);
  console.log('Dropped by excluded category:', dropStats.excludedCategory);
  console.log(
    `Soft-dropped: spain=${dropStats.softSpain}, tech/AI=${dropStats.softTechAi}, finanzen=${dropStats.softFinanzen}`
  );
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
