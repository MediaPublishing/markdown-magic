# Markdown Magic Design

## Product intent

Markdown Magic is a local Mac workspace for writing and editing Markdown without a source/preview split. The document itself is the editable surface. Tabs make several documents available at once; colored groups turn related tabs into durable workstreams.

## Visual system

- Use native-feeling typography: system-ui at readable document sizes.
- Keep chrome quiet: neutral graphite surfaces, one restrained blue accent, and saturated group colors only as small borders and chips.
- Avoid decorative gradients and oversized cards. Panels are functional surfaces with 8 to 10 pixel radii.
- Icons come from Lucide and remain monochrome in toolbar contexts.
- Text never scales with viewport width; document width is constrained for reading comfort.

## Interaction rules

- Opening a folder loads a Finder-like tree for local Markdown and plain-text files; search falls back to a flat result list.
- A click opens a document in one stable tab. Dirty documents show a dot until saved.
- Multiple files can be selected in the navigation and turned into one tab group.
- Tabs use pointer-based drag-and-drop: edges reorder, centers group, dropping outside groups releases a tab, and group chips move as whole clusters.
- The header offers continuous editor mode, Acrobat-like page review, and persistent document zoom from 50 to 300 percent. Zoom scales the document surface only; window chrome remains stable and the canvas adapts to the available screen width.
- Groups carry a name, short description, icon, color and collapsed state.
- All workspace structure survives restart. File contents always live on disk, not inside the app database.
- Saving writes atomically and keeps the user's Markdown as the canonical format.

## Non-goals

- No mandatory cloud account and no telemetry. The optional assistant may use ChatGPT sign-in or an OpenAI-compatible API key after explicit setup.
- No proprietary document format.
- No split source/preview mode.
