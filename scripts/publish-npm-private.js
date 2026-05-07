#!/usr/bin/env node

/**
 * Publish n9e-mcp-server packages to npm under a custom scope (default @logic3579).
 *
 * Differences from publish-npm.js:
 *   - Reads pre-built binaries from the local goreleaser dist/ directory
 *     (no `gh release download` — does not require a GitHub Release to exist).
 *   - Rewrites the npm scope across all package.json files, the wrapper
 *     index.js (PLATFORMS map), and the wrapper README so end-users see the
 *     correct install command.
 *   - Works on a temporary copy of npm/, never mutates the working tree.
 *
 * Usage:
 *   node scripts/publish-npm-private.js <version> \
 *     [--scope @logic3579] \
 *     [--dist ./dist] \
 *     [--repo logic3579/n9e-mcp-server] \
 *     [--dry-run]
 *
 * Required env:
 *   NODE_AUTH_TOKEN — npm auth token (set automatically by actions/setup-node)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const NPM_DIR = path.join(REPO_ROOT, "npm");

// Mapping from npm platform names to goreleaser archive names.
const PLATFORM_MAP = {
  "darwin-arm64": { os: "darwin", arch: "arm64", ext: "" },
  "darwin-x64":   { os: "darwin", arch: "amd64", ext: "" },
  "linux-arm64":  { os: "linux",  arch: "arm64", ext: "" },
  "linux-x64":    { os: "linux",  arch: "amd64", ext: "" },
  "win32-arm64":  { os: "windows", arch: "arm64", ext: ".exe" },
  "win32-x64":    { os: "windows", arch: "amd64", ext: ".exe" },
};

const ORIGINAL_SCOPE = "@n9e";
const ORIGINAL_REPO_URL = "https://github.com/n9e/n9e-mcp-server";

function getFlag(args, name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1];
}

function rewriteScopeInString(s, scope) {
  // Replace "@n9e/n9e-mcp-server" → "<scope>/n9e-mcp-server" (covers main + sub-packages).
  return s.split(`${ORIGINAL_SCOPE}/n9e-mcp-server`).join(`${scope}/n9e-mcp-server`);
}

function rewriteRepoInString(s, repoSlug) {
  return s.split(ORIGINAL_REPO_URL).join(`https://github.com/${repoSlug}`);
}

function rewritePackageJson(packagePath, version, scope, repoSlug) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  if (pkg.name && pkg.name.startsWith(`${ORIGINAL_SCOPE}/`)) {
    pkg.name = pkg.name.replace(`${ORIGINAL_SCOPE}/`, `${scope}/`);
  }

  pkg.version = version;

  if (pkg.optionalDependencies) {
    const next = {};
    for (const [name, _ver] of Object.entries(pkg.optionalDependencies)) {
      const newName = name.startsWith(`${ORIGINAL_SCOPE}/`)
        ? name.replace(`${ORIGINAL_SCOPE}/`, `${scope}/`)
        : name;
      next[newName] = version;
    }
    pkg.optionalDependencies = next;
  }

  if (pkg.repository && pkg.repository.url) {
    // The existing url has a "git+" prefix and ".git" suffix; preserve them.
    pkg.repository.url = pkg.repository.url
      .replace(`${ORIGINAL_REPO_URL}.git`, `https://github.com/${repoSlug}.git`)
      .replace(ORIGINAL_REPO_URL, `https://github.com/${repoSlug}`);
  }
  if (pkg.homepage) {
    pkg.homepage = rewriteRepoInString(pkg.homepage, repoSlug);
  }
  if (pkg.bugs && pkg.bugs.url) {
    pkg.bugs.url = rewriteRepoInString(pkg.bugs.url, repoSlug);
  }

  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
}

function rewriteFileContents(filePath, scope, repoSlug) {
  if (!fs.existsSync(filePath)) return;
  const original = fs.readFileSync(filePath, "utf8");
  const rewritten = rewriteRepoInString(rewriteScopeInString(original, scope), repoSlug);
  if (rewritten !== original) {
    fs.writeFileSync(filePath, rewritten);
  }
}

function extractBinaryFromArchive(archivePath, destDir, binaryName) {
  if (archivePath.endsWith(".zip")) {
    execSync(`unzip -o "${archivePath}" "${binaryName}" -d "${destDir}"`, { stdio: "inherit" });
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}" "${binaryName}"`, { stdio: "inherit" });
  }
}

function findArchive(distDir, version, info) {
  const ext = info.os === "windows" ? "zip" : "tar.gz";
  const expected = `n9e-mcp-server-v${version}-${info.os}-${info.arch}.${ext}`;
  const fullPath = path.join(distDir, expected);
  if (fs.existsSync(fullPath)) return fullPath;

  // Fallback: scan dist for any archive matching this os+arch (handles snapshot-suffixed names).
  const entries = fs.readdirSync(distDir);
  const match = entries.find(
    (e) => e.includes(`-${info.os}-${info.arch}.`) && e.endsWith(`.${ext}`)
  );
  if (match) return path.join(distDir, match);

  throw new Error(`No goreleaser archive found for ${info.os}-${info.arch} under ${distDir} (expected ${expected})`);
}

function main() {
  const args = process.argv.slice(2);
  const version = args[0];
  if (!version || version.startsWith("--")) {
    console.error("Usage: node publish-npm-private.js <version> [--scope @logic3579] [--dist ./dist] [--repo logic3579/n9e-mcp-server] [--dry-run]");
    process.exit(1);
  }

  const scope = getFlag(args, "--scope", "@logic3579");
  const distDir = path.resolve(getFlag(args, "--dist", path.join(REPO_ROOT, "dist")));
  const repoSlug = getFlag(args, "--repo", "logic3579/n9e-mcp-server");
  const dryRun = args.includes("--dry-run");

  if (!scope.startsWith("@")) {
    console.error(`--scope must start with @ (got ${scope})`);
    process.exit(1);
  }
  if (!fs.existsSync(distDir)) {
    console.error(`dist directory not found: ${distDir} — run goreleaser first`);
    process.exit(1);
  }

  console.log(`Publishing version ${version} under scope ${scope}${dryRun ? " (dry run)" : ""}`);
  console.log(`Reading binaries from ${distDir}`);

  // Work in a temp copy so the source tree stays clean.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "n9e-npm-publish-"));
  fs.cpSync(NPM_DIR, workDir, { recursive: true });
  console.log(`Working dir: ${workDir}`);

  const packageDirs = fs.readdirSync(workDir).filter((name) => {
    const stat = fs.statSync(path.join(workDir, name));
    return stat.isDirectory() && fs.existsSync(path.join(workDir, name, "package.json"));
  });

  // Step 1: rewrite package.json + wrapper code/docs in every package.
  console.log("\nRewriting package metadata...");
  for (const pkgName of packageDirs) {
    const pkgDir = path.join(workDir, pkgName);
    rewritePackageJson(path.join(pkgDir, "package.json"), version, scope, repoSlug);

    // Main wrapper has index.js (PLATFORMS map) and README — both reference the original scope.
    rewriteFileContents(path.join(pkgDir, "index.js"), scope, repoSlug);
    rewriteFileContents(path.join(pkgDir, "README.md"), scope, repoSlug);

    console.log(`  rewrote ${pkgName}`);
  }

  // Step 2: extract binaries from local dist/ into each platform sub-package.
  console.log("\nExtracting binaries from dist/...");
  for (const [platform, info] of Object.entries(PLATFORM_MAP)) {
    const pkgDir = path.join(workDir, `n9e-mcp-server-${platform}`);
    if (!fs.existsSync(pkgDir)) {
      console.warn(`  skipping ${platform}: no package directory`);
      continue;
    }
    const archive = findArchive(distDir, version, info);
    const binaryName = `n9e-mcp-server${info.ext}`;
    console.log(`  ${platform}: ${path.basename(archive)} → ${binaryName}`);
    extractBinaryFromArchive(archive, pkgDir, binaryName);
    if (info.ext === "") {
      fs.chmodSync(path.join(pkgDir, binaryName), 0o755);
    }
  }

  // Step 3: publish — sub-packages first so the main package's optionalDependencies resolve.
  console.log("\nPublishing to npm...");
  const subPackages = packageDirs.filter((p) => p !== "n9e-mcp-server");
  const publishOrder = [...subPackages, "n9e-mcp-server"];

  for (const pkgName of publishOrder) {
    const pkgDir = path.join(workDir, pkgName);
    const cmd = dryRun
      ? "npm publish --access public --dry-run"
      : "npm publish --access public";
    console.log(`  ${pkgName}: ${cmd}`);
    try {
      execSync(cmd, { cwd: pkgDir, stdio: "inherit" });
    } catch (e) {
      console.error(`  failed to publish ${pkgName}`);
      process.exit(1);
    }
  }

  console.log("\nDone.");
}

main();
