# Apple Developer distribution

Requested by Reto on 2026-11-02: sign Markdown Magic with the existing Apple Developer account, notarize it, and publish the verified download. Direct distribution through GitHub and the existing website remains the delivery channel; this request does not create an App Store listing.

## Current state

- Installed and published version: 0.4.2, ad hoc signed. Its public DMG SHA-256 still matches `6b69638e847cc0719750cc3937f8e530efabe797d3a4d9e126b5159463ed7c84`.
- On resuming, the existing Apple session is signed in to Reto Stuber Global Headquarters LLC, team `F7ZC4PZ39V`. The portal lists a Developer ID Application certificate expiring 2027-12-02. The local keychain now has its matching valid identity, fingerprint `2CC5079EEA6E4197326C7564E07C41EDFACFB53E`. No new certificate or permission was created by this release task.
- Apple command-line tools and `notarytool` 1.1.4 are available. A full Xcode installation is not required for the existing Electron packaging workflow.
- Reto configured the Keychain profile **`Markdown Magic`** and explicitly authorized notarization, publication, installation and website deployment. `notarytool history` succeeds when given the required system access. A sandboxed lookup cannot see the profile; this is an access limitation, not missing or invalid credentials. No password or private key was read, printed or exported.
- Build and typecheck pass; all 94 unit tests pass. A separate 0.4.3 candidate is signed in `release/apple-0.4.3/`. The first sandboxed signing attempt could not obtain a timestamp; a separate probe showed the certificate and Apple's RFC3161 server were valid. The approved signing invocation with the required system access succeeded. The full app passes `codesign --verify --deep --strict`, reporting Developer ID, team `F7ZC4PZ39V`, hardened runtime and Apple's timestamp (2026-11-02 19:50:53 UTC). The installed bundle and existing download were not replaced.
- All ten review workflows pass against the signed 0.4.3 executable in isolated temporary profiles (34.2 seconds). They cover the paragraph chatbot, complete formatted-paragraph replacement/Undo, proposal persistence, local provider disconnection, conversation relocation, provider selection, named versions and passage comments. The initial sandboxed test launch was blocked; the authorized app-test invocation with the required system access passed. Raw logs: ignored `receipts/build-apple-0.4.3.log`, `receipts/unit-apple-0.4.3.log`, `receipts/package-apple-0.4.3.log`, `receipts/codesign-apple-0.4.3.log`, and `receipts/review-apple-0.4.3.log`.
- The signed final DMG has been submitted to Apple: request **`98f25e49-bbec-4eec-910d-030b3b093659`**, received **2026-11-02 20:04:16 UTC**. Latest observed status is **In Progress**. No replacement release has been published; installation and website deployment wait for Accepted, stapling and Gatekeeper verification.

### Candidate for notarization

- ZIP: `release/apple-0.4.3/Markdown-Magic-0.4.3-notarization.zip`, created from the verified signed app with `ditto --sequesterRsrc --keepParent`.
- ZIP SHA-256: `1ea9d529a2ba63440b04ed9db76d6096ab0ce377b5e9a8554555c908aafaff43`.
- Packaged app.asar SHA-256: `2e4b4a11f0c46d3f4af3c270110ab28aaa056918264961e83fce7ed57d60aa3e`.
- Candidate packaging explicitly used `mac.notarize=false` while credentials were absent. The archive has not been submitted separately.
- The DMG containing that same verified signed app was subsequently signed with the same Developer ID and secure timestamp. Its pre-stapling SHA-256 is `bcdf13d481bf9f87be00c67ab7fa1f67892a0124bfdd69d0d00218c46d145ca9`.
- Following [Apple's outermost-container distribution workflow](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution), submit the signed DMG once. Apple's service issues tickets for both the DMG and the enclosed app. Require Accepted, staple/validate the DMG, and staple/validate the separate app for local installation. Do not rebuild or re-sign the DMG after acceptance; compute the public checksum after stapling.
- Raw submission/status receipts: ignored `receipts/notary-submit-0.4.3.json`, `receipts/notary-info-0.4.3.json`. A 45-second bounded wait timed out while Apple continued processing; this is not a rejection. Continue querying the same request; do not resubmit.
- Both website languages are prepared in ignored `site-preview/apple-0.4.3/site`, with verified 0.4.3 download links and signed/notarized installation wording. They are not deployed yet. Cloudflare's existing Pages Write authorization works; no new scopes are needed.
- The corresponding README is prepared as `site-preview/apple-0.4.3/README.md`; the tracked README still correctly describes the current public 0.4.2 download.
- A GitHub prerelease draft for `v0.4.3` exists and is explicitly marked pending Apple's approval. It has no public download asset yet. Its notes are in ignored `receipts/release-notes-0.4.3.md`; update the notes and source target immediately before publishing.
- The signed DMG was mounted read-only, its integrity and nested app signature verified, and its version and app.asar hash matched the signed executable used in all ten passing review workflows. It was detached after verification. Receipt: ignored `receipts/dmg-payload-0.4.3.json`.
- Rollback app backup is verified under `/Users/MediaPublishing/AI/backups/markdown-magic-0.4.3-2026-11-02/previous.app` (546 matching entries). Back up the current profile again after a normal app quit immediately before installation.

## Release procedure

1. Read the existing account, team and membership. Reuse an existing Developer ID Application identity with its matching private key if available. Downloading a public certificate alone does not supply the private key. Do not revoke any existing certificate. Any necessary credential creation or legally binding agreement follows the applicable confirmation/handoff rules.
2. Use a dedicated notarization Keychain profile with the existing account. Keep passwords and private keys out of chat, logs, shell arguments and Git. Prefer an already provisioned profile. Personal MFA and entry/creation of a new authentication credential remain with Reto.
3. Build a separately versioned signed candidate, 0.4.3, without replacing the existing release assets. Preserve the two pre-existing Vite edits in package.json and package-lock.json; continue using a build-only version override until that work is separately resolved.

The existing builder 26.15.3 supports the required signing and notarization. The signed invocation overrides the beta's deliberate `mac.identity: null` and disabled certificate discovery:

```sh
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=true npx electron-builder \
  --mac dmg --arm64 \
  --config.extraMetadata.version=0.4.3 \
  --config.directories.output=release/apple-0.4.3 \
  --config.mac.identity="$MARKDOWN_MAGIC_CERTIFICATE_NAME" \
  --config.mac.hardenedRuntime=true \
  --config.mac.notarize=true \
  --config.forceCodeSigning=true
```

`MARKDOWN_MAGIC_CERTIFICATE_NAME` is the exact intended certificate qualifier without the `Developer ID Application:` prefix, as required by this builder version. Set `APPLE_KEYCHAIN_PROFILE` to the verified profile name before building. Certificate and profile names are metadata, not secret values. Verify both prerequisites before invoking the builder: this installed version can skip notarization when credentials are absent even if `notarize` is true.

The existing afterPack hook cleans unused permissions and applies a temporary ad hoc signature. It runs **before** the builder's final Developer ID signing stage, so it must not be moved after final signing or rerun on a signed candidate.

## Required delivery evidence

- Final app and nested binaries pass strict codesign verification; the signature reports Developer ID Application, the intended TeamIdentifier, hardened runtime and a secure timestamp.
- Apple's notarization status is Accepted, the app ticket is stapled and validates, and Gatekeeper reports `accepted` with `source=Notarized Developer ID`.
- Submit the final signed DMG to notarytool if needed and staple its ticket too; validate the actual distributed DMG. Compute checksums only after all signing and stapling.
- Run the existing packaged-app smoke/review workflows against the actual signed executable in an isolated profile. Signing must preserve assistant CLIs, passage context, file editing and saved suggestions.
- Publish a new versioned GitHub release, verify its downloaded bytes, then update both website languages and remove the ad hoc/not-notarized wording only after the signed release passes. Keep 0.4.2 as the rollback release.
- Back up the installed bundle/profile, install the verified signed app, and verify the installed signature and preserved document data. No forced termination of active editing.

References: [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/), [electron-builder v26 notarization](https://www.electron.build/v26/docs/notarization/).

## Resume this exact submission

1. Query `xcrun notarytool info 98f25e49-bbec-4eec-910d-030b3b093659 --keychain-profile 'Markdown Magic' --output-format json` with the required system access. A sandboxed keychain lookup will misleadingly report the profile absent. Do not recreate credentials or submit again.
2. If Invalid, fetch this request's log and fix the actual reported issue before a separately versioned resubmission. If In Progress, Apple's result is the remaining external dependency; no additional user login is needed.
3. Only after Accepted: staple and validate `release/apple-0.4.3/Markdown-Magic-0.4.3-arm64.dmg` and `release/apple-0.4.3/mac-arm64/Markdown Magic.app`; verify codesign and Gatekeeper. Save Apple's log/status and final checksum. Do not rebuild the accepted DMG.
4. Activate the prepared site/README, add final release notes and QA evidence, commit/push only owned paths. The unrelated package.json/package-lock.json Vite edits retain their original hashes and must stay excluded.
5. Publish the existing release draft with the final DMG/checksum and verified final source target. Download and compare its bytes, then deploy only `site/` to the existing Cloudflare Pages project using `/opt/homebrew/bin/wrangler`. Read back German/English, download links, favicon and release wording.
6. Normally quit the installed app, preserving unsaved work; back up and verify its current profile in the prepared backup directory. Move the old bundle to Trash, install the stapled signed app, verify version/signature/ticket/app.asar and preserved document data, then reopen it through the supported native UI. Do not terminate user editing forcibly.
