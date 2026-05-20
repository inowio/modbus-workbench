# Releasing Inowio Modbus Toolbox

This runbook is for maintainers cutting a new public release. The app ships
through GitHub Actions and ships an in-app auto-updater, so the release flow
has two halves: build/publish on CI, then auto-deliver to installed users.

If you are reading this for the first time, walk through
[One-time setup](#one-time-setup) before your first release. After that,
[Cutting a release](#cutting-a-release) is the loop you repeat.

## How releases work (1-minute overview)

1. You write changelog entries under `## [Unreleased]` while developing.
2. You run `npm run release -- X.Y.Z`. The script bumps every version field,
   moves the Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, and tells
   you what to commit and tag.
3. You commit and push the `vX.Y.Z` tag. GitHub Actions runs the
   `.github/workflows/release.yml` workflow.
4. The workflow verifies the tag matches every version field, builds on
   Windows / Linux / macOS, signs each installer with the updater key, and
   uploads everything to a **draft** GitHub release along with
   `latest.json`.
5. You review the draft release on GitHub and click **Publish**. As soon as
   it is published, every installed app (running an updater-enabled build)
   sees the new version on its next startup and prompts the user to install.

## One-time setup

You only need to do this once per repository. Subsequent releases reuse the
keypair and secrets.

### 1. Generate the Tauri updater keypair

The updater verifies download artifacts with a minisign signature. Generate
the keypair locally:

```bash
npx tauri signer generate -w ~/.tauri/modbus-toolbox-updater.key
```

Pick a strong password when prompted. The command prints a **public key** and
writes the **private key** to the file you specified.

> **Back up the private key file and password somewhere safe.** Losing them
> means every future release will be signed with a new key, which breaks
> auto-update for every existing install — those users will have to
> re-install manually.

### 2. Commit the public key

Replace the placeholder in [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json)
(the `plugins.updater.pubkey` field) with the public key the command
printed. Commit and push the change on `main` **before** cutting your first
release.

> **Don't forget `bundle.createUpdaterArtifacts: true`.** Tauri 2 defaults
> this flag to `false`, which means the bundler will skip producing `.sig`
> files and `latest.json` *regardless* of whether the signing key is set.
> Verify the flag is present in `src-tauri/tauri.conf.json` before the
> first release — without it, the workflow succeeds but the auto-updater
> has no manifest to fetch and no signatures to verify.

### 3. Set the CI secrets

The release workflow reads two secrets:

| Secret name                            | Value                                              |
| -------------------------------------- | -------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`            | Contents of the private key file from step 1.      |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`   | The password you chose for the key.                |

Using `gh`:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/modbus-toolbox-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
# (paste the password when prompted)
```

Or add them manually under **Settings → Secrets and variables → Actions**.

`GITHUB_TOKEN` is provided automatically by Actions; you do not need to add
it.

## Cutting a release

### Before you start

- [ ] You are on `main` with a clean working tree.
- [ ] `## [Unreleased]` in `CHANGELOG.md` has the entries you want to ship.
      The bump script refuses to run if this section is empty.
- [ ] CI is green on `main`.

### Cut the release through a release branch

`main` is protected — direct pushes are rejected. Every release goes through
a one-commit release branch and a PR. The tag is created **after** the PR
merges, on the canonical merge commit.

```bash
git checkout main
git pull
git checkout -b release/v0.2.0
npm run release -- 0.2.0
git add -A
git commit -m "chore(release): v0.2.0"
git push -u origin release/v0.2.0
```

The script:

- Validates `0.2.0` is valid semver and **strictly greater** than the current
  version.
- Refuses to run if the working tree is dirty, or if a `v0.2.0` tag already
  exists locally or on `origin`.
- Updates `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  and the `inowio-modbus-toolbox` entry in `src-tauri/Cargo.lock`.
- Renames `## [Unreleased]` in `CHANGELOG.md` to `## [0.2.0] - YYYY-MM-DD`
  and inserts a fresh empty `## [Unreleased]` block above it.
- Does **not** commit or tag — you do that explicitly so the commit message
  stays under your control.

Open a PR from `release/v0.2.0` → `main`, title `chore(release): v0.2.0`,
and **squash-merge** it (linear history is enforced). After the merge:

```bash
git checkout main
git pull
git tag v0.2.0
git push origin v0.2.0
```

The `git push origin v0.2.0` is what fires the release workflow — the tag
points at the squash-merge commit on `main`, which is what users will browse
on GitHub.

> **Why not just push the tag to the release branch?** Because squash-merge
> changes the commit hash. A tag created on the release branch would dangle
> at a commit that never reaches `main`. Tag the canonical commit on `main`,
> not the branch one.

### Watch the workflow

Open the Actions tab on GitHub and find the **Release** run for your tag.

- `verify-version` runs first. It fails fast if any version field disagrees
  with the tag (which should never happen if you used the bump script).
- Three platform jobs run in parallel (`windows-latest`, `ubuntu-22.04`,
  `macos-latest`). The macOS job builds a universal binary. The first run
  on each platform takes ~15 minutes; subsequent runs are cached by
  `Swatinem/rust-cache`.

When all three platforms succeed, a **draft** release appears on the
[releases page](https://github.com/inowio/modbus-toolbox/releases) with
installers, `.sig` files, and `latest.json` attached.

### Publish the draft

1. Open the draft release.
2. Skim the artifact list. For a healthy updater-enabled release you should
   see ~16 assets:
   - 6 installers — `.msi`, `*-setup.exe`, `.dmg`, `.AppImage`, `.deb`, `.rpm`
   - 5 `.sig` files — one per installer **except** the `.dmg`
   - `*_universal.app.tar.gz` and its `.sig` — the macOS update artifact
   - `latest.json` — the updater manifest
   - 2 source-code archives (auto-added by GitHub)
3. **Critical sanity check:** if `latest.json` or any `.sig` files are
   missing, do **not** publish. See [Updater artifacts didn't generate](#updater-artifacts-didnt-generate)
   below.
4. Edit the release notes if you want richer formatting than the changelog
   provides.
5. Click **Publish release**.

Within seconds, the GitHub Releases "latest" URL points to your new release.
Installed apps with the auto-updater enabled will see it on next startup.

## Recovering from a failed build

### Updater artifacts didn't generate

Symptom: draft release has installers but no `latest.json` and no `.sig`
files. The build log shows `Signature not found for the updater JSON.
Skipping upload...`.

Root cause is almost always **one** of these, in order of frequency:

1. `bundle.createUpdaterArtifacts` is `false` (or missing) in
   `src-tauri/tauri.conf.json`. This is the Tauri 2 default — must be
   explicitly set to `true`.
2. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` doesn't match the password used
   when the keypair was generated. Signing fails silently and `tauri-action`
   carries on without the `.sig` files.
3. Either signing secret is missing or malformed (line endings mangled by a
   copy-paste, etc.).

Quick local check for #2: try signing a throwaway file with the key locally:

```bash
echo test > t.txt
npx tauri signer sign -f /path/to/your.key -p "<YOUR-PASSWORD>" t.txt
```

If that produces `t.txt.sig`, your password matches the key. If it errors,
regenerate the keypair ([Updater key rotation](#updater-key-rotation)
below — but read the warning first).

After fixing the cause: delete the draft release, delete the tag locally
and on origin, re-tag `main`, and push the tag again.

```bash
git tag -d v0.2.0
git push origin --delete v0.2.0
git checkout main && git pull
git tag v0.2.0
git push origin v0.2.0
```



### One platform failed, the others succeeded

The draft release contains partial artifacts. Two options:

1. **Re-run from the Actions UI.** Open the failed job and click "Re-run
   failed jobs". The cache from successful platforms makes this fast.
2. **Re-dispatch the workflow** if the failed job needs a clean slate:

   ```
   Actions → Release → Run workflow → Tag: v0.2.0
   ```

### All platforms failed for the same reason

Delete the draft release on GitHub, fix the problem in code, bump to the
next patch version (`0.2.1`), and re-release. Do not try to re-use the same
tag — that requires force-pushing and breaks tooling assumptions downstream.

### You realised mid-release the changelog or version is wrong

If you have **not** pushed the tag yet, just amend the bump commit. If you
**have** pushed the tag, treat it as published and cut a patch release with
the fix.

## Pre-releases (RC builds)

Tags containing a hyphen ship as GitHub prereleases automatically:

```bash
npm run release -- 0.2.0-rc.1
# ... commit ...
git tag v0.2.0-rc.1
git push origin v0.2.0-rc.1
```

GitHub's `releases/latest` redirect only points to non-prerelease releases,
so the auto-updater on production installs **does not** pick up RC builds.
RC testers download the prerelease installers manually from the releases
page.

## Updater key rotation

Only rotate the updater key if you believe it is compromised. Rotating
**breaks auto-update for every existing install** — those users have to
re-install manually.

To rotate:

1. Generate a new keypair (same command as step 1 of one-time setup).
2. Update the `plugins.updater.pubkey` field in `src-tauri/tauri.conf.json`
   on `main`.
3. Replace both GitHub secrets (`TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
4. In release notes, instruct existing users to download and re-install
   manually.

## Reference: artifact map

| OS      | Installer            | Auto-update target?           |
| ------- | -------------------- | ----------------------------- |
| Windows | `*.exe` (NSIS)       | Yes — recommended for users.  |
| Windows | `*.msi`              | No — provided for IT/MDM use. |
| macOS   | `*.dmg` (universal)  | Yes.                          |
| Linux   | `*.AppImage`         | Yes.                          |
| Linux   | `*.deb`              | No — manual re-install only.  |
| Linux   | `*.rpm`              | No — manual re-install only.  |

`.sig` files alongside each installer let users verify integrity against the
updater public key out-of-band if they need to.
