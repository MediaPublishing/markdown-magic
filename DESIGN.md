# Markdown Magic design contract, 0.2

Scene: a writer uses a Mac in changing daylight, moving between notes and articles. Follow system appearance by default, with equally readable light and dark modes.

Restrained neutrals, one blue action accent, native system interface typography and a readable document line length of 65–75 characters. Use existing Lucide icons. No decorative gradients, cards around ordinary content, oversized branding inside the editor, or colored side stripes. The website shows real application screenshots as its main visual proof.

## Composition

- Sidebar roughly 230px: New document, Recent, Drafts, Favorites, Places; settings at the bottom.
- One document title/status bar. Title actions expose save/name, move, duplicate, reveal, history and export.
- Compact visible formatting; rare actions disclosed. No permanent ungrouped group bar. Tabs appear for multiple open documents; groups remain optional.
- Main surface is the document, with a clear writing cursor. A blank session offers New document and Open document plus recent work.
- A single optional assistant entry. Preview clearly labelled as preview; preserve document zoom and page view.
- Search in document uses Cmd+F, next match Cmd+G, with replace. Outline and document word count are unobtrusive.

## States and accessibility

Cover empty, typing, saving, saved draft, saved file, missing file, failed save, conflict, recovery, native save cancellation, and restored session. Persist important errors until resolved. Preserve focus and keyboard access; label actual editable surfaces, dialog actions and icon controls. Respect reduced motion.

App evidence: 1360×900 and 900×700, light/dark, empty, draft and populated document. Website evidence: desktop and narrow phone, both languages, actual screenshots and working download link. The public website is a quieter explanation of the same writing-first product, not a second design system.
