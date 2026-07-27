# Releasing

Two-platform release: **Windows built locally**, **Linux AppImage built on GitHub Actions** (it CANNOT be built on Windows - electron-builder pulls a darwin `mksquashfs` and dies with ENOENT; no WSL distro / Docker here). Both assets go into ONE release, assembled locally with `gh`.

## Steps

1. **Bump version** in `package.json` (`"version"`).
2. **Notes:**
   - Add the new version to the TOP of `renderer/release-notes.js` (`{version, date, title?, notes:[...]}`) - drives the in-app what's-new popup + Settings viewer.
   - `docs/changelog.html`: add an entry at the top, move the `<span class="badge">latest</span>` off the previous version.
   - `docs/roadmap.html`: flip any shipped items to `<span class="tag tag-done">Shipped X.Y.Z</span>`.
   - **Update the privacy statement if necessary.** If the release changes what the app captures, stores, sends, connects to, or reads (e.g. a new screen capture, network endpoint, stored file, or on-device data source), update BOTH `docs/privacy.html` and `PRIVACY.md` - and fix any now-inaccurate claim. (e.g. 2.4.0's Net Worth screen-capture / stash-reading should have triggered this.)
3. **Commit + push** everything to `master` (CI checks out master, so the Linux build must have the release code).
4. **Windows build (local):**
   ```
   npm run dist
   ```
   → `dist/POE2-Currency-Overlay-Setup.exe`, `dist/latest.yml`, `dist/POE2-Currency-Overlay-Setup.exe.blockmap`
   - **VALIDATE THE PACKAGED BUILD BEFORE RELEASING** (the dev app running from source does NOT prove the package works - it has every file; the package only has `build.files`). Launch the packaged exe and confirm it opens with no "Cannot find module" crash:
     ```
     "dist/win-unpacked/POE2 Currency Overlay.exe"    # must open, not error-dialog
     ```
     Any new root-level `require('./x')` (json or js) added since the last release MUST be added to `build.files` in package.json, or the packaged app crashes on launch while dev works fine. (v2.4.0 shipped broken this way: `cx-catalog.json` was require'd but not in `build.files`.)
5. **Linux AppImage (CI):**
   ```
   gh workflow run build-linux.yml --repo POE2-VibeTools/poe2-currency-overlay
   gh run list  --repo POE2-VibeTools/poe2-currency-overlay --workflow build-linux.yml --limit 1   # get the run id
   gh run watch <id> --repo POE2-VibeTools/poe2-currency-overlay --exit-status
   gh run download <id> --repo POE2-VibeTools/poe2-currency-overlay -n linux-appimage -D dist/ci-linux
   ```
   → `dist/ci-linux/POE2-Currency-Overlay.AppImage`, `dist/ci-linux/latest-linux.yml` (AppImage embeds its own blockmap - no separate file).
6. **Create the release with BOTH platforms:**
   ```
   gh release create vX.Y.Z --repo POE2-VibeTools/poe2-currency-overlay \
     --title "vX.Y.Z - ..." --notes-file <notes.md> \
     dist/POE2-Currency-Overlay-Setup.exe dist/latest.yml dist/POE2-Currency-Overlay-Setup.exe.blockmap \
     dist/ci-linux/POE2-Currency-Overlay.AppImage dist/ci-linux/latest-linux.yml
   ```
7. **Verify:**
   ```
   gh release view vX.Y.Z --repo POE2-VibeTools/poe2-currency-overlay --json isDraft,isPrerelease,assets
   gh api repos/POE2-VibeTools/poe2-currency-overlay/releases/latest --jq .tag_name   # == vX.Y.Z
   ```
   Must be NOT draft, NOT prerelease, and `releases/latest` must equal the new tag - electron-updater (win `latest.yml`, linux `latest-linux.yml`) reads the latest published release.

## Gotchas

- The CI step MUST pass `--publish never` (in `.github/workflows/build-linux.yml`). On CI, electron-builder auto-detects and tries to publish, failing with "GH_TOKEN is not set". We only want the artifact; the release is assembled locally.
- AppImage `artifactName` is versionless (`POE2-Currency-Overlay.AppImage`) so `/releases/latest/download/POE2-Currency-Overlay.AppImage` is a stable link (the site's Linux button uses it). Same reason the Windows setup is `POE2-Currency-Overlay-Setup.exe` (no version).
- `npmRebuild: false`: the AppImage packages whatever `node_modules` the CI runner installed. `uiohook-napi` ships a Linux prebuild (hotkey + item-copy work under XWayland). `koffi`/`focus-native` is Win32-only and guarded off on non-Windows, so its missing Linux binary doesn't matter.
- GitHub Pages serves `/docs` on `master`, so pushing the site changes publishes them.
