# MAID: Was Markdown Magic übernehmen sollte

Stand: 2026-10-31. Analyseauftrag, keine Änderung an der App-Laufzeit.

## Empfehlung

MAIDs wertvoller Beitrag ist ein Lektorat an einer konkreten Textstelle. Diesen Ablauf an unseren visuellen Editor anpassen und die bestehende Dokumenthistorie verständlicher machen. Electron, Milkdown, lokale Entwürfe, Finder-Dateien und den vorhandenen Assistenten beibehalten.

## Quelle und Prüfung

- Quelle: [ralfw-vibe-coding/MAID-Markdown-Editor](https://github.com/ralfw-vibe-coding/MAID-Markdown-Editor), Autor/Owner ralfw-vibe-coding.
- Geprüfter Commit: `3180b8fc2b12e09db6079b3af3353ae51f504ffa` vom 2026-10-31. Manuell aktualisieren, keine automatische Übernahme.
- Statisch gelesen: README, package.json, Renderer/Quellzuordnung, Anker und zugehörige Tests, Änderungsplanung, Lektor-Prompt, Versionierung, Sidecar-Speicherung, AI-Prozess, Bildspeicherung und Installationsskripte.
- Keine LICENSE-/COPYING-Datei im abgefragten vollständigen Dateibaum; package.json enthält keine Lizenzangabe. Deshalb keine Quellcodeübernahme vorgesehen. Konzepte unabhängig im bestehenden Code umsetzen.
- Keine Installation, Ausführung oder Tests von MAID. Vorhandene Tests wurden als Code gelesen, ihr Bestehen wurde nicht verifiziert. Keine Upstream-Hooks, Prompts oder Konfigurationen aktiviert.
- `postinstall` verändert/registriert Entwicklungs-App-Bundles. `install-app` entfernt eine vorhandene MAID-App und setzt Markdown-Dateizuordnungen. Diese Mechanik nicht übernehmen oder ausführen.

## Priorisierte Adaption

### 1. Eine markierte Passage mit dem Assistenten besprechen

**Ablauf:** Im formatierten Dokument einen Absatz markieren → „Mit Assistent besprechen“ → das bestehende Seitenpanel zeigt die ausgewählte Passage und das Gespräch. Zunächst Vorschau; erst „Übernehmen“ ändert den Text. Das funktioniert auch als lokale Notiz ohne AI-Anfrage.

**Unser aktueller Stand:** `DocumentEditor` bietet keinen Zugriff auf die Textauswahl. `runAssistantProposal` übergibt den gesamten Markdown-Text. Antworten und Vorschläge sind dokumentbezogen, nicht passagenbezogen.

**Adaption:** Zuerst Auswahlbezug und gezielte Vorschläge im vorhandenen Panel ergänzen. Dauerhafte Kommentar-Threads als nächsten Schritt. Die Markierung im visuellen Editor über die ProseMirror-Transaktionen nachführen; für Quelltext eine explizite Offset-Zuordnung vorsehen. MAIDs eigenen Renderer nicht als zweiten Renderer einführen.

**Abnahme:** Zwei gleiche Sätze bleiben unterscheidbar; Fett/Links/Umlaute/Emojis korrekt; Änderungen vor der Passage verschieben ihren Bezug; entfernte oder mehrdeutige Stellen erscheinen als nicht mehr zuordenbar. Eine lokale Notiz verändert keinen Dokumenttext und löst keine Online-Anfrage aus. Eine Online-Anfrage zeigt Anbieter und Umfang des übermittelten Kontexts.

### 2. Fassungen benennen und verständlich vergleichen

**Ablauf:** „Fassung festhalten …“ → etwa „Vor der Kürzung“ eingeben. Unter „Versionen“ stehen benannte Fassungen und automatische Sicherungen mit ihrem Anlass. Beim Auswählen sieht man die tatsächlichen Änderungen, anschließend „Als Kopie öffnen“ oder „Wiederherstellen“.

**Unser aktueller Stand:** `HistoryStore` speichert bereits Snapshots vor Saves, AI-Änderungen und Wiederherstellung. Die Oberfläche `showHistory` zeigt jedoch primär Zeitstempel und eine vollständige Quelltextvorschau. Die aktive Liste ist auf 50 Einträge begrenzt; ältere Snapshots werden archiviert.

**Adaption:** Den vorhandenen Store um optionale Bezeichnung und bewusst festgehaltene Fassungen erweitern. Solche Fassungen gesondert erhalten, statt sie wie automatische Einträge aus der sichtbaren Liste zu verdrängen. Zunächst Liste und Vergleich, kein zoombarer Zeitstrahl. Für den Vergleich vorhandene Fähigkeiten erweitern: `createLineDiff` zeigt heute zwischen erster und letzter Änderung auch unveränderte Zwischenzeilen als entfernt/hinzugefügt. Für mehrere getrennte Änderungen braucht es echte getrennte Änderungsblöcke und optional Wortmarkierung.

**Abnahme:** Benannte Fassungen überleben Neustart und mehr als 50 automatische Sicherungen. Vergleich und Wiederherstellung funktionieren auch mit ungespeicherten Änderungen und externen Konflikten, ohne neuere Finder-Dateien still zu überschreiben.

### 3. Gespräche am Dokument erhalten

**Unser aktueller Stand:** `assistantMessagesByPath` ist eine Map im Renderer. Es gibt dauerhafte Undo-Informationen, aber der Gesprächsverlauf selbst wird nicht über Neustarts gespeichert.

**Adaption:** Vorhandenen Assistenten um dauerhaft lokal gespeicherte Gespräche erweitern, einschließlich des besprochenen Textausschnitts und übernommener Änderungen. Am Dokumenttitel benennen, auf Wunsch umbenennen. Neue Threads nur auf bewusste Aktion; kein automatisches Online-Benennen. Zunächst Speicherung im App-Datenordner. Ein optionaler Export mit Kommentaren/Verläufen ist später möglich.

**Warum nicht MAIDs Sidecars als Standard:** Zusätzliche Gesprächsdateien direkt neben einem Dokument können in einem geteilten Drive-Ordner unbemerkt mit synchronisiert werden. Unser derzeitiger lokaler Speicher ist die passendere Voreinstellung. Umbenennen, Bewegen und Duplizieren brauchen dabei eindeutige Regeln für die Gesprächszuordnung.

**Abnahme:** App-Neustart erhält das Gespräch; Bewegen verliert es nicht; eine Dokumentkopie übernimmt private Gespräche nur auf ausdrücklichen Wunsch. Nachrichten allein eröffnen keine neue Provider-Verbindung.

### 4. Nur den besprochenen Bereich ändern

**MAID-Idee:** Vor einer Ersetzung prüfen, ob der erwartete Originaltext an der Stelle noch vorhanden und eindeutig ist. Bei Unklarheit nicht raten.

**Unser aktueller Stand:** Das Modell liefert ein vollständiges neues Dokument. `applyAssistantProposal` verlangt, dass der gesamte aktuelle Text noch exakt der Vorschlagsbasis entspricht. Das schützt vor veralteten Änderungen, blockiert aber auch bei einer unabhängigen Änderung anderswo im Dokument.

**Adaption:** Für Passagenarbeit strukturierte, kleine Ersetzungen mit erwarteter Ausgangsfassung. Eine Änderung an anderer Stelle muss separat sichtbar und bestätigt sein. Die exakte Prüfung am Zielbereich bleibt zwingend; keine unscharfe automatische Ersetzung. Ganze-Dokument-Vorschläge für ausdrücklich angeforderte Gesamtüberarbeitungen behalten.

**Abnahme:** Änderung anderswo verhindert einen noch gültigen Passagenvorschlag nicht; Änderung innerhalb der Passage verlangt einen neuen Vorschlag; doppelte Vorkommen werden nicht blind ersetzt. Markdown-Struktur validieren, statt sich allein auf den Modell-Prompt zu verlassen.

### 5. Kleinere Verbesserungen danach

- Assistentenantworten als sicher gerendertes Markdown statt sichtbarer Markdown-Zeichen darstellen. Aktuell escaped `renderAssistant` den gesamten Antworttext und ersetzt nur Zeilenumbrüche.
- Bildgröße direkt im visuellen Editor ändern. Vorher portables Ausgabeformat und Roundtrip-Verhalten festlegen; MAIDs Obsidian-Syntax `![Alt|300](...)` nicht ungeprüft als Standard übernehmen.

## Beibehalten und nicht doppelt bauen

| MAID-Funktion | Entscheidung für Markdown Magic |
|---|---|
| Speichern und Fassungen unterscheiden | **Adapt:** vorhandene automatische Speicherung und History klarer vermitteln |
| AI-Diskussion, Vorschau, Rückweg | **Keep:** bereits vorhanden; um Passage/Thread erweitern |
| Lokale Bilder per Einfügen/Ziehen | **Keep:** bereits vorhanden, einschließlich dokumentbezogener Assets und Umzug |
| Eigene Liste zuletzt geöffneter Dateien | **Keep:** bereits vorhanden |
| Quelltext als obligatorischer Schreibbereich | **Nicht übernehmen:** visueller Editor ist unser Produktkern |
| Vier permanente Spalten | **Nicht übernehmen:** Dokument plus optional ein Seitenpanel genügt |
| React/CodeMirror/eigener Preview-Renderer | **Nicht übernehmen:** kein ausreichender Nutzen für Stackwechsel |
| Claude als zusätzlicher fester Anbieter | **Zurückstellen:** zuerst bestehenden Assistenten verbessern; neuer Anbieter ist eine eigene Entscheidung |
| Automatischer Wechsel des Markdown-Standardprogramms | **Nicht übernehmen:** Installationsaktion braucht eine bewusste Nutzerentscheidung |

## Reihenfolge

1. Verständliche benannte Fassungen und brauchbarer Vergleich: baut direkt auf vorhandener History auf, ohne neue Online-Abhängigkeit.
2. Auswahlbezogenes Besprechen und gezielte Ersetzungen im bestehenden Panel: größter täglicher Nutzen für Artikelarbeit.
3. Dauerhafte lokale Threads, danach optionale Exportfunktion.

MAID ist zum Prüfzeitpunkt ein am 2026-10-31 angelegtes Repository mit Paketversion 0.0.1. Sein Backlog nennt externe Konflikterkennung, Begrenzung des AI-Kontexts und Markdown-Normalisierung vor Ersetzungen noch als offen. Ein neues Funktionskonzept ist hier die Inspiration, kein Nachweis überlegener Alltagsstabilität. Unsere Dokumentverwaltung deshalb weiterverwenden.

## Primärquellen

- [Produktablauf / README](https://github.com/ralfw-vibe-coding/MAID-Markdown-Editor/blob/3180b8fc2b12e09db6079b3af3353ae51f504ffa/README.md)
- [Anker wiederfinden](https://github.com/ralfw-vibe-coding/MAID-Markdown-Editor/blob/3180b8fc2b12e09db6079b3af3353ae51f504ffa/src/renderer/src/anchor/reanchor.ts)
- [Gezielte Ersetzungen](https://github.com/ralfw-vibe-coding/MAID-Markdown-Editor/blob/3180b8fc2b12e09db6079b3af3353ae51f504ffa/src/renderer/src/ai/planEdit.ts)
- [Fassungen und Vergleich](https://github.com/ralfw-vibe-coding/MAID-Markdown-Editor/blob/3180b8fc2b12e09db6079b3af3353ae51f504ffa/src/renderer/src/versions/versions.ts)
- [Gesprächsspeicherung](https://github.com/ralfw-vibe-coding/MAID-Markdown-Editor/blob/3180b8fc2b12e09db6079b3af3353ae51f504ffa/src/renderer/src/doc/sidecar.ts)
- [Offene Punkte](https://github.com/ralfw-vibe-coding/MAID-Markdown-Editor/blob/3180b8fc2b12e09db6079b3af3353ae51f504ffa/requirements/Backlog.md)
