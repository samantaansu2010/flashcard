import { CardState, Grade } from "./types";
import { DAY, MIN, dueAt, fmtDelay } from "./util";

export interface SchedConfig {
  learningSteps: number[]; // minutes
  relearningSteps: number[]; // minutes
  graduatingInterval: number; // days
  easyInterval: number; // days
  startingEase: number;
  minEase: number;
  easyBonus: number;
  hardMultiplier: number;
  intervalModifier: number;
  lapseMultiplier: number; // new interval after a lapse = old * this
  maxInterval: number;
  dayStartHour: number;
}

export const GRADE_NAMES = ["Again", "Hard", "Good", "Easy"] as const;

export function newState(c: { key: string; path: string }, cfg: SchedConfig): CardState {
  return {
    key: c.key, path: c.path, phase: 0, step: 0, due: 0, interval: 0,
    ease: cfg.startingEase, reps: 0, lapses: 0, last: 0, suspended: false,
  };
}

/**
 * Anki-style SM-2 variant: learning steps in minutes, then review intervals in days that grow by
 * the card's ease factor. Overdue time is partly credited, intervals are fuzzed, and
 * Hard < Good < Easy is always guaranteed.
 */
export function schedule(
  st: CardState, grade: Grade, now: number, cfg: SchedConfig, rand: () => number = Math.random
): CardState {
  const c: CardState = { ...st, reps: st.reps + 1, last: now };
  const cap = (d: number) => Math.min(cfg.maxInterval, Math.max(1, Math.round(d)));

  if (st.phase !== 2) {
    if (c.phase === 0) { c.phase = 1; c.step = 0; }
    const steps = c.phase === 3 ? cfg.relearningSteps : cfg.learningSteps;
    const graduate = (easy: boolean) => {
      const relearn = st.phase === 3;
      let days = relearn ? Math.max(1, c.interval) : easy ? cfg.easyInterval : cfg.graduatingInterval;
      if (relearn && easy) days = c.interval + 1;
      c.phase = 2; c.step = 0; c.interval = cap(days);
      c.due = dueAt(now, c.interval, cfg.dayStartHour);
    };
    if (!steps.length) { graduate(grade === 3); return c; }
    const at = (s: number) => steps[Math.min(s, steps.length - 1)];
    if (grade === 3) graduate(true);
    else if (grade === 2) {
      c.step += 1;
      if (c.step >= steps.length) graduate(false);
      else c.due = now + at(c.step) * MIN;
    } else if (grade === 1) {
      const d = c.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : at(c.step);
      c.due = now + d * MIN;
    } else {
      c.step = 0;
      c.due = now + steps[0] * MIN;
    }
    return c;
  }

  // Review card
  const iv = Math.max(1, st.interval);
  const late = Math.max(0, (now - st.due) / DAY);
  const m = cfg.intervalModifier;
  const fuzz = (d: number) => (d < 3 ? d : d + Math.round((rand() * 2 - 1) * Math.max(1, d * 0.05)));
  let h = Math.max(iv + 1, Math.round((iv + late / 4) * cfg.hardMultiplier * m));
  let g = Math.max(h + 1, Math.round((iv + late / 2) * st.ease * m));
  let e = Math.max(g + 1, Math.round((iv + late) * st.ease * cfg.easyBonus * m));
  h = fuzz(h); g = Math.max(h + 1, fuzz(g)); e = Math.max(g + 1, fuzz(e));

  if (grade === 0) {
    c.lapses += 1;
    c.ease = Math.max(cfg.minEase, st.ease - 0.2);
    c.interval = cap(iv * cfg.lapseMultiplier);
    if (cfg.relearningSteps.length) {
      c.phase = 3; c.step = 0; c.due = now + cfg.relearningSteps[0] * MIN;
    } else {
      c.due = dueAt(now, c.interval, cfg.dayStartHour);
    }
    return c;
  }
  if (grade === 1) { c.ease = Math.max(cfg.minEase, st.ease - 0.15); c.interval = cap(h); }
  else if (grade === 2) c.interval = cap(g);
  else { c.ease = st.ease + 0.15; c.interval = cap(e); }
  c.due = dueAt(now, c.interval, cfg.dayStartHour);
  return c;
}

/** Human label for the interval a grade button would produce. */
export function intervalLabel(next: CardState, now: number): string {
  return next.phase === 2 ? fmtDelay(next.interval * DAY) : fmtDelay(next.due - now);
}

/** Estimated probability of recall now (exponential forgetting curve, 90 % at the scheduled interval). */
export function retrievability(st: CardState, now: number): number | null {
  if (st.phase !== 2) return null;
  const elapsed = Math.max(0, (now - st.last) / DAY);
  return Math.pow(0.9, elapsed / Math.max(1, st.interval));
}
