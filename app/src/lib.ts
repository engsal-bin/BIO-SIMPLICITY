import { useSyncExternalStore } from "react";
import { TOPICS, TOPIC_CODES } from "./topics";

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
  /** 단원 이름(TOPICS의 name). 데이터에 없으면 topics.ts에서 채운다 */
  topic?: string;
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
  /** 문항이 있는 단원(TOPICS 순서) */
  topics: string[];
  questionsOfTopic: Record<string, Question[]>;
};

export const TOPIC_NAMES = TOPICS.map((t) => t.name);
export const topicShort = (name: string) => TOPICS.find((t) => t.name === name)?.short || name;
const OTHER = "기타";

function topicOf(q: Question): string {
  if (q.topic && TOPIC_NAMES.includes(q.topic)) return q.topic;
  const c = TOPIC_CODES[q.round_id]?.[q.number - 1];
  const i = c ? c.charCodeAt(0) - 65 : -1;
  return i >= 0 && i < TOPICS.length ? TOPICS[i].name : OTHER;
}

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
  const db: DB = { ...raw, q: {}, roundsOf: {}, questionsOf: {}, round: {}, book: {}, topics: [], questionsOfTopic: {} };
  for (const b of db.books) db.book[b.id] = b;
  for (const r of db.rounds) {
    db.round[r.id] = r;
    (db.roundsOf[r.book_id] ||= []).push(r);
  }
  for (const q of db.questions) {
    q.topic = topicOf(q);
    db.q[q.id] = q;
    if (!q.hidden) {
      (db.questionsOf[q.round_id] ||= []).push(q);
      (db.questionsOfTopic[q.topic] ||= []).push(q);
    }
  }
  db.topics = [...TOPIC_NAMES, OTHER].filter((t) => db.questionsOfTopic[t]);
  return db;
}

/* ───────── 채점 ───────── */

/* 빈칸 채점
   - 띄어쓰기·문장부호·대소문자는 무시
   - 같은 뜻의 다른 표기(중탄산염/중탄산이온, -에이스/-아제 등)는 같은 말로 본다
   - 답을 더 길게 쓰거나(「DNA 리가아제」) 일부만 써도(「리가아제」) 낱말 단위로 맞으면 정답
     (「부교감신경」 속 「교감신경」처럼 낱말 안에 숨은 글자는 인정하지 않는다)
   - 오타: 첫 글자가 같고 자모 1~2개만 다르면 정답(영문·숫자가 다르면 안 됨: RNA/DNA, I/II) */

const SYNONYMS: [RegExp, string][] = [
  [/중탄산염|탄산수소이온|탄산수소염|중탄산/g, "중탄산이온"],
  [/중탄산이온이온/g, "중탄산이온"],
  [/결합력|친화력/g, "친화도"],
  [/용적/g, "부피"],
  [/난포/g, "여포"],
  [/갑상선/g, "갑상샘"],
  [/췌장/g, "이자"],
  [/담즙/g, "쓸개즙"],
  [/청소골/g, "이소골"],
  [/털세포|유모세포/g, "유모세포"],
  [/라이페이스|리파제/g, "리파아제"],
  [/카이네이스|키나제/g, "키나아제"],
  [/아밀레이스|아밀라제/g, "아밀라아제"],
  [/세포자멸사|아폽토시스|apoptosis/g, "세포자멸사"],
];

/** 낱말 끝 '-에이스'를 '-아아제'로(헬리케이스 → 헬리카아제, 리게이스 → 리가아제) */
function enzymeForm(s: string): string {
  return s.replace(/([가-힣])이스/g, (m, ch: string) => {
    const c = ch.charCodeAt(0) - 0xac00;
    const vowel = Math.floor((c % 588) / 28); // 0=ㅏ … 5=ㅔ
    if (vowel !== 5 || c % 28 !== 0) return m; // 받침 없는 'ㅔ'일 때만
    return String.fromCharCode(0xac00 + c - 5 * 28) + "아제"; // ㅔ → ㅏ
  });
}

function canon(s: string): string {
  let x = s.toLowerCase().normalize("NFC").replace(/[\s·\-_.,()（）'"`’‘“”=:;~→]/g, "");
  x = enzymeForm(x);
  for (const [re, to] of SYNONYMS) x = x.replace(re, to);
  return x;
}

/** 괄호를 뺀 것, 괄호 안의 것도 정답 후보로 */
function variants(a: string): string[] {
  const out = [a];
  const bare = a.replace(/\([^)]*\)/g, " ").trim();
  if (bare && bare !== a) out.push(bare);
  for (const m of a.matchAll(/\(([^)]*)\)/g)) for (const part of m[1].split(/[,，]/)) if (part.trim()) out.push(part.trim());
  return out;
}

const tokens = (s: string) => s.split(/[\s,·/()（）]+/).map(canon).filter(Boolean);

function windowsEqual(big: string[], target: string): boolean {
  for (let i = 0; i < big.length; i++) {
    let acc = "";
    for (let j = i; j < big.length; j++) {
      acc += big[j];
      if (acc === target) return true;
      if (acc.length >= target.length) break;
    }
  }
  return false;
}

function jamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) {
      out += ch;
      continue;
    }
    out += String.fromCharCode(0x1100 + Math.floor(c / 588), 0x1161 + Math.floor((c % 588) / 28));
    if (c % 28) out += String.fromCharCode(0x11a7 + (c % 28));
  }
  return out;
}

function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}

function closeEnough(x: string, y: string): boolean {
  if (x[0] !== y[0]) return false;
  if (x.replace(/[^a-z0-9]/g, "") !== y.replace(/[^a-z0-9]/g, "")) return false;
  if (x.startsWith(y) || y.startsWith(x) || x.endsWith(y) || y.endsWith(x)) return false;
  const jx = jamo(x);
  const jy = jamo(y);
  const d = lev(jx, jy);
  // 모음만 다르면(다이셔/다이서) 짧아도 오타로 본다. 자음이 다르면(리가아제/리파아제) 긴 말에서만
  const consonants = (j: string) => j.replace(/[\u1161-\u1175]/g, "");
  if (jy.length >= 6 && d === 1 && consonants(jx) === consonants(jy)) return true;
  const allow = jy.length >= 16 ? 2 : jy.length >= 12 ? 1 : 0;
  return allow > 0 && d <= allow;
}

export type BlankHit = "exact" | "typo" | false;

export function blankMatch(input: string, accepted: string[]): BlankHit {
  const x = canon(input || "");
  if (!x) return false;
  const xt = tokens(input || "");
  let typo = false;
  for (const a of accepted.flatMap(variants)) {
    const y = canon(a);
    if (!y) continue;
    if (x === y) return "exact";
    // 낱말 단위로 더 길게/짧게 쓴 경우. '결합', '피질'처럼 짧은 말은 너무 넓게 걸리므로 3글자 이상만
    if (y.length >= 3 && y.length / x.length >= 0.5 && windowsEqual(xt, y)) return "exact";
    if (x.length >= 3 && x.length / y.length >= 0.5 && windowsEqual(tokens(a), x)) return "exact";
    if (closeEnough(x, y)) typo = true;
  }
  return typo ? "typo" : false;
}

export const blankMatches = (input: string, accepted: string[]) => blankMatch(input, accepted) !== false;

export type Resp = number | string[] | string | null | undefined;

export function blankAccepted(q: Question): string[][] {
  return q.accepted_answers.length ? q.accepted_answers : ((q.answer as string[]) || []).map((a) => [a]);
}

/** 채점 결과. s = 부분 점수(0~1, 빈칸은 맞힌 칸 비율), hits = 빈칸별 판정 */
export type GradeDetail = { ok: boolean | null; s?: number; hits?: BlankHit[] };

export function gradeDetail(q: Question, r: Resp): GradeDetail {
  if (q.type === "mcq") return { ok: typeof r === "number" && (q.answer as number[]).includes(r) };
  if (q.type === "blank") {
    const arr = Array.isArray(r) ? r : [];
    const acc = blankAccepted(q);
    if (!acc.length) return { ok: null };
    const hits = acc.map((a, i) => blankMatch(arr[i] || "", a));
    const n = hits.filter(Boolean).length;
    return { ok: n === acc.length, s: n / acc.length, hits };
  }
  return { ok: null };
}

/** true/false = 자동 채점, null = 스스로 채점해야 함 */
export function grade(q: Question, r: Resp): boolean | null {
  return gradeDetail(q, r).ok;
}

/* ───────── 학습 기록 (기기에 저장, 로그인하면 클라우드와 합쳐서 동기화) ───────── */

/** s = 부분 점수(빈칸형), u = 나중에 고친 시각(채점 정정) */
export type Attempt = { q: string; ok: boolean; m: string; t: number; s?: number; u?: number };
export const attemptScore = (a: Attempt) => (typeof a.s === "number" ? a.s : a.ok ? 1 : 0);
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
export type Settings = { theme: "system" | "light" | "dark"; font: "m" | "l"; regraded?: number };
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
  for (const x of [...(a.attempts || []), ...(b.attempts || [])]) {
    if (x.t < resetAt) continue;
    const k = attemptKey(x);
    const old = att.get(k);
    if (!old || (x.u || 0) > (old.u || 0)) att.set(k, x);
  }
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
const REGRADE_VERSION = 1;
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
  record(qid: string, ok: boolean, mode: string, s?: number) {
    const a: Attempt = { q: qid, ok, m: mode, t: Date.now() };
    if (typeof s === "number" && s < 1 && !ok) a.s = Math.round(s * 100) / 100;
    commit({ ...state, attempts: [...state.attempts, a] });
  },
  /** 방금 채점한 것을 고친다(예: '내 답도 맞아요') */
  amendLast(qid: string, ok: boolean) {
    const i = state.attempts.map((a) => a.q).lastIndexOf(qid);
    if (i < 0) return;
    const next = state.attempts.slice();
    const { s: _drop, ...rest } = next[i];
    next[i] = { ...rest, ok, u: Date.now() };
    commit({ ...state, attempts: next });
  },
  /** 채점 기준이 바뀌었을 때 지난 빈칸 답을 새 기준으로 다시 채점한다(한 번만) */
  regradeBlanks(db: DB) {
    if ((state.settings.regraded || 0) >= REGRADE_VERSION) return;
    const sessions = [...state.sessions].sort((x, y) => x.startedAt - y.startedAt);
    const now = Date.now();
    let changed = 0;
    const attempts = state.attempts.map((a) => {
      const q = db.q[a.q];
      // 맞음으로 된 것(직접 '맞아요'로 고친 것 포함)은 건드리지 않고, 틀림만 새 기준으로 다시 본다
      if (!q || q.type !== "blank" || a.m === "flash" || a.u || a.ok) return a;
      const ses = sessions.filter((x) => x.startedAt <= a.t && a.q in x.resps && x.results[a.q] !== undefined).pop();
      if (!ses) return a;
      const g = gradeDetail(q, ses.resps[a.q]);
      if (g.ok === null) return a;
      const s = g.ok ? undefined : Math.round((g.s || 0) * 100) / 100;
      if (g.ok === a.ok && s === a.s) return a;
      changed++;
      const { s: _drop, ...rest } = a;
      return { ...rest, ok: g.ok, ...(s !== undefined ? { s } : {}), u: now };
    });
    let touchedSessions = 0;
    const sesNext = state.sessions.map((x) => {
      let touched = false;
      const results = { ...x.results };
      for (const qid of Object.keys(x.resps)) {
        const q = db.q[qid];
        if (!q || q.type !== "blank" || x.kind === "flash" || results[qid] === undefined || results[qid] === true) continue;
        const g = gradeDetail(q, x.resps[qid]);
        if (g.ok === true) {
          results[qid] = true;
          touched = true;
        }
      }
      if (touched) touchedSessions++;
      return touched ? { ...x, results, u: now } : x;
    });
    commit({ ...state, attempts, sessions: sesNext, settings: { ...state.settings, regraded: REGRADE_VERSION } }, changed + touchedSessions > 0);
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

/* ───────── 단원별 정답률 ───────── */

export type TopicStat = {
  topic: string;
  total: number;
  seen: number;
  /** 처음 풀었을 때 점수 평균(빈칸은 칸 비율) */
  first: number | null;
  /** 가장 최근 점수 평균 */
  recent: number | null;
  /** 문항 수가 적으면 전체 평균 쪽으로 당긴 값. 약한 단원 순서를 정할 때 쓴다 */
  adjusted: number | null;
  weak: boolean;
};

const SHRINK = 12;

let tmemo: { v: number; db: DB | null; out: { list: TopicStat[]; overall: number | null } } = { v: -1, db: null, out: { list: [], overall: null } };
export function topicStats(db: DB): { list: TopicStat[]; overall: number | null } {
  if (tmemo.v === version && tmemo.db === db) return tmemo.out;
  const first: Record<string, number> = {};
  const last: Record<string, number> = {};
  for (const a of [...state.attempts].sort((x, y) => x.t - y.t)) {
    if (!db.q[a.q]) continue;
    if (!(a.q in first)) first[a.q] = attemptScore(a);
    last[a.q] = attemptScore(a);
  }
  const ids = Object.keys(first);
  const overall = ids.length ? ids.reduce((x, id) => x + first[id], 0) / ids.length : null;
  const list: TopicStat[] = db.topics.map((topic) => {
    const qs = db.questionsOfTopic[topic] || [];
    const seen = qs.filter((q) => q.id in first);
    const sumF = seen.reduce((x, q) => x + first[q.id], 0);
    const sumR = seen.reduce((x, q) => x + last[q.id], 0);
    const n = seen.length;
    const adjusted = n && overall !== null ? (sumF + SHRINK * overall) / (n + SHRINK) : null;
    return { topic, total: qs.length, seen: n, first: n ? sumF / n : null, recent: n ? sumR / n : null, adjusted, weak: false };
  });
  if (overall !== null) for (const t of list) t.weak = t.seen >= 8 && t.adjusted !== null && t.adjusted < overall - 0.04;
  tmemo = { v: version, db, out: { list, overall } };
  return tmemo.out;
}

/** 약한 단원(보정 점수 낮은 순). 없으면 빈 배열 */
export function weakTopics(db: DB, max = 3): string[] {
  return topicStats(db)
    .list.filter((t) => t.weak)
    .sort((a, b) => (a.adjusted ?? 1) - (b.adjusted ?? 1))
    .slice(0, max)
    .map((t) => t.topic);
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
