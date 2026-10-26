/* 컨닝페이퍼(마크다운 표) → 카드 덱
   - '#' 제목 줄은 덱 이름(첫 '# ')이나 묶음 이름('## ', '### ')
   - '| 항목 | 내용 |' 표의 각 줄이 카드 한 장: 왼쪽 칸이 앞면, 나머지 칸이 뒷면
   - 머리줄(항목/내용)과 구분줄(---)은 건너뛴다 */
import { State, UserDeck } from "./lib";
import weak1026 from "./decks/2026-10-26-weak.md" with { type: "text" };

export type Card = { id: string; front: string; back: string; section: string; sectionIndex: number };
export type DeckSection = { title: string; cards: Card[] };
export type Deck = { id: string; title: string; builtIn: boolean; createdAt: number; sections: DeckSection[]; cards: Card[] };

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
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cleanCell);
    if (cells.length < 2) continue;
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
    if (HEADER_WORDS.has(plain(cells[0])) || plain(cells[1]) === "내용") continue;
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

function toDeck(id: string, md: string, builtIn: boolean, createdAt: number, title?: string): Deck {
  const p = parseCheatSheet(id, md, title);
  return { id, title: title || p.title, builtIn, createdAt, sections: p.sections, cards: p.sections.flatMap((s) => s.cards) };
}

let memo: { decks: State["decks"]; out: Deck[] } | null = null;
/** 기본 덱 + 붙여 넣은 덱(지운 것 제외), 최근 것 먼저 */
export function allDecks(st: State): Deck[] {
  if (memo && memo.decks === st.decks) return memo.out;
  const user = Object.values(st.decks || {})
    .filter((d: UserDeck) => !d.deleted && d.md)
    .map((d) => toDeck(d.id, d.md, false, d.createdAt, d.title));
  const out = [...BUILT_IN.map((b) => toDeck(b.id, b.md, true, b.createdAt)), ...user].sort((a, b) => b.createdAt - a.createdAt);
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
