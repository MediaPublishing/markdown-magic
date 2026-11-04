# Release QA: Markdown Magic 0.4.3

Apple submission `98f25e49-bbec-4eec-910d-030b3b093659` is Accepted. The final signed DMG is the submitted outer container, preserved without rebuilding. Apple tickets were successfully stapled to and validated on both the DMG and the local app bundle. Both pass Gatekeeper as `Notarized Developer ID`; the app passes strict nested codesign verification.

The unchanged application code previously passed typecheck, 94 unit tests and ten packaged-app review workflows. The mounted DMG contains the same verified signed app with app.asar SHA-256 `2e4b4a11f0c46d3f4af3c270110ab28aaa056918264961e83fce7ed57d60aa3e`. Stapling does not alter that code archive. Raw proof is under ignored `receipts/`.

Final stapled DMG SHA-256: `bcef93d4e900eca709117e41a05a0d430148ae782fe9ad9cbf34b80896304c5c`. Release assets are the DMG and `SHA256SUMS-0.4.3.txt`; the pre-stapling blockmap/update metadata and unsubmitted ZIP are not published.

Both static website languages and README are updated from the prepared staging copy. Changes are version/download links, Apple signing/notarization wording and standard first-launch instructions; the approved product headline and screenshots are retained.

The pre-existing Vite manifest edits are preserved and excluded. The final package retains the documented build-only 0.4.3 version override. Existing PR remains unmerged. Delivery readback follows below.

## Completed delivery

- Release v0.4.3 is public as a beta with the final stapled DMG and checksum. GitHub's asset digest and an actual public download match the final SHA-256 above. Source commit: `a7cc92db0c09e7f22122b1df6d84ba09005ad125`.
- Cloudflare production deployment `ddd19e4a` is live. German and English pages, app.js and favicon return HTTP 200 and match committed files byte for byte. Existing Pages authorization was renewed with the same scopes. Raw receipt: `receipts/live-website-0.4.3.json`.
- Installed 0.4.3 passes ticket validation, strict codesign and Gatekeeper as Notarized Developer ID. App and distributed DMG tickets validate. Raw receipt: `receipts/apple-verification-0.4.3.json`.
- Verified backup: `/Users/MediaPublishing/AI/backups/markdown-magic-0.4.3-install-20261104T014717Z/`, with 546 app and 622 profile entries. Previous bundle moved to Trash. The initial relaunch produced an empty tab list; after normal quitting through the native menu, saved workspace metadata was restored from the verified backup. Final relaunch retained both original tabs, the original active tab and byte-identical document files. Raw receipt: `receipts/installation-0.4.3.json`.
- Unrelated manifest edits retain their original hashes and remain uncommitted. Only owned release files are committed and pushed.
