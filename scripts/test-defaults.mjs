import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const settingsSource = fs.readFileSync(path.join(root, "src/settings.ts"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "src/main.ts"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "src/index.ts"), "utf8");

const defaults = settingsSource.match(/export const DEFAULT_SETTINGS: Settings = \{([\s\S]*?)\n\};/);
assert.ok(defaults, "DEFAULT_SETTINGS must exist");
assert.match(defaults[1], /^\s*autoGenerate:\s*false,\s*$/m,
  "Automatic generation must be off in defaults for new installs");
assert.match(defaults[1], /^\s*excludeTemplateFolders:\s*true,\s*$/m,
  "Template folders must be excluded by default");

// The user's saved settings spread after defaults, so existing preferences are preserved.
assert.match(mainSource,
  /const s = raw\.settings \?\? \{\};\s*this\.settings = \{\s*\.\.\.DEFAULT_SETTINGS,\s*\.\.\.s,/s,
  "Saved settings must override defaults during loading");

// The official FlashCard folder and explicit note opt-in are checked before the global off gate.
assert.match(indexSource,
  /if \(this\.isOfficial\(file\.path\)\) return true;\s*if \(s\.excludeTemplateFolders && isTemplateFolderPath\(file\.path\)\) return false;\s*if \(!s\.autoGenerate && !\(fm === true \|\| fm === "true"\)\) return false;/,
  "Manual-card folder and flashcards:true opt-in must remain available");

console.log("Default-settings tests passed (new installs off; saved preferences and note opt-in preserved).");
