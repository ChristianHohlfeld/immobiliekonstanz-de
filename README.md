# immobiliekonstanz.de

Öffentliche GitHub-Pages-Landing für die Domain **immobiliekonstanz.de**.

- Verweist klar auf den Makler **[Immobilien Eichmann](https://immobilieneichmann.de/)**
- Aggregiert Branchennews (Makler, Wohnungswirtschaft, Energie, Finanzen) aus dem privaten Repo `ChristianHohlfeld/aktuell.digitalisierungsplanung.de`
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
