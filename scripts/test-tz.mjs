// Runs the date tests in several time zones (UTC, the user's, DST-heavy and date-line zones).
import { spawnSync } from "child_process";
let bad = 0;
for (const tz of ["UTC", "Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Lord_Howe", "Pacific/Auckland", "America/Sao_Paulo"]) {
  const r = spawnSync(process.execPath, ["scripts/test-dates.mjs"], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
  console.log(fails.length || r.status ? `✗ ${tz}\n${fails.join("\n")}` : `✓ ${tz}: ${out.split("\n").filter((l) => l.startsWith("ok")).length} date checks`);
  if (r.status) bad++;
}
process.exit(bad ? 1 : 0);
