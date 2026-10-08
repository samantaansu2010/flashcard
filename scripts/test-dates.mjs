// Date-range tests. Run under several time zones by scripts/test-tz.mjs (TZ is fixed per process).
import { build, reporter } from "./lib.mjs";
const { load, cleanup } = build(["util", "types", "data", "stats"], "dates");
const stats = await load("stats");
const { ok } = Object.assign(reporter(), {});
const R = reporter();
const t = (name, c, i) => R.ok(`[${process.env.TZ}] ${name}`, c, i);
const L = (y, m, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, mi, s, ms).getTime();
const day = (ts) => stats.fmtDMY(ts);
const pr = (p, now) => stats.presetRange(p, now, 0);
const lastDay = (r) => day(r.to - 1);

/* "Today" is today's local calendar date, from 00:00 to tomorrow 00:00 (exclusive) */
for (const now of [L(2026, 10, 4, 0, 0, 0, 0), L(2026, 10, 4, 0, 0, 0, 1), L(2026, 10, 4, 12), L(2026, 10, 4, 23, 59, 59, 999), L(2026, 12, 31, 23, 59, 59, 999), L(2027, 1, 1, 0, 0, 0, 0), L(2028, 2, 29, 13)]) {
  const r = pr("today", now);
  t(`today @${new Date(now).toString().slice(4, 24)} spans exactly the local calendar day`, r.from === L(new Date(now).getFullYear(), new Date(now).getMonth() + 1, new Date(now).getDate()) && day(r.from) === day(now) && lastDay(r) === day(now) && r.to > now && r.from <= now);
  t(`today excludes tomorrow, includes now (${day(now)})`, !(now + 36e5 * 26 < r.to) && now >= r.from && now < r.to);
}
/* the reported bug: label must not show tomorrow */
const n0 = L(2026, 10, 4, 15);
for (const p of ["today", "7d", "30d", "90d", "thisMonth", "thisYear"]) t(`${p}: last displayed day is today`, lastDay(pr(p, n0)) === "04/10/2026", lastDay(pr(p, n0)));
t("yesterday = previous local day", day(pr("yesterday", n0).from) === "03/10/2026" && lastDay(pr("yesterday", n0)) === "03/10/2026" && pr("yesterday", n0).to === pr("today", n0).from);
const span = (r) => { let n = 0, d = new Date(r.from); while (d.getTime() < r.to) { n++; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); } return n; };
t("last 7 / 30 / 90 days contain exactly 7 / 30 / 90 calendar days ending today", span(pr("7d", n0)) === 7 && span(pr("30d", n0)) === 30 && span(pr("90d", n0)) === 90 && day(pr("7d", n0).from) === "28/09/2026" && day(pr("30d", n0).from) === "05/09/2026");
t("this month / this year start on the 1st and stop at today", day(pr("thisMonth", n0).from) === "01/10/2026" && day(pr("thisYear", n0).from) === "01/01/2026");
t("previous month / previous year are complete calendar periods", day(pr("prevMonth", n0).from) === "01/09/2026" && lastDay(pr("prevMonth", n0)) === "30/09/2026" && day(pr("prevYear", n0).from) === "01/01/2025" && lastDay(pr("prevYear", n0)) === "31/12/2025");
/* year / month / leap boundaries */
const nJan = L(2027, 1, 15, 9);
t("previous month across a year boundary", day(pr("prevMonth", nJan).from) === "01/12/2026" && lastDay(pr("prevMonth", nJan)) === "31/12/2026");
t("this year on 1 Jan is just that day", day(pr("thisYear", L(2027, 1, 1, 0, 0, 1)).from) === "01/01/2027" && lastDay(pr("thisYear", L(2027, 1, 1, 0, 0, 1))) === "01/01/2027");
const nLeap = L(2028, 3, 1, 0, 0, 0);
t("leap year: previous month of 1 March 2028 is 29 days", lastDay(pr("prevMonth", nLeap)) === "29/02/2028" && span(pr("prevMonth", nLeap)) === 29);
t("30 days back across month end", day(pr("30d", L(2026, 3, 1, 10)).from) === "31/01/2026" && day(pr("30d", L(2028, 3, 1, 10)).from) === "01/02/2028");
t("7 days from 2 Jan crosses the year", day(pr("7d", L(2027, 1, 2, 10)).from) === "27/12/2026");

/* custom DD/MM/YYYY ranges are inclusive */
let c = stats.customRange("28/02/2028", "01/03/2028", 0);
t("custom: inclusive over leap day (3 days)", span(c.range) === 3 && day(c.range.from) === "28/02/2028" && lastDay(c.range) === "01/03/2028");
c = stats.customRange("31/12/2026", "01/01/2027", 0);
t("custom: across the year end", span(c.range) === 2 && lastDay(c.range) === "01/01/2027");
c = stats.customRange("04/10/2026", "04/10/2026", 0);
t("custom: single day", span(c.range) === 1 && c.range.from === L(2026, 10, 4) && c.range.to === L(2026, 10, 5));
c = stats.customRange("01/10/2026", "20/10/2026", 0, n0);
t("custom: future end date is clamped to today and flagged", c.clamped === true && lastDay(c.range) === "04/10/2026");
t("custom: no clamp when the end is today or earlier", stats.customRange("01/10/2026", "04/10/2026", 0, n0).clamped === false);
t("custom: start in the future is an error", !!stats.customRange("10/10/2026", "12/10/2026", 0, n0).error);
t("custom: invalid, reversed and malformed", !!stats.customRange("31/02/2026", "01/03/2026", 0).error && !!stats.customRange("05/10/2026", "01/10/2026", 0).error && !!stats.customRange("2026-10-01", "2026-10-02", 0).error && !!stats.customRange("1/1/26", "2/1/26", 0).error);
t("parseDMY/fmtDMY round trip around DST dates", ["08/03/2026", "01/11/2026", "29/03/2026", "25/10/2026", "29/02/2028", "31/12/2026"].every((s) => stats.fmtDMY(stats.parseDMY(s)) === s));

/* buckets (every granularity uses the same range) */
const rng = pr("30d", n0);
for (const g of ["hour", "day", "week", "month", "year"]) {
  const m = stats.makeBuckets(pr(g === "hour" ? "today" : "30d", n0), g, 0);
  const rr = pr(g === "hour" ? "today" : "30d", n0);
  t(`${g}: buckets contiguous and cover the range`, m.buckets.every((b, i, a) => i === 0 || a[i - 1].end === b.start) && m.buckets[0].start <= rr.from && m.buckets.at(-1).end >= rr.to && m.buckets.at(-1).start < rr.to, JSON.stringify([m.buckets[0], m.buckets.at(-1)]));
}
const dayB = stats.makeBuckets(rng, "day", 0).buckets;
t("daily buckets: 30, start at local midnight, last is today, unique labels", dayB.length === 30 && dayB.every((b) => new Date(b.start).getHours() === 0 && new Date(b.start).getMinutes() === 0) && day(dayB.at(-1).start) === "04/10/2026" && new Set(dayB.map((b) => b.label)).size === 30);
const hr = stats.makeBuckets(pr("today", n0), "hour", 0);
t("hourly buckets for today: 23–25 (DST) and none after today", hr.buckets.length >= 23 && hr.buckets.length <= 25 && hr.buckets.at(-1).end >= pr("today", n0).to && hr.buckets.at(-1).start < pr("today", n0).to && hr.buckets.every((b, i, a) => i === 0 || a[i - 1].end === b.start));
const wk = stats.makeBuckets(pr("90d", n0), "week", 0).buckets;
t("weekly buckets start on Monday", wk.every((b) => new Date(b.start).getDay() === 1));
for (const [from, to, g, label] of [["15/03/2026", "20/04/2026", "month", "months"], ["15/12/2025", "20/02/2027", "year", "years"], ["01/03/2026", "20/03/2026", "day", "days across US DST"], ["20/10/2026", "10/11/2026", "day", "days across US fall-back"], ["20/03/2026", "05/04/2026", "day", "days across EU DST"]]) {
  const m = stats.makeBuckets(stats.customRange(from, to, 0).range, g, 0);
  const expected = g === "day" ? span(stats.customRange(from, to, 0).range) : null;
  t(`${label}: contiguous, no duplicate/missing buckets`, m.buckets.every((b, i, a) => i === 0 || a[i - 1].end === b.start) && (expected === null || m.buckets.length === expected) && new Set(m.buckets.map((b) => b.start)).size === m.buckets.length, `${m.buckets.length} vs ${expected}`);
}
t("month buckets across a year end", stats.makeBuckets(stats.customRange("15/11/2026", "15/02/2027", 0).range, "month", 0).buckets.map((b) => b.label.slice(-4)).join() .includes("2027"));

/* aggregation at midnight: which day does a review belong to? */
const mk = (ts, grade = 2) => ({ ts, id: "a" + ts, grade, ms: 1000, phase: 2, iv: 3, sim: -1, deck: "D", tags: [] });
const logs = [mk(L(2026, 10, 3, 23, 59, 59, 999)), mk(L(2026, 10, 4, 0, 0, 0, 0)), mk(L(2026, 10, 4, 23, 59, 59, 999)), mk(L(2026, 10, 5, 0, 0, 0, 0)), mk(L(2026, 10, 4, 15))];
const ev = { created: [], matured: [], suspended: [] };
let rs = stats.analyzeRange(logs, ev, { range: pr("today", n0), granularity: "day" }, 0);
t("23:59:59.999 yesterday and 00:00 tomorrow are NOT in today; 00:00 and 23:59:59.999 today are", rs.totals.reviews === 3 && rs.reviews.join() === "3");
rs = stats.analyzeRange(logs, ev, { range: pr("yesterday", n0), granularity: "day" }, 0);
t("yesterday contains only the 23:59:59.999 review", rs.totals.reviews === 1);
rs = stats.analyzeRange(logs, ev, { range: stats.customRange("03/10/2026", "04/10/2026", 0).range, granularity: "day" }, 0);
t("custom 03–04 Oct is inclusive of both days (4 reviews) and not 05 Oct", rs.totals.reviews === 4 && rs.reviews.join() === "1,3");
rs = stats.analyzeRange(logs, ev, { range: pr("7d", n0), granularity: "hour" }, 0);
t("hourly granularity on a 7-day range uses the same boundaries", rs.totals.reviews === 4 || rs.totals.reviews === 5 - 1);
rs = stats.analyzeRange(logs, ev, { range: pr("30d", n0), granularity: "day" }, 0);
t("30 days: a review stamped tomorrow 00:00 is excluded", rs.totals.reviews === 4);
const hm = [...stats.analyzeRange(logs, ev, { range: pr("30d", n0), granularity: "day" }, 0).heat.keys()];
t("heat-map days are local midnights", hm.every((k) => new Date(k).getHours() === 0));
const ex = stats.exportRows(logs, { range: stats.customRange("03/10/2026", "04/10/2026", 0).range, granularity: "day" }, 0);
t("export rows use local calendar dates", ex.length === 2 && ex[0].date === "2026-10-03" && ex[1].date === "2026-10-04" && ex[1].reviews === 3, JSON.stringify(ex));
t("endOfToday is tomorrow 00:00 local", stats.endOfToday(L(2026, 12, 31, 23, 59, 59, 999), 0) === L(2027, 1, 1) && stats.endOfToday(L(2028, 2, 28, 5), 0) === L(2028, 2, 29));

cleanup();
console.log(R.failed ? `\n${R.failed} FAILED (${process.env.TZ})` : `\nDate tests passed (${process.env.TZ})`);
process.exit(R.failed ? 1 : 0);
