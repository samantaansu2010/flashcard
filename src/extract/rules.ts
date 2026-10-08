import { stripInline, wordCount } from "../util";
import { parseCardLine } from "../separators";
import {
  Ctx, HEADING, IGNORED_HEADINGS, RawCard, Rule, fmtTerm, headingQuestion, isProse, isSkipped,
  proseBlocks, sentencesOf, truncateSentences, validTerm,
} from "./helpers";

/* ───────────── Rules 1 & 2: Question/Answer pairs ───────────── */

function qaRule(id: string, name: string, description: string, qRe: RegExp, aRe: RegExp): Rule {
  return {
    id, name, description,
    run(ctx: Ctx): RawCard[] {
      const { lines } = ctx;
      const n = lines.length;
      const out: RawCard[] = [];
      let i = 0;
      while (i < n) {
        if (isSkipped(ctx, i)) { i++; continue; }
        const qm = qRe.exec(lines[i]);
        if (!qm) { i++; continue; }
        const q = [qm[1] ?? ""];
        let j = i + 1;
        let found = -1;
        while (j < n && !ctx.skip.has(j)) {
          const l = lines[j];
          if (aRe.test(l)) { found = j; break; }
          if (!l.trim()) {
            let k = j + 1;
            while (k < n && !lines[k].trim()) k++;
            if (k < n && !ctx.skip.has(k) && aRe.test(lines[k])) found = k;
            break;
          }
          if (qRe.test(l) || HEADING.test(l)) break;
          q.push(l.trim());
          j++;
        }
        if (found < 0) { i++; continue; }
        const am = aRe.exec(lines[found])!;
        const a = [am[1] ?? ""];
        let k = found + 1;
        if (!a[0].trim()) while (k < n && !lines[k].trim()) k++;
        while (k < n && !ctx.skip.has(k) && lines[k].trim() && !qRe.test(lines[k]) && !HEADING.test(lines[k])) {
          a.push(lines[k].replace(/^\s{0,3}/, ""));
          k++;
        }
        const front = q.join("\n").trim();
        const back = a.join("\n").trim();
        if (front && back) {
          for (let x = i; x < k; x++) ctx.claimed.add(x);
          out.push({ line: i, rule: id, front, back });
        }
        i = Math.max(k, i + 1);
      }
      return out;
    },
  };
}

const qaLong = qaRule(
  "qa-long", "Question / Answer", "Lines starting with “Question:” followed by “Answer:”.",
  /^\s*(?:\*\*|__)?Question(?:\s*:\s*(?:\*\*|__)?|(?:\*\*|__)\s*:)\s*(.*)$/i,
  /^\s*(?:\*\*|__)?Answer(?:\s*:\s*(?:\*\*|__)?|(?:\*\*|__)\s*:)\s*(.*)$/i
);

const qaShort = qaRule(
  "qa-short", "Q. / A.", "Lines starting with “Q.” or “Q:” followed by “A.” or “A:”.",
  /^\s*(?:\*\*|__)?Q\s*[.:]\s*(?:\*\*|__)?(?:\s+(.*))?$/,
  /^\s*(?:\*\*|__)?A\s*[.:]\s*(?:\*\*|__)?(?:\s+(.*))?$/
);

/* ───────────── Rule 8: Tables ───────────── */

const SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim().replace(/\\\|/g, "\u0002").replace(/\[\[[^\]]*?\]\]/g, (m) => m.replace(/\|/g, "\u0003"));
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.replace(/[\u0002\u0003]/g, "|").replace(/<br\s*\/?>/gi, "\n").trim());
}

const DEF_HEADER = /definition|meaning|description|explanation|defined|what it is|details?/i;
const TERM_HEADER = /^(terms?|words?|concepts?|vocab(ulary)?|key ?terms?|keywords?|phrases?|idioms?|acronyms?|abbreviations?)$/i;
const EMPTY_CELL = /^[-–—\s]*$/;

const tables: Rule = {
  id: "table", name: "Table", description: "Term | Definition tables, and other tables (row + column → cell).",
  run(ctx) {
    const { lines } = ctx;
    const n = lines.length;
    const out: RawCard[] = [];
    for (let i = 0; i < n - 1; i++) {
      if (isSkipped(ctx, i) || !lines[i].includes("|")) continue;
      if (isSkipped(ctx, i + 1) || !SEP.test(lines[i + 1])) continue;
      const head = splitRow(lines[i]);
      if (head.length < 2) continue;
      let j = i + 2;
      const rows: { cells: string[]; line: number }[] = [];
      while (j < n && !isSkipped(ctx, j) && lines[j].trim() && lines[j].includes("|")) {
        rows.push({ cells: splitRow(lines[j]), line: j });
        j++;
      }
      for (let x = i; x < j; x++) ctx.claimed.add(x);
      const defLike = DEF_HEADER.test(head[1]) || TERM_HEADER.test(head[0]);
      for (const r of rows) {
        const term = r.cells[0];
        if (!term || EMPTY_CELL.test(term)) continue;
        if (defLike) {
          const def = r.cells[1];
          if (def && !EMPTY_CELL.test(def)) {
            out.push({ line: r.line, rule: "table", front: `What is ${fmtTerm(term, ctx.opts)}?`, back: def });
          }
        } else if (ctx.opts.genericTables) {
          for (let k = 1; k < head.length; k++) {
            const cell = r.cells[k];
            if (!head[k] || !cell || EMPTY_CELL.test(cell)) continue;
            out.push({
              line: r.line, rule: "table",
              front: `**${head[0] || "Item"}:** ${term}\n\n**${head[k]}?**`,
              back: cell,
            });
          }
        }
      }
      i = j - 1;
    }
    return out;
  },
};

/* ───────────── Rule 7: Bullet definitions ───────────── */

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?(?:\*\*|__)?(.{1,60}?)(?:\*\*|__)?\s+(—|–|―|--|-|→|->|=>)\s+(\S.*)$/;

const bullets: Rule = {
  id: "bullet", name: "Bullet definition", description: "List items like “- GDP — Market value of final goods”.",
  run(ctx) {
    const out: RawCard[] = [];
    ctx.lines.forEach((l, i) => {
      if (isSkipped(ctx, i)) return;
      const m = BULLET.exec(l);
      if (!m) return;
      const [, term, sep, def] = m;
      if (/^\[[ xX]\]/.test(l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""))) return; // tasks
      if (sep === "-" && !/^[A-Z0-9*_[`]/.test(term)) return; // plain hyphen needs a capitalised term
      const plain = stripInline(term);
      if (wordCount(plain) > ctx.opts.maxTermWords || plain.length < 2 || /^\d+$/.test(plain)) return;
      if (wordCount(def) < 2) return;
      ctx.claimed.add(i);
      out.push({ line: i, rule: "bullet", front: `What is ${fmtTerm(term, ctx.opts)}?`, back: def.trim() });
    });
    return out;
  },
};

/* ───────────── Rule 6: Colon definitions ───────────── */

const COLON = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\*\*|__)?([^:*_|\n]{2,60}?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s+(\S.*)$/;
const LABELS = new RegExp(
  "^(note|tip|warning|caution|important|example|examples|e\\.g|eg|todo|to do|source|sources|see|see also|question|answer|q|a|summary|tldr|date|tags?|status|author|title|link|links|url|cc|from|to|subject|re|fyi|update|context|goal|hint|idea|ps|nb|remember|reminder|definition|def|meaning|term|topic|keywords?|type|created|modified|aliases|cssclasses|solution|proof|remark|comments?|references?|time|when|where|who|why|how|what)$",
  "i"
);

const colon: Rule = {
  id: "colon", name: "Colon definition", description: "Lines like “Opportunity Cost: The value of the next best alternative”.",
  run(ctx) {
    const out: RawCard[] = [];
    const { lines } = ctx;
    for (let i = 0; i < lines.length; i++) {
      if (isSkipped(ctx, i) || HEADING.test(lines[i])) continue;
      const m = COLON.exec(lines[i]);
      if (!m) continue;
      const term = stripInline(m[1]);
      let def = m[2].trim();
      const isList = /^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i]);
      if (LABELS.test(term) || /[?]$/.test(term) || /\.\s/.test(term) || /^\d+$/.test(term)) continue;
      if (/^\[[ xX]\]/.test(term)) continue;
      if (wordCount(term) > ctx.opts.maxTermWords) continue;
      if (wordCount(def) < (isList ? 3 : 2) || /^\/\//.test(def)) continue;
      const claim = [i];
      let k = i + 1;
      while (k < lines.length && !isSkipped(ctx, k) && /^(\s{2,}|\t)\S/.test(lines[k]) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[k])) {
        def += " " + lines[k].trim();
        claim.push(k);
        k++;
      }
      claim.forEach((x) => ctx.claimed.add(x));
      out.push({ line: i, rule: "colon", front: `What is ${fmtTerm(term, ctx.opts)}?`, back: def });
      i = k - 1;
    }
    return out;
  },
};

/* ───────────── Separator cards: “front :: back” ───────────── */

const separatorRule: Rule = {
  id: "separator", name: "Separator cards", description: "“Question :: Answer” lines (also →, =>, |, or your own separators). Used in the FlashCard Book folder and for manual generation.",
  run(ctx) {
    const seps = ctx.opts.separators;
    if (!seps?.length) return [];
    const out: RawCard[] = [];
    for (let i = 0; i < ctx.lines.length; i++) {
      if (isSkipped(ctx, i)) continue;
      const l = ctx.lines[i];
      if (!l.trim() || HEADING.test(l) || /^\s*(>|\||<!--|%%|!\[)/.test(l)) continue;
      const r = parseCardLine(l, seps);
      if (!r.ok) continue;
      ctx.claimed.add(i);
      out.push({ line: i, rule: "separator", front: r.card.front, back: r.card.back, blockId: r.card.id });
    }
    return out;
  },
};

/* ───────────── Cloze deletions ───────────── */

const ANKI = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;
const HILITE = /==([^=\s][^=]*?)==/g;
const BOLD = /\*\*([^*]+?)\*\*/g;

const BLOCK_ID = /\s\^(fcb-[a-z0-9]{4,})\s*$/;

const cloze: Rule = {
  id: "cloze", name: "Cloze", description: "Sentences with {{c1::hidden}} text or ==highlights== (optionally **bold**).",
  run(ctx) {
    const out: RawCard[] = [];
    const push = (line: number, front: string, back: string, expected: string, blockId?: string, suffix?: string, clozeText?: string): void => {
      if (!blockId && wordCount(front.replace(/\[[^\]]*\]/g, "")) < 3) return; // not enough context
      out.push({ line, rule: "cloze", front, back, expected: stripInline(expected), blockId, idSuffix: suffix, clozeText });
    };
    // Blocks that carry a FlashCard Book id are kept whole (the id identifies the whole block).
    const units: { text: string; line: number; id?: string }[] = [];
    for (const b of proseBlocks(ctx)) {
      const m = BLOCK_ID.exec(" " + b.text);
      if (m && /\{\{c\d+::/.test(b.text)) units.push({ text: b.text.slice(0, b.text.length - m[0].length + 1).trim().replace(/\s*<br\s*\/?>\s*/gi, "\n"), line: b.line, id: m[1] });
    }
    const idLines = new Set(units.map((u) => u.line));
    for (const s of sentencesOf(ctx)) if (!idLines.has(s.line)) units.push(s);
    units.sort((a, b) => a.line - b.line);
    for (const s of units) {
      const t = s.text;
      if (/\{\{c\d+::/.test(t)) {
        const ids = new Set<string>();
        t.replace(ANKI, (_m, id: string) => { ids.add(id); return ""; });
        for (const id of ids) {
          const answers: string[] = [];
          const front = t.replace(ANKI, (_m, n: string, a: string, hint?: string) => {
            if (n === id) { answers.push(a); return `[${hint ?? "…"}]`; }
            return a;
          }).replace(HILITE, "$1");
          const back = t.replace(ANKI, (_m, n: string, a: string) => (n === id ? `**${a}**` : a)).replace(HILITE, "$1");
          push(s.line, front, back, answers.join(", "), s.id, "c" + id, t);
        }
        continue;
      }
      let re: RegExp | null = null;
      if (new RegExp(HILITE.source).test(t)) re = HILITE;
      else if (ctx.opts.clozeBold && new RegExp(BOLD.source).test(t)) re = BOLD;
      if (!re) continue;
      const total = (t.match(re) ?? []).length;
      for (let target = 0; target < total; target++) {
        let idx = 0;
        let answer = "";
        const front = t.replace(re, (_m, a: string) => (idx++ === target ? ((answer = a), "[…]") : a));
        idx = 0;
        const back = t.replace(re, (_m, a: string) => (idx++ === target ? `**${a}**` : a));
        push(s.line, front.replace(HILITE, "$1"), back.replace(HILITE, "$1"), answer);
      }
    }
    return out;
  },
};

/* ───────────── Rule 3: Heading → explanation ───────────── */

const heading: Rule = {
  id: "heading", name: "Heading → explanation", description: "A heading followed by prose becomes “What is …?”.",
  run(ctx) {
    const { lines } = ctx;
    const n = lines.length;
    const out: RawCard[] = [];
    for (let i = 0; i < n; i++) {
      if (isSkipped(ctx, i)) continue;
      const m = HEADING.exec(lines[i]);
      if (!m) continue;
      const title = stripInline(m[2]).replace(/\s+#[\w/-]+/g, "").trim();
      if (!title || title.length > 90 || wordCount(title) > 12 || IGNORED_HEADINGS.test(title)) continue;
      const paras: string[] = [];
      let j = i + 1;
      let total = 0;
      while (j < n && paras.length < 2) {
        while (j < n && !lines[j].trim()) j++;
        if (j >= n || isSkipped(ctx, j) || !isProse(lines[j])) break;
        const buf: string[] = [];
        while (j < n && lines[j].trim() && !isSkipped(ctx, j) && isProse(lines[j])) { buf.push(lines[j].trim()); j++; }
        const p = buf.join(" ");
        paras.push(p);
        total += p.length;
        if (total >= ctx.opts.maxAnswerChars) break;
      }
      if (!paras.length) continue;
      let body = paras.join("\n\n");
      if (body.length > ctx.opts.maxAnswerChars) body = truncateSentences(body, ctx.opts.maxAnswerChars);
      if (wordCount(body) < 3) continue;
      out.push({ line: i, rule: "heading", front: headingQuestion(title, ctx.opts), back: body });
    }
    return out;
  },
};

/* ───────────── Rule 5: means / refers to / is defined as ───────────── */

const MEANS = /^(.{2,80}?)\s+(means|refers? to|(?:is|are) defined as|can be defined as|(?:is|are) described as|denotes?|stands? for)\s+(.{4,})$/i;

const means: Rule = {
  id: "means", name: "Means / refers to", description: "“X means …”, “X refers to …”, “X is defined as …”, “X stands for …”.",
  run(ctx) {
    const out: RawCard[] = [];
    for (const s of sentencesOf(ctx)) {
      if (/[?:]$/.test(s.text) || s.text.length > ctx.opts.maxAnswerChars) continue;
      const m = MEANS.exec(s.text);
      if (!m || !validTerm(m[1], ctx.opts)) continue;
      const term = fmtTerm(m[1], ctx.opts);
      const v = m[2].toLowerCase();
      const plural = /^(are |refer\b|denote\b|stand\b)/.test(v);
      let q: string;
      if (v === "means") q = `What does ${term} mean?`;
      else if (/^stands? for$/.test(v)) q = `What does ${term} stand for?`;
      else if (/^denotes?$/.test(v)) q = `What does ${term} denote?`;
      else q = `What ${plural ? "are" : "is"} ${term}?`;
      ctx.used.add(s.text);
      out.push({ line: s.line, rule: "means", front: q, back: s.text });
    }
    return out;
  },
};

/* ───────────── Rule 4: “X is a/the …” definition sentences ───────────── */

const DEFN = /^(.{2,80}?)\s+(is|are)\s+((?:a|an|the|any|one of|one|when|where|used to|typically|usually|generally|simply|essentially)\s.+)$/i;

const definition: Rule = {
  id: "definition", name: "Definition sentence", description: "Sentences like “Photosynthesis is the process by which …”.",
  run(ctx) {
    const out: RawCard[] = [];
    for (const s of sentencesOf(ctx)) {
      if (ctx.used.has(s.text) || /[?:]$/.test(s.text) || s.text.length > ctx.opts.maxAnswerChars) continue;
      if (wordCount(s.text) < 6) continue;
      const m = DEFN.exec(s.text);
      if (!m || !validTerm(m[1], ctx.opts)) continue;
      const term = fmtTerm(m[1], ctx.opts);
      out.push({ line: s.line, rule: "definition", front: `What ${m[2].toLowerCase()} ${term}?`, back: s.text });
    }
    return out;
  },
};

/** Priority order: earlier rules win when two produce the same question. */
export const RULES: Rule[] = [qaLong, qaShort, tables, separatorRule, bullets, colon, cloze, heading, means, definition];
