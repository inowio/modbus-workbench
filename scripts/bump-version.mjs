#!/usr/bin/env node
// Bump the app version across every place it lives, validate the changelog,
// and refuse to run when the local state would conflict with a future
// `git push --tags`. The script never commits or tags — it just rewrites
// files and prints the next steps so the developer keeps full control.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const CARGO_PACKAGE_NAME = "inowio-modbus-toolbox";

export function parseSemver(version) {
  const m = SEMVER_RE.exec(version);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".") : [],
  };
}

export function compareSemver(a, b) {
  const A = parseSemver(a);
  const B = parseSemver(b);
  if (!A || !B) throw new Error(`Invalid semver: ${a} vs ${b}`);
  if (A.major !== B.major) return A.major - B.major;
  if (A.minor !== B.minor) return A.minor - B.minor;
  if (A.patch !== B.patch) return A.patch - B.patch;
  if (A.pre.length === 0 && B.pre.length === 0) return 0;
  if (A.pre.length === 0) return 1;
  if (B.pre.length === 0) return -1;
  const minLen = Math.min(A.pre.length, B.pre.length);
  for (let i = 0; i < minLen; i++) {
    const ai = A.pre[i];
    const bi = B.pre[i];
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff;
    } else if (aNum) {
      return -1;
    } else if (bNum) {
      return 1;
    } else {
      const cmp = ai < bi ? -1 : ai > bi ? 1 : 0;
      if (cmp !== 0) return cmp;
    }
  }
  return A.pre.length - B.pre.length;
}

export function validateVersionArg(newVersion, currentVersion) {
  if (!newVersion) {
    throw new Error("Missing version argument. Usage: npm run release -- 0.2.0");
  }
  if (!SEMVER_RE.test(newVersion)) {
    throw new Error(`Not a valid semver: "${newVersion}"`);
  }
  if (!SEMVER_RE.test(currentVersion)) {
    throw new Error(`Current version is not valid semver: "${currentVersion}"`);
  }
  if (compareSemver(newVersion, currentVersion) <= 0) {
    throw new Error(
      `New version ${newVersion} must be strictly greater than current ${currentVersion}`,
    );
  }
}

export function rewriteVersionInJson(content, newVersion) {
  // Match the first top-level `"version": "..."` field.
  const re = /("version"\s*:\s*")[^"]+(")/;
  if (!re.test(content)) {
    throw new Error('Could not find a top-level "version" field in JSON content.');
  }
  return content.replace(re, `$1${newVersion}$2`);
}

export function rewriteVersionInCargoToml(content, newVersion) {
  // Match the first `version = "..."` line (the [package] section's version).
  const re = /^(version\s*=\s*")[^"]+(")/m;
  if (!re.test(content)) {
    throw new Error("Could not find a version line in Cargo.toml.");
  }
  return content.replace(re, `$1${newVersion}$2`);
}

export function rewriteVersionInCargoLock(content, newVersion, packageName) {
  // Find the package's name line and update the version line that follows it.
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(name\\s*=\\s*"${escapedName}"\\s*\\r?\\nversion\\s*=\\s*")[^"]+(")`,
  );
  if (!re.test(content)) {
    throw new Error(
      `Could not find package "${packageName}" in Cargo.lock — has the crate been renamed?`,
    );
  }
  return content.replace(re, `$1${newVersion}$2`);
}

export function findUnreleasedBlock(content) {
  // Returns { startIdx, endIdx, body } describing the slice of `content`
  // between `## [Unreleased]` (exclusive) and the next `## ` heading
  // (exclusive). Returns null if no Unreleased heading is found.
  const headingRe = /^##\s*\[Unreleased\]\s*$/m;
  const m = headingRe.exec(content);
  if (!m) return null;
  const headingStart = m.index;
  const headingEnd = headingStart + m[0].length;
  const after = content.slice(headingEnd);
  const nextHeadingRe = /^##\s+/m;
  const next = nextHeadingRe.exec(after);
  const bodyEnd = next ? headingEnd + next.index : content.length;
  return {
    headingStart,
    headingEnd,
    bodyEnd,
    heading: m[0],
    body: content.slice(headingEnd, bodyEnd),
  };
}

export function validateChangelogUnreleased(content) {
  const block = findUnreleasedBlock(content);
  if (!block) {
    throw new Error(
      'CHANGELOG.md is missing a "## [Unreleased]" section — add one and write at least one entry before bumping.',
    );
  }
  // Strip blank lines; require at least one substantive line.
  const lines = block.body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error(
      "## [Unreleased] section is empty. Write release notes before bumping.",
    );
  }
}

export function rewriteChangelog(content, newVersion, dateStr) {
  const block = findUnreleasedBlock(content);
  if (!block) {
    throw new Error('CHANGELOG.md is missing a "## [Unreleased]" section.');
  }
  // Replace the Unreleased heading with the dated version heading, then
  // insert a fresh empty Unreleased block above it.
  const newHeading = `## [${newVersion}] - ${dateStr}`;
  const newUnreleased = "## [Unreleased]\n\n_No changes yet._\n\n";
  const before = content.slice(0, block.headingStart);
  const after = content.slice(block.headingEnd);
  return `${before}${newUnreleased}${newHeading}${after}`;
}

function run(cmd, opts) {
  return execSync(cmd, { encoding: "utf8", ...opts }).trim();
}

export function isGitClean(rootDir) {
  const out = run("git status --porcelain", { cwd: rootDir });
  return out.length === 0;
}

export function tagExistsLocally(rootDir, tag) {
  try {
    execSync(`git show-ref --tags --verify --quiet "refs/tags/${tag}"`, {
      cwd: rootDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function tagExistsOnOrigin(rootDir, tag) {
  try {
    const out = execSync(`git ls-remote --tags --refs origin "refs/tags/${tag}"`, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { known: true, exists: out.length > 0 };
  } catch (e) {
    return { known: false, exists: false, reason: e.message };
  }
}

async function main(argv = process.argv.slice(2)) {
  const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
  const ROOT = join(SCRIPT_DIR, "..");

  const newVersion = argv[0];

  const pkgPath = join(ROOT, "package.json");
  const tauriPath = join(ROOT, "src-tauri", "tauri.conf.json");
  const cargoPath = join(ROOT, "src-tauri", "Cargo.toml");
  const lockPath = join(ROOT, "src-tauri", "Cargo.lock");
  const changelogPath = join(ROOT, "CHANGELOG.md");

  const pkgContent = readFileSync(pkgPath, "utf8");
  const currentVersion = JSON.parse(pkgContent).version;

  validateVersionArg(newVersion, currentVersion);

  const tag = `v${newVersion}`;

  if (!isGitClean(ROOT)) {
    throw new Error(
      "Working tree is dirty. Commit or stash your changes before running release.",
    );
  }

  if (tagExistsLocally(ROOT, tag)) {
    throw new Error(`Local tag ${tag} already exists.`);
  }

  const remote = tagExistsOnOrigin(ROOT, tag);
  if (remote.known && remote.exists) {
    throw new Error(`Tag ${tag} already exists on origin. Refusing to overwrite.`);
  }
  if (!remote.known) {
    console.warn(
      `[warn] Could not verify origin for tag ${tag} (${remote.reason}). Proceeding without remote check.`,
    );
  }

  const changelogContent = readFileSync(changelogPath, "utf8");
  validateChangelogUnreleased(changelogContent);

  const tauriContent = readFileSync(tauriPath, "utf8");
  const cargoContent = readFileSync(cargoPath, "utf8");
  const lockContent = readFileSync(lockPath, "utf8");

  const dateStr = new Date().toISOString().slice(0, 10);

  writeFileSync(pkgPath, rewriteVersionInJson(pkgContent, newVersion));
  writeFileSync(tauriPath, rewriteVersionInJson(tauriContent, newVersion));
  writeFileSync(cargoPath, rewriteVersionInCargoToml(cargoContent, newVersion));
  writeFileSync(
    lockPath,
    rewriteVersionInCargoLock(lockContent, newVersion, CARGO_PACKAGE_NAME),
  );
  writeFileSync(changelogPath, rewriteChangelog(changelogContent, newVersion, dateStr));

  console.log(`Bumped ${currentVersion} -> ${newVersion}`);
  console.log("");
  console.log("Files updated:");
  console.log("  package.json");
  console.log("  src-tauri/tauri.conf.json");
  console.log("  src-tauri/Cargo.toml");
  console.log("  src-tauri/Cargo.lock");
  console.log("  CHANGELOG.md");
  console.log("");
  console.log("Next steps:");
  console.log(`  git add -A`);
  console.log(`  git commit -m "chore(release): ${tag}"`);
  console.log(`  git tag ${tag}`);
  console.log(`  git push && git push origin ${tag}`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}
