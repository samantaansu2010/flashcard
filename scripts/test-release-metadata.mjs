import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const semver = /^\d+\.\d+\.\d+$/;

assert.equal(pkg.name, manifest.id, "Package name and Obsidian plugin id must match");
assert.match(pkg.version, semver, "package.json must contain a stable semantic version");
assert.equal(lock.name, pkg.name, "package-lock.json and package.json names must match");
assert.equal(lock.version, pkg.version, "package-lock.json top-level version must match package.json");
assert.equal(lock.packages?.[""]?.version, pkg.version,
  "package-lock.json root package version must match package.json");
assert.match(manifest.version, semver, "manifest.json must contain a stable semantic version");
assert.equal(manifest.version, pkg.version, "Package and manifest versions must match");
assert.match(manifest.minAppVersion, semver, "manifest.json must declare a stable minimum Obsidian version");

assert.ok(versions && typeof versions === "object" && !Array.isArray(versions),
  "versions.json must be an object mapping plugin versions to minimum app versions");

for (const [version, minAppVersion] of Object.entries(versions)) {
  assert.match(version, semver, `Invalid plugin version key in versions.json: ${version}`);
  assert.match(minAppVersion, semver,
    `Invalid minimum app version for ${version} in versions.json`);
}

assert.equal(versions[manifest.version], manifest.minAppVersion,
  "versions.json must include the current plugin version with the matching minAppVersion");

console.log("Release metadata tests passed (package, lockfile, manifest, and compatibility map agree).");
