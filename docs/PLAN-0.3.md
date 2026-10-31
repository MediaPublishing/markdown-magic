# Markdown Magic 0.3: Fassungen und Lektorat

Auftrag 2026-10-31: In dieser Reihenfolge umsetzen, testen, committen, deployen, installierte App und Website aktualisieren. Eigene Implementierung; kein MAID-Code oder neue Provider.

## Vertrag und Abnahme

- AC-1: Benannte Fassungen aus aktuellem Editorinhalt anlegen, nach Neustart und mehr als 50 Autosaves verfügbar; mehrere getrennte Änderungen verständlich vergleichen. Bestehende Historie lesbar; Wiederherstellung erhält Rückweg und Konfliktschutz.
- AC-2: Auswahl im visuellen und Quelltexteditor (auch Frontmatter, Umlaute, Emoji, Formatierungen und doppelte Textstellen) explizit im Assistenten besprechen. Kleine Vorschläge ändern nur ihren Zielbereich, veraltete/mehrdeutige Ziele werden abgelehnt; unabhängige Änderungen erhalten.
- AC-3: Lokale Kommentare und Gespräche über Neustarts erhalten; Kommentare ohne Online-Anfrage anlegen, anzeigen, erledigen und wiederöffnen. Anker folgen Textänderungen oder zeigen eindeutig fehlenden Bezug. Bewegen/Benennen erhält Gespräche, Kopien übernehmen keine Gespräche automatisch.
- AC-4: Ein ruhiges optionales Seitenpanel, lesbare helle/dunkle Darstellung, Tastaturzugang, 900×700 und 1360×900 ohne abgeschnittene Hauptaktionen. Deutsche/englische Beschriftungen.
- AC-5: Volle vorhandene Quality-Suite, neue gezielte Verhaltenstests und Paket-QA grün. Frischer Prover prüft Laufzeit, anschließend frischer Checker gegen AC-1–5. Keine qualitativen Erfolgsaussagen nur aus Build.
- AC-6: GitHub Commit/Push/Release, Website mit neuen Funktionsbeschreibungen und echten Demo-Screenshots, Desktop/Mobile-QA und Live-Readback; installierte App mit Profil-/App-Backup, Versions-/Signatur-/Startprüfung.

Nicht enthalten: neuer AI-Anbieter, Stackwechsel, dauerhafte vier Spalten, neue Cloud-Speicherung, automatische Dateizuordnung, Übernahme fremden Quellcodes.

## Ablauf

1. History erweitern, Versionsvergleich und Oberfläche.
2. Auswahlbezug und kleine geprüfte Ersetzungen im vorhandenen Assistenten.
3. Dauerhafte lokale Gesprächs-/Kommentarspeicherung und Anker-Nachführung.
4. Bestehende UI verfeinern, Verhaltenstests, Prover/Checker (maximal drei gezielte Reparaturrunden).
5. Release 0.3.0, Website/App aktualisieren, Rücklesen.

Schreibumfang: Projektdateien in diesem Repository; Paket-/Profilbackup unter AI/backups; installierte App nach erfolgreicher QA mit nötiger technischer Freigabe. Bestehende Daten nicht löschen. Laufende Nutzerdateien nicht für Tests verwenden. Belege unter receipts (ignoriert), Abschluss in docs/QA-0.3.md. Stehen technische Grenzen entgegen, andere Arbeit fortsetzen und konkret belegen.
