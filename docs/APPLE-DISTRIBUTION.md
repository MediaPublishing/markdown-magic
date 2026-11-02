# Apple Developer distribution

Requested by Reto on 2026-11-02: sign Markdown Magic with the existing Apple Developer account, notarize it, and publish the verified download. Direct distribution through GitHub and the existing website remains the delivery channel; this request does not create an App Store listing.

## Current state

- Installed and published version: 0.4.2, ad hoc signed. Its public DMG SHA-256 still matches `6b69638e847cc0719750cc3937f8e530efabe797d3a4d9e126b5159463ed7c84`.
- On resuming, the existing Apple session is signed in to Reto Stuber Global Headquarters LLC, team `F7ZC4PZ39V`. The portal lists a Developer ID Application certificate expiring 2027-12-02. The local keychain now has its matching valid identity, fingerprint `2CC5079EEA6E4197326C7564E07C41EDFACFB53E`. No new certificate or permission was created by this release task.
- Apple command-line tools and `notarytool` 1.1.4 are available. A full Xcode installation is not required for the existing Electron packaging workflow.
- No notarization profile or credential environment is available yet. A metadata-only Security API query returned no `com.apple.gke.notary.tool` services; it did not request or return secret data. Reto has been asked to configure `markdown-magic-notary` through Apple's interactive `notarytool store-credentials` command. Terminal UI control is unavailable to the agent; no attempt is made to enter credentials through another route.
- Build and typecheck pass; all 94 unit tests pass. A separate 0.4.3 candidate is signed in `release/apple-0.4.3/`. The first sandboxed signing attempt could not obtain a timestamp; a separate probe showed the certificate and Apple's RFC3161 server were valid. The approved signing invocation with the required system access succeeded. The full app passes `codesign --verify --deep --strict`, reporting Developer ID, team `F7ZC4PZ39V`, hardened runtime and Apple's timestamp (2026-11-02 19:50:53 UTC). The installed bundle and existing download were not replaced.
- All ten review workflows pass against the signed 0.4.3 executable in isolated temporary profiles (34.2 seconds). They cover the paragraph chatbot, complete formatted-paragraph replacement/Undo, proposal persistence, local provider disconnection, conversation relocation, provider selection, named versions and passage comments. The initial sandboxed test launch was blocked; the authorized app-test invocation with the required system access passed. Raw logs: ignored `receipts/build-apple-0.4.3.log`, `receipts/unit-apple-0.4.3.log`, `receipts/package-apple-0.4.3.log`, `receipts/codesign-apple-0.4.3.log`, and `receipts/review-apple-0.4.3.log`.
- No notarization submission or replacement release has been published. The installed app and public downloads remain unchanged until notarization and package checks pass.

### Candidate for notarization

- ZIP: `release/apple-0.4.3/Markdown-Magic-0.4.3-notarization.zip`, created from the verified signed app with `ditto --sequesterRsrc --keepParent`.
- ZIP SHA-256: `1ea9d529a2ba63440b04ed9db76d6096ab0ce377b5e9a8554555c908aafaff43`.
- Packaged app.asar SHA-256: `2e4b4a11f0c46d3f4af3c270110ab28aaa056918264961e83fce7ed57d60aa3e`.
- Candidate packaging explicitly used `mac.notarize=false` because credentials were absent. It is signed, but **not notarized or ready for public distribution**. A fresh `notarytool history --keychain-profile markdown-magic-notary` returned "No Keychain password item found for profile".
- After the profile is configured, submit this ZIP to Apple, require Accepted, staple and validate the app. Recreate the DMG from that stapled app, then sign/notarize/staple and verify the actual final DMG. The initial candidate DMG is not the final download.

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
