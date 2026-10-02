# immobiliekonstanz.de

Öffentliche GitHub-Pages-Landing für die Domain **immobiliekonstanz.de**.

- Verweist klar auf den Makler **[Immobilien Eichmann](https://immobilieneichmann.de/)**
- Aggregiert Branchennews als Link-Index (KI, Prozesse, Wohnungswirtschaft, Makler, Energie, Finanzen, Regulierung) aus dem privaten Repo `ChristianHohlfeld/aktuell.digitalisierungsplanung.de` — nur Titel/Teaser/Link, Volltext bleibt bei DigiPlan
- Artikel-Links: `https://aktuell.digitalisierungsplanung.de/artikel/<slug>/`

## Lokal News aktualisieren

```bash
node scripts/aggregate-news.mjs
```

Voraussetzung: `gh` ist angemeldet und darf das private News-Repo klonen.

## GitHub Actions

Workflow `.github/workflows/aggregate-news.yml` läuft täglich (~06:00 Europe/Berlin) und per `workflow_dispatch`, schreibt `data/news.json` und aktualisiert den News-Block in `index.html`.

Secret **`NEWS_SOURCE_TOKEN`**: Personal Access Token (classic `repo` oder fine-grained: Contents read auf `aktuell.digitalisierungsplanung.de`), damit der Job das private Quellrepo klonen kann.

## GitHub Pages

Publishing: Branch `main`, Ordner `/` (Root). Custom Domain: `immobiliekonstanz.de` (Datei `CNAME`).

## DNS (Domain Factory — manuell)

Siehe Issue/Report der Einrichtung; Apex-A/AAAA auf GitHub Pages, `www` als CNAME auf `christianhohlfeld.github.io`.

## SEO / Search Console (manuell durch Chris)

Crawl- / Discovery-Dateien live:

- `https://immobiliekonstanz.de/robots.txt`
- `https://immobiliekonstanz.de/sitemap.xml`
- `https://immobiliekonstanz.de/llms.txt` (Zweck, Eichmann-Link, DigiPlan-News-Hub — keine Artikelkopien)
- `https://immobiliekonstanz.de/humans.txt`
- `https://immobiliekonstanz.de/.well-known/security.txt`
- Favicon / Apple-Touch: `/assets/favicon.svg`, `/assets/favicon-32.png`, `/assets/apple-touch-icon.png`

### Google Search Console

1. [Google Search Console](https://search.google.com/search-console) öffnen → **Property hinzufügen**.
2. **Domain-Property** `immobiliekonstanz.de` wählen (empfohlen; deckt http/https und www ab).
3. DNS-TXT-Verifizierung bei Domain Factory setzen (Token aus der GSC-Oberfläche).
4. Nach Verifizierung: **Sitemaps** → `https://immobiliekonstanz.de/sitemap.xml` einreichen.
5. Optional: URL-Prüfung für `https://immobiliekonstanz.de/` → Indexierung beantragen.

### Bing Webmaster Tools

1. [Bing Webmaster Tools](https://www.bing.com/webmasters) → Site hinzufügen.
2. Domain verifizieren (DNS oder Import aus Google Search Console).
3. Sitemap `https://immobiliekonstanz.de/sitemap.xml` einreichen.

Hinweis: Diese Landing verweist faktisch auf das Maklerbüro **Immobilien Eichmann** (Partner) mit schema.org **RealEstateAgent** + **LocalBusiness** (NAP aus dem Impressum) sowie WebSite/WebPage/BreadcrumbList. Der dofollow-Backlink mit Ankertext „Immobilienmakler Konstanz – Eichmann Immobilien“ zeigt auf `https://immobilieneichmann.de/`. Branchennews sind ein Link-Hub zu Digitalisierungsplanung Aktuell (keine Textübernahme).
