# Markdown Magic

**Deutsch** | [English](#english)

Markdown Magic ist ein visueller, lokaler Markdown- und Texteditor für macOS. Dateien bleiben im gewählten Ordner, während Tabs, Gruppen, Seitenansicht und dokumentbezogener Zoom die tägliche Arbeit übersichtlich halten.

[Website](https://markdown-magic.pages.dev) · [Direkter Download für macOS](https://github.com/MediaPublishing/markdown-magic/releases/download/v0.1.4/Markdown-Magic-0.1.4-arm64.dmg) · [Releases](https://github.com/MediaPublishing/markdown-magic/releases)

![Markdown Magic im hellen Modus](docs/screenshots/workspace-light.png)

## Funktionen

- Visuelles Bearbeiten ohne permanente Quelltext-/Vorschau-Teilung
- Lokale Ordner und Dateien als verlässliche Datenquelle
- Tabs und kompakte Gruppen für mehrere Dokumente
- Fortlaufende Ansicht oder Seitenansicht mit bis zu drei Spalten
- Dokumentzoom ohne Skalierung der gesamten Oberfläche
- Deutsch, Englisch, Light Mode, Dark Mode und Systemdarstellung
- Versionshistorie und verständliche Konfliktbehandlung
- Optionaler Assistent mit fortlaufendem Chat und prüfbaren Vorschlägen
- Markdown, Klartext, Daten-, Konfigurations- und verbreitete Codedateien

![Markdown Magic in der Seitenansicht](docs/screenshots/pages-light.png)

## Installation

1. [DMG herunterladen](https://github.com/MediaPublishing/markdown-magic/releases/download/v0.1.4/Markdown-Magic-0.1.4-arm64.dmg).
2. `Markdown Magic.app` in den Ordner `Programme` ziehen.
3. Die App beim ersten Start mit Rechtsklick und `Öffnen` bestätigen, falls macOS sie blockiert.

Der aktuelle Beta-Build ist für Apple Silicon und macOS 13 oder neuer gedacht. Er ist lokal signiert, aber noch nicht von Apple notarisiert. Vor einer breiten öffentlichen Nutzung sollte deshalb ein notarisiertes Release folgen.

## Entwicklung

```sh
npm install
npm run dev
```

Qualitätsprüfung und Paketierung:

```sh
npm run quality
npm run package:mac
```

Markdown Magic speichert Dokumente direkt im lokalen Dateisystem. Es gibt keine Telemetrie und kein proprietäres Dokumentformat. Der optionale Assistent überträgt Dokumentinhalt erst nach einer bewussten Anfrage.

---

## English

Markdown Magic is a visual, local Markdown and text editor for macOS. Files stay in the folder you choose, while tabs, groups, page view, and document zoom keep everyday writing organized.

[Website](https://markdown-magic.pages.dev/en/) · [Direct macOS download](https://github.com/MediaPublishing/markdown-magic/releases/download/v0.1.4/Markdown-Magic-0.1.4-arm64.dmg) · [Releases](https://github.com/MediaPublishing/markdown-magic/releases)

![Markdown Magic in dark focus mode](docs/screenshots/focus-dark.png)

## Features

- Visual editing without a permanent source/preview split
- Local folders and files remain the source of truth
- Tabs and compact groups for multiple documents
- Continuous view or page view with up to three columns
- Document zoom without scaling the whole interface
- German, English, light, dark, and system appearance
- Version history and understandable conflict handling
- Optional assistant with continuous chat and reviewable suggestions
- Markdown, plain text, data, configuration, and common code files

## Install

1. [Download the DMG](https://github.com/MediaPublishing/markdown-magic/releases/download/v0.1.4/Markdown-Magic-0.1.4-arm64.dmg).
2. Drag `Markdown Magic.app` to `Applications`.
3. On first launch, Control-click the app and choose `Open` if macOS blocks it.

The current beta build targets Apple Silicon and macOS 13 or later. It is locally signed but not yet notarized by Apple. A notarized release should follow before broad public use.

## Privacy

Markdown Magic writes documents directly to the local file system. It has no telemetry and no proprietary document format. The optional assistant only transfers document content after an explicit request.

## License

No open-source license has been granted yet. The source is publicly available for inspection; all rights remain reserved.
