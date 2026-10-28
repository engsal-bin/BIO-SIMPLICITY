/* 컨닝페이퍼(마크다운 표) → 카드 덱
   - '#' 제목 줄은 덱 이름(첫 '# ')이나 묶음 이름('## ', '### ')
   - '| 항목 | 내용 |' 표의 각 줄이 카드 한 장: 왼쪽 칸이 앞면, 나머지 칸이 뒷면
   - 머리줄(항목/내용)과 구분줄(---)은 건너뛴다 */
import { State, UserDeck } from "./lib";
import weak1026 from "./decks/2026-10-26-weak.md" with { type: "text" };

export type Card = { id: string; front: string; back: string; section: string; sectionIndex: number };
export type DeckSection = { title: string; cards: Card[] };
export type Deck = { id: string; title: string; builtIn: boolean; createdAt: number; sections: DeckSection[]; cards: Card[]; md: string; overridden?: boolean };

const BUILT_IN: { id: string; md: string; createdAt: number }[] = [
  { id: "b-2026-10-26-weak", md: weak1026, createdAt: Date.UTC(2026, 9, 26, 8) },
];

const HEADER_WORDS = new Set(["항목", "용어", "개념", "키워드", "질문", "앞면"]);
const cleanCell = (s: string) => s.trim();
/** 앞면에서는 굵게 표시만 지운다 */
export const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^\w])_(.+?)_(?=[^\w]|$)/g, "$1$2").trim();

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** 표 한 줄을 칸으로 나눈다. 칸 안의 '|'는 '\\|'로 적는다 */
export function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => cleanCell(c).replace(/\\\|/g, "|"));
}
const isSeparator = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
const isHeader = (cells: string[]) => HEADER_WORDS.has(plain(cells[0])) || plain(cells[1] || "") === "내용";

/* ───────── 편집기용 모델: 제목, 묶음, 줄(빈 줄도 그대로) ───────── */

export type EditRow = { key: string; front: string; back: string };
export type EditSection = { key: string; title: string; rows: EditRow[] };
export type EditModel = { title: string; sections: EditSection[] };

let keySeq = 0;
export const newKey = () => `k${++keySeq}`;

export function toEditModel(md: string, fallbackTitle = ""): EditModel {
  let title = "";
  const sections: EditSection[] = [];
  let cur: EditSection | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (h[1].length === 1 && !title) title = plain(h[2]);
      else {
        cur = { key: newKey(), title: plain(h[2]), rows: [] };
        sections.push(cur);
      }
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells.length < 2 || isSeparator(cells) || isHeader(cells)) continue;
    if (!cur) {
      cur = { key: newKey(), title: "", rows: [] };
      sections.push(cur);
    }
    cur.rows.push({ key: newKey(), front: plain(cells[0]), back: cells.slice(1).filter(Boolean).join(" / ") });
  }
  if (!sections.length) sections.push({ key: newKey(), title: "", rows: [{ key: newKey(), front: "", back: "" }] });
  return { title: title || fallbackTitle, sections };
}

const cellOut = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

export function fromEditModel(m: EditModel): string {
  const out: string[] = [];
  if (m.title.trim()) out.push(`# ${m.title.trim()}`, "");
  for (const s of m.sections) {
    const rows = s.rows.filter((r) => r.front.trim() || r.back.trim());
    if (!rows.length && !s.title.trim()) continue;
    if (s.title.trim()) out.push(`## ${s.title.trim()}`, "");
    out.push("| 항목 | 내용 |", "| --- | --- |");
    for (const r of rows) out.push(`| ${r.front.trim() ? `**${cellOut(plain(r.front))}**` : ""} | ${cellOut(r.back)} |`);
    out.push("");
  }
  return out.join("\n");
}

export function parseCheatSheet(id: string, md: string, fallbackTitle = "컨닝페이퍼"): { title: string; sections: DeckSection[] } {
  let title = "";
  const sections: DeckSection[] = [];
  let cur: DeckSection | null = null;
  const seen = new Set<string>();
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const text = plain(h[2]);
      if (h[1].length === 1 && !title) title = text;
      else {
        cur = { title: text, cards: [] };
        sections.push(cur);
      }
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells.length < 2 || isSeparator(cells) || isHeader(cells)) continue;
    const front = cells[0];
    const back = cells.slice(1).filter(Boolean).join(" / ");
    if (!plain(front) || !back) continue;
    if (!cur) {
      cur = { title: "", cards: [] };
      sections.push(cur);
    }
    const si = sections.indexOf(cur);
    let cid = `${id}:${hash(si + "|" + plain(front))}`;
    while (seen.has(cid)) cid += "x";
    seen.add(cid);
    cur.cards.push({ id: cid, front, back, section: cur.title, sectionIndex: si });
  }
  const kept = sections.filter((s) => s.cards.length);
  kept.forEach((s, i) => {
    if (!s.title) s.title = kept.length === 1 ? "전체" : `묶음 ${i + 1}`;
    s.cards.forEach((c) => {
      c.section = s.title;
      c.sectionIndex = i;
    });
  });
  return { title: title || fallbackTitle, sections: kept };
}

function toDeck(id: string, md: string, builtIn: boolean, createdAt: number, title?: string, overridden = false): Deck {
  const p = parseCheatSheet(id, md, title);
  return { id, title: title || p.title, builtIn, createdAt, sections: p.sections, cards: p.sections.flatMap((s) => s.cards), md, overridden };
}

let memo: { decks: State["decks"]; out: Deck[] } | null = null;
/** 기본 덱 + 붙여 넣은 덱(지운 것 제외), 최근 것 먼저 */
export function allDecks(st: State): Deck[] {
  if (memo && memo.decks === st.decks) return memo.out;
  const saved = st.decks || {};
  const builtInIds = new Set(BUILT_IN.map((b) => b.id));
  const user = Object.values(saved)
    .filter((d: UserDeck) => !builtInIds.has(d.id) && !d.deleted && d.md)
    .map((d) => toDeck(d.id, d.md, false, d.createdAt, d.title));
  // 기본 덱을 고쳤으면 고친 내용으로(되돌리면 deleted 흔적 → 원래 내용)
  const builtIns = BUILT_IN.map((b) => {
    const o = saved[b.id];
    return o && !o.deleted && o.md ? toDeck(b.id, o.md, true, b.createdAt, o.title, true) : toDeck(b.id, b.md, true, b.createdAt);
  });
  const out = [...builtIns, ...user].sort((a, b) => b.createdAt - a.createdAt);
  memo = { decks: st.decks, out };
  return out;
}

/** 카드 상태: 'new' 아직 안 봄, 'learning' 마지막에 몰랐음, 'known' 마지막에 알았음 */
export function cardState(st: State, id: string): "new" | "learning" | "known" {
  const c = st.cards?.[id];
  return !c ? "new" : c.last ? "known" : "learning";
}

export function deckProgress(st: State, cards: Card[]) {
  let known = 0;
  let learning = 0;
  for (const c of cards) {
    const s = cardState(st, c.id);
    if (s === "known") known++;
    else if (s === "learning") learning++;
  }
  return { known, learning, fresh: cards.length - known - learning, total: cards.length };
}

/* ───────── 덱 정리: 마지막 공부, 오늘 다시 볼 카드, 찾기 ───────── */

export const deckIdOf = (cardId: string) => cardId.slice(0, cardId.indexOf(":"));

let lastMemo: { cards: State["cards"]; out: Record<string, number> } | null = null;
/** 덱 id → 그 덱 카드를 마지막으로 넘긴 시각 */
export function lastStudiedMap(st: State): Record<string, number> {
  if (lastMemo && lastMemo.cards === st.cards) return lastMemo.out;
  const out: Record<string, number> = {};
  for (const [id, c] of Object.entries(st.cards || {})) {
    const d = deckIdOf(id);
    if (!out[d] || c.t > out[d]) out[d] = c.t;
  }
  lastMemo = { cards: st.cards, out };
  return out;
}

const DAY = 86400000;
/** 알아요를 이어서 받을수록 다시 볼 간격을 늘린다(1·2·4·8·16·30일). 몰라요면 바로 다시 */
export function reviewInterval(ok: number, ng: number): number {
  const streakish = Math.max(1, ok - ng);
  return [1, 2, 4, 8, 16, 30][Math.min(streakish - 1, 5)] * DAY;
}

export type DueCard = Card & { deckId: string; overdue: number };

/** 오늘 다시 볼 카드: 몰라요였던 카드 + 알아요였지만 간격이 지난 카드(보관한 덱은 간격의 2배가 지나야) */
export function dueCards(st: State, now = Date.now(), max = 60): DueCard[] {
  const metas = st.deckMeta || {};
  const out: DueCard[] = [];
  for (const d of allDecks(st)) {
    const archived = !!metas[d.id]?.archived;
    for (const c of d.cards) {
      const s = st.cards?.[c.id];
      if (!s) continue;
      if (!s.last) {
        if (!archived) out.push({ ...c, deckId: d.id, overdue: Number.MAX_SAFE_INTEGER - (now - s.t) });
        continue;
      }
      const wait = reviewInterval(s.ok, s.ng) * (archived ? 2 : 1);
      if (now - s.t >= wait) out.push({ ...c, deckId: d.id, overdue: now - s.t - wait });
    }
  }
  return out.sort((a, b) => b.overdue - a.overdue).slice(0, max);
}

export function folderList(st: State) {
  return Object.values(st.folders || {})
    .filter((f) => !f.deleted)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export type CardHit = { deck: Deck; card: Card };
export function searchCards(st: State, q: string, max = 40): { decks: Deck[]; cards: CardHit[] } {
  const needle = q.trim().toLowerCase().replace(/\s+/g, "");
  if (!needle) return { decks: [], cards: [] };
  const norm = (s: string) => plain(s).toLowerCase().replace(/\s+/g, "");
  const decks: Deck[] = [];
  const cards: CardHit[] = [];
  for (const d of allDecks(st)) {
    if (norm(d.title).includes(needle)) decks.push(d);
    for (const c of d.cards) if (cards.length < max && (norm(c.front).includes(needle) || norm(c.back).includes(needle))) cards.push({ deck: d, card: c });
  }
  return { decks, cards };
}

export function relDay(t: number | undefined, now = Date.now()): string {
  if (!t) return "안 봄";
  const a = new Date(now);
  a.setHours(0, 0, 0, 0);
  const days = Math.round((a.getTime() - new Date(t).setHours(0, 0, 0, 0)) / DAY);
  return days <= 0 ? "오늘" : days === 1 ? "어제" : days < 30 ? `${days}일 전` : `${Math.round(days / 30)}달 전`;
}
