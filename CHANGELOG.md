# Changelog

All notable changes to this project are tracked here following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No changes yet._

## [0.2.1] - 2026-05-20
### Added
- Custom right-click context menu on text inputs and textareas with Cut,
  Copy, Paste, Delete, and Select All. Replaces the browser's default
  context menu so the app feels consistently desktop-native.

### Changed
- External links (GitHub source, releases, etc.) now open in the system
  browser via the Tauri opener plugin. Previously they silently did nothing
  inside the locked-down webview.
- GitHub Actions release workflow now uses `actions/checkout@v5` and
  `actions/setup-node@v5` (Node.js 24 runtime), clearing the Node.js 20
  deprecation warnings GitHub started emitting.

### Documentation
- `docs/RELEASING.md` now documents the mandatory
  `bundle.createUpdaterArtifacts: true` flag, the PR-required release flow
  under branch protection, and a troubleshooting section for missing
  updater artifacts.

## [0.2.0] - 2026-05-20
### Added
- GitHub Actions release workflow that builds Windows, Linux, and macOS
  installers on every `v*` tag and publishes them as a draft release with
  signed update artifacts.
- In-app auto-updater: silent check on startup that prompts when a newer
  release is available, plus a manual "Check for updates" button and a
  "Latest release on GitHub" download link on the About page.
- `npm run release -- X.Y.Z` bump script that syncs the version across
  `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/Cargo.lock`, and reshapes `CHANGELOG.md` into a dated section.
- `docs/RELEASING.md` maintainer runbook covering one-time keypair setup,
  CI secrets, the release loop, pre-releases, and failure recovery.

## [0.1.0] - 2025-02-05

### Added
- Initial public release of Inowio Modbus Toolbox
- Modbus TCP/RTU connection management with persistent workspaces
- Device registry, analyzer, traffic monitor, and logging system
- Cross-platform bundles plus documentation and help content
