import { useSyncExternalStore } from "react";

/* ───────── 문항 데이터 ───────── */

export type QType = "mcq" | "blank" | "short" | "essay";
export type Question = {
  id: string;
  book_id: string;
  round_id: string;
  number: number;
  printed_number: number;
  type: QType;
  stem: string;
  passage: string;
  statements: { label: string; text: string }[];
  choices: string[];
  answer: number[] | string[] | null;
  accepted_answers: string[][];
  explanation: string;
  explanation_images: string[];
  source: string | null;
  images: string[];
  version: number;
  hidden: boolean;
  note?: string | null;
};
export type Book = { id: string; title: string; year: number; round_count: number };
export type Round = { id: string; book_id: string; number: number; part: string | null; time_limit_sec: number; question_count: number };

export type DB = {
  books: Book[];
  rounds: Round[];
  questions: Question[];
  q: Record<string, Question>;
  roundsOf: Record<string, Round[]>;
  questionsOf: Record<string, Question[]>;
  round: Record<string, Round>;
  book: Record<string, Book>;
};

export type RawDB = { books: Book[]; rounds: Round[]; questions: Question[] };

/** 같은 폴더의 data/questions.json (비공개 링크용 빌드에만 있음). 없으면 null */
export async function loadLocalRaw(): Promise<RawDB | null> {
  try {
    const res = await fetch("data/questions.json");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function buildDB(raw: RawDB): DB {
  const db: DB = { ...raw, q: {}, roundsOf: {}, questionsOf: {}, round: {}, book: {} };
  for (const b of db.books) db.book[b.id] = b;
  for (const r of db.rounds) {
    db.round[r.id] = r;
    (db.roundsOf[r.book_id] ||= []).push(r);
  }
  for (const q of db.questions) {
    db.q[q.id] = q;
    if (!q.hidden) (db.questionsOf[q.round_id] ||= []).push(q);
  }
  return db;
}

/* ───────── 채점 ───────── */

const norm = (s: string) =>
  s.toLowerCase().normalize("NFC").replace(/[\s·\-_.,()（）'"`’‘“”=]/g, "");

export function blankMatches(input: string, accepted: string[]): boolean {
  const x = norm(input || "");
  if (!x) return false;
  return accepted.some((a) => {
    const y = norm(a);
    if (!y) return false;
    if (x === y) return true;
    if (y.length >= 2 && x.includes(y)) return true;
    return x.length >= 2 && y.includes(x) && x.length / y.length >= 0.6;
  });
}

export type Resp = number | string[] | string | null | undefined;

/** true/false = 자동 채점, null = 스스로 채점해야 함 */
export function grade(q: Question, r: Resp): boolean | null {
  if (q.type === "mcq") return typeof r === "number" && (q.answer as number[]).includes(r);
  if (q.type === "blank") {
    const arr = Array.isArray(r) ? r : [];
    const acc = q.accepted_answers.length ? q.accepted_answers : ((q.answer as string[]) || []).map((a) => [a]);
    return acc.length > 0 && acc.every((a, i) => blankMatches(arr[i] || "", a));
  }
  return null;
}

/* ───────── 학습 기록 (기기에 저장, 로그인하면 클라우드와 합쳐서 동기화) ───────── */

export type Attempt = { q: string; ok: boolean; m: string; t: number };
export type Session = {
  id: string;
  kind: "round" | "practice" | "flash";
  title: string;
  roundId?: string;
  back: string;
  qids: string[];
  results: Record<string, boolean | null>;
  resps: Record<string, Resp>;
  startedAt: number;
  durationSec: number;
  /** 마지막으로 고친 시각(스스로 채점 등). 동기화 때 더 최근 것을 남긴다 */
  u?: number;
};
export type Settings = { theme: "system" | "light" | "dark"; font: "m" | "l" };
export type State = {
  attempts: Attempt[];
  sessions: Session[];
  /** 문항 id → 시각. 양수는 북마크함, 음수는 그 시각에 해제함(동기화용 흔적) */
  bookmarks: Record<string, number>;
  settings: Settings;
  /** '기록 모두 지우기' 한 시각. 이보다 앞선 기록은 동기화로 되살아나지 않는다 */
  resetAt?: number;
};

export type SyncedState = Omit<State, "settings">;

const attemptKey = (a: Attempt) => `${a.q}|${a.t}|${a.m}`;

/** 두 기기의 기록을 합친다. 순서와 상관없이 같은 결과가 나온다. */
export function mergeState(a: SyncedState, b: SyncedState): SyncedState {
  const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
  const att = new Map<string, Attempt>();
  for (const x of [...(a.attempts || []), ...(b.attempts || [])]) if (x.t >= resetAt) att.set(attemptKey(x), x);
  const ses = new Map<string, Session>();
  for (const x of [...(a.sessions || []), ...(b.sessions || [])]) {
    if (x.startedAt < resetAt) continue;
    const old = ses.get(x.id);
    if (!old || (x.u || x.startedAt) > (old.u || old.startedAt)) ses.set(x.id, x);
  }
  const bm: Record<string, number> = {};
  for (const src of [a.bookmarks || {}, b.bookmarks || {}])
    for (const [k, v] of Object.entries(src)) if (!(k in bm) || Math.abs(v) > Math.abs(bm[k])) bm[k] = v;
  for (const k of Object.keys(bm)) if (Math.abs(bm[k]) < resetAt) delete bm[k];
  return {
    attempts: [...att.values()].sort((x, y) => x.t - y.t),
    sessions: [...ses.values()].sort((x, y) => x.startedAt - y.startedAt),
    bookmarks: bm,
    resetAt: resetAt || undefined,
  };
}

export const syncedPart = (s: State): SyncedState => ({ attempts: s.attempts, sessions: s.sessions, bookmarks: s.bookmarks, resetAt: s.resetAt });

export const bookmarkedIds = (s: State) => Object.keys(s.bookmarks).filter((k) => s.bookmarks[k] > 0);

const KEY = "bioquiz:v1";
const empty = (): State => ({ attempts: [], sessions: [], bookmarks: {}, settings: { theme: "system", font: "m" } });

function read(): State {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { ...empty(), ...JSON.parse(s) };
  } catch {}
  return empty();
}

let state: State = read();
let version = 0;
const subs = new Set<() => void>();
const changeSubs = new Set<() => void>();

/** local=true면 이 기기에서 생긴 변화라 클라우드로 올릴 거리가 생긴 것 */
function commit(next: State, local = true) {
  state = next;
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  subs.forEach((f) => f());
  if (local) changeSubs.forEach((f) => f());
}

export const store = {
  get: () => state,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  record(qid: string, ok: boolean, mode: string) {
    commit({ ...state, attempts: [...state.attempts, { q: qid, ok, m: mode, t: Date.now() }] });
  },
  saveSession(s: Session) {
    const others = state.sessions.filter((x) => x.id !== s.id);
    commit({ ...state, sessions: [...others, { ...s, u: Date.now() }] });
  },
  toggleBookmark(qid: string) {
    const b = { ...state.bookmarks };
    b[qid] = b[qid] > 0 ? -Date.now() : Date.now();
    commit({ ...state, bookmarks: b });
  },
  setSettings(p: Partial<Settings>) {
    commit({ ...state, settings: { ...state.settings, ...p } }, false);
  },
  /** 클라우드에서 받은 기록을 합친다. 합친 결과가 받은 것과 다르면 true(다시 올려야 함) */
  mergeRemote(remote: SyncedState): SyncedState {
    const merged = mergeState(syncedPart(state), remote);
    commit({ ...state, ...merged }, false);
    return merged;
  },
  onLocalChange(f: () => void) {
    changeSubs.add(f);
    return () => changeSubs.delete(f);
  },
  exportJSON: () => JSON.stringify({ app: "bioquiz", exportedAt: new Date().toISOString(), state }, null, 1),
  importJSON(text: string) {
    const parsed = JSON.parse(text);
    const s = parsed.state ?? parsed;
    if (!Array.isArray(s.attempts) || !Array.isArray(s.sessions)) throw new Error("학습 기록 파일 형식이 아닙니다.");
    commit({ ...state, ...mergeState(syncedPart(state), { attempts: s.attempts, sessions: s.sessions, bookmarks: s.bookmarks || {}, resetAt: s.resetAt }) });
  },
  reset() {
    commit({ ...empty(), settings: state.settings, resetAt: Date.now() });
  },
};

export function useStore(): State {
  return useSyncExternalStore(store.subscribe, store.get);
}

/* ───────── 기록에서 계산하는 값 ───────── */

export type QStat = { tries: number; correct: number; last: boolean | null; streak: number; everWrong: boolean };

let memo: { v: number; stats: Record<string, QStat> } = { v: -1, stats: {} };
export function qStats(): Record<string, QStat> {
  if (memo.v === version) return memo.stats;
  const stats: Record<string, QStat> = {};
  for (const a of state.attempts) {
    const s = (stats[a.q] ||= { tries: 0, correct: 0, last: null, streak: 0, everWrong: false });
    s.tries++;
    if (a.ok) {
      s.correct++;
      s.streak++;
    } else {
      s.streak = 0;
      s.everWrong = true;
    }
    s.last = a.ok;
  }
  memo = { v: version, stats };
  return stats;
}

/** 오답노트: 한 번이라도 틀렸고, 그 뒤로 2번 연속 맞히지 못한 문항 */
export const GRADUATE_STREAK = 2;
export function wrongNoteIds(db: DB): string[] {
  const st = qStats();
  return Object.keys(st).filter((id) => st[id].everWrong && st[id].streak < GRADUATE_STREAK && db.q[id] && !db.q[id].hidden);
}

export function lastRoundSession(roundId: string): Session | undefined {
  const list = state.sessions.filter((s) => s.kind === "round" && s.roundId === roundId);
  return list.sort((a, b) => b.startedAt - a.startedAt)[0];
}

export function bestScore(roundId: string): number | null {
  const list = state.sessions.filter((s) => s.kind === "round" && s.roundId === roundId);
  if (!list.length) return null;
  return Math.max(...list.map((s) => Object.values(s.results).filter((x) => x === true).length));
}

export function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function streakDays(): number {
  const days = new Set(state.attempts.map((a) => dayKey(a.t)));
  let n = 0;
  const d = new Date();
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const CIRCLED = ["①", "②", "③", "④", "⑤"];

export function answerText(q: Question): string {
  if (q.type === "mcq") return ((q.answer as number[]) || []).map((i) => `${CIRCLED[i]} ${q.choices[i] ?? ""}`).join(", ");
  if (!q.answer) return "";
  return (q.answer as string[]).map((a, i, all) => (all.length > 1 ? `${i + 1}) ${a}` : a)).join("\n");
}

/* ───────── 라우팅 (#/경로?쿼리) ───────── */

export type Route = { path: string[]; query: URLSearchParams };
function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const [p, q] = h.split("?");
  return { path: p ? p.split("/").map(decodeURIComponent) : [], query: new URLSearchParams(q || "") };
}
// 화면 상태는 메모리에 두고 주소창 #은 되는 곳에서만 맞춰 둔다
// (일부 내장 뷰어는 #경로 변경을 막는다).
let route = parseHash();
const rsubs = new Set<() => void>();
function setRoute(to: string) {
  const [p, q] = to.replace(/^#?\/?/, "").split("?");
  route = { path: p ? p.split("/").map(decodeURIComponent) : [], query: new URLSearchParams(q || "") };
  rsubs.forEach((f) => f());
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => {
  const h = location.hash.replace(/^#\/?/, "");
  const cur = route.path.join("/") + (route.query.toString() ? "?" + route.query.toString() : "");
  if (h !== cur) setRoute(h);
});
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest?.("a[href^='#/']") as HTMLAnchorElement | null;
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  go(a.getAttribute("href")!.slice(1));
});
export function useRoute(): Route {
  return useSyncExternalStore(
    (f) => {
      rsubs.add(f);
      return () => rsubs.delete(f);
    },
    () => route,
  );
}
export const go = (to: string, replace = false) => {
  setRoute(to);
  try {
    const url = "#" + to.replace(/^#/, "");
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  } catch {}
};
window.addEventListener("popstate", () => setRoute(location.hash.replace(/^#\/?/, "")));
