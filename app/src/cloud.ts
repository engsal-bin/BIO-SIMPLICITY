/* 클라우드(Supabase): 로그인, 문항 묶음 받기·올리기, 학습 기록 동기화.
   SDK 없이 REST로만 부른다. 공개 키(publishable)만 쓰고, 표마다 RLS로 막아 둔다. */
import { useSyncExternalStore } from "react";
import { Question, RawDB, SyncedState, store, syncedPart } from "./lib";

export const SUPABASE_URL = "https://bdnipfhflsmvfpajuqvn.supabase.co";
export const SUPABASE_KEY = "sb_publishable_fOATSR7SKx0Hh48i6svIgQ_tN7qVpvf";

/* ───────── 상태(화면에 보여줄 것) ───────── */

export type SyncStatus = "off" | "syncing" | "ok" | "offline" | "error";
type CloudState = { email: string | null; status: SyncStatus; lastSync: number | null; error: string };

let cs: CloudState = { email: null, status: "off", lastSync: null, error: "" };
const subs = new Set<() => void>();
function setCS(p: Partial<CloudState>) {
  cs = { ...cs, ...p };
  subs.forEach((f) => f());
}
export function useCloud(): CloudState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => cs,
  );
}

/* ───────── 로그인 세션 ───────── */

type Auth = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } };
const AUTH_KEY = "bioquiz:auth";

function readAuth(): Auth | null {
  try {
    const s = localStorage.getItem(AUTH_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
let auth: Auth | null = readAuth();
if (auth) cs = { ...cs, email: auth.user.email };

function saveAuth(a: Auth | null) {
  auth = a;
  try {
    if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
    else localStorage.removeItem(AUTH_KEY);
  } catch {}
  setCS({ email: a?.user.email ?? null, status: a ? cs.status : "off" });
}

export const isLoggedIn = () => !!auth;

class NetError extends Error {}
class AuthError extends Error {}

async function call(path: string, init: RequestInit = {}, useAuth = true): Promise<Response> {
  const headers: Record<string, string> = { apikey: SUPABASE_KEY, "Content-Type": "application/json", ...(init.headers as any) };
  if (useAuth && auth) headers.Authorization = `Bearer ${auth.access_token}`;
  let res: Response;
  try {
    res = await fetch(SUPABASE_URL + path, { ...init, headers });
  } catch {
    throw new NetError("클라우드 서버에 연결하지 못했어요. 인터넷 연결을 확인하세요.");
  }
  return res;
}

async function authFromResponse(res: Response): Promise<Auth> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = j.error_description || j.msg || j.message || "";
    if (/invalid login credentials/i.test(m)) throw new AuthError("이메일 또는 비밀번호가 맞지 않아요.");
    if (/email not confirmed/i.test(m)) throw new AuthError("이메일 인증이 아직 안 됐어요. Supabase에서 사용자를 확인(Confirm) 처리하세요.");
    throw new AuthError(m || `로그인하지 못했어요 (${res.status})`);
  }
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } };
}

export async function signIn(email: string, password: string) {
  const res = await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }, false);
  saveAuth(await authFromResponse(res));
}

export async function signOut() {
  const a = auth;
  saveAuth(null);
  setCS({ status: "off", lastSync: null, error: "" });
  if (a) call("/auth/v1/logout", { method: "POST", headers: { Authorization: `Bearer ${a.access_token}` } }, false).catch(() => {});
  await idb.del("content").catch(() => {});
}

/** 만료 1분 전이면 미리 새 토큰을 받는다 */
async function ensureFresh() {
  if (!auth) throw new AuthError("로그인이 필요해요.");
  if (auth.expires_at - 60 > Date.now() / 1000) return;
  const res = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: auth.refresh_token }) }, false);
  if (res.status >= 400 && res.status < 500) {
    saveAuth(null);
    throw new AuthError("로그인이 만료됐어요. 다시 로그인하세요.");
  }
  if (!res.ok) throw new NetError(`서버 응답 오류 (${res.status})`);
  saveAuth(await authFromResponse(res));
}

async function rest(path: string, init: RequestInit = {}) {
  await ensureFresh();
  const res = await call("/rest/v1/" + path, init);
  if (res.status === 401) {
    saveAuth(null);
    throw new AuthError("로그인이 만료됐어요. 다시 로그인하세요.");
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.message || `서버 응답 오류 (${res.status})`);
  }
  return res;
}

/* ───────── 문항 묶음(content 표) ───────── */

type ContentRow = { id: string; data: any; updated_at: string };
type CachedContent = { owner: string; rows: Record<string, ContentRow> };

/** 받은 행들을 앱이 쓰는 형태로 합친다. 그림은 data: 주소로 바꿔 넣는다 */
function rowsToRaw(rows: Record<string, ContentRow>): RawDB | null {
  const meta = rows["meta"]?.data;
  if (!meta) return null;
  const questions: Question[] = [];
  for (const r of Object.values(rows)) {
    if (!r.id.startsWith("book:")) continue;
    const imgs: Record<string, string> = r.data.images || {};
    for (const q of r.data.questions as Question[]) {
      questions.push({
        ...q,
        images: (q.images || []).map((p) => imgs[p] || p),
        explanation_images: (q.explanation_images || []).map((p) => imgs[p] || p),
      });
    }
  }
  const order = new Map<string, number>(meta.rounds.map((r: any, i: number) => [r.id, i]));
  questions.sort((a, b) => (order.get(a.round_id)! - order.get(b.round_id)!) || a.number - b.number);
  return { books: meta.books, rounds: meta.rounds, questions };
}

const KNOWN_BOOKS: Record<string, { title: string; year: number }> = {
  b2022: { title: "BIOLOGY 2022", year: 2022 },
  b2024: { title: "BIOLOGY 2024", year: 2024 },
  s2025: { title: "SIMPLICITY 2025", year: 2025 },
  b2026: { title: "TB 최신기출 2026", year: 2026 },
  e2026: { title: "편입생물 평가문제", year: 2026 },
  h2325: { title: "한의대 편입 기출 복원 2023–2025", year: 2025 },
};
const BOOK_ORDER = ["b2022", "b2024", "s2025", "b2026", "e2026", "h2325"];

/** meta(책·회차 목록)에 빠진 책·회차가 있으면 book: 행의 문항에서 되살린다.
    (예전 앱으로 책 하나만 담은 묶음을 올려 meta가 덮어써진 경우) 고칠 게 없으면 null */
function repairMeta(rows: Record<string, ContentRow>): { books: any[]; rounds: any[] } | null {
  const meta = rows["meta"]?.data || { books: [], rounds: [] };
  const books: any[] = [...(meta.books || [])];
  const rounds: any[] = [...(meta.rounds || [])];
  const roundIds = new Set(rounds.map((r) => r.id));
  const bookIds = new Set(books.map((b) => b.id));
  const counts: Record<string, { book: string; n: number }> = {};
  for (const r of Object.values(rows)) {
    if (!r.id.startsWith("book:")) continue;
    for (const q of r.data.questions as Question[]) {
      const c = (counts[q.round_id] ||= { book: q.book_id, n: 0 });
      c.n++;
    }
  }
  let changed = false;
  for (const [rid, c] of Object.entries(counts)) {
    if (roundIds.has(rid)) continue;
    const m = rid.match(/-r(\d+)$/);
    rounds.push({ id: rid, book_id: c.book, number: m ? +m[1] : rounds.length + 1, part: null, time_limit_sec: 420, question_count: c.n });
    changed = true;
    if (!bookIds.has(c.book)) {
      books.push({ id: c.book, ...(KNOWN_BOOKS[c.book] || { title: c.book, year: null }), round_count: 0 });
      bookIds.add(c.book);
    }
  }
  if (!changed) return null;
  const rank = (id: string) => (BOOK_ORDER.indexOf(id) < 0 ? 99 : BOOK_ORDER.indexOf(id));
  books.sort((a, b) => rank(a.id) - rank(b.id));
  for (const b of books) b.round_count = rounds.filter((r) => r.book_id === b.id).length;
  rounds.sort((a, b) => rank(a.book_id) - rank(b.book_id) || a.number - b.number);
  return { ...meta, books, rounds };
}

/** 로그인한 상태에서 문항을 불러온다. 바뀐 행만 새로 받고, 인터넷이 안 되면 기기에 남겨 둔 것을 쓴다.
    반환: 문항(없으면 null = 아직 올린 문항이 없음) */
export async function loadCloudContent(): Promise<{ raw: RawDB | null; offline: boolean }> {
  const cached = (await idb.get<CachedContent>("content").catch(() => null)) || null;
  const rows: Record<string, ContentRow> = cached && cached.owner === auth?.user.id ? { ...cached.rows } : {};
  try {
    const list: { id: string; updated_at: string }[] = await (await rest("content?select=id,updated_at")).json();
    const need = list.filter((x) => rows[x.id]?.updated_at !== x.updated_at).map((x) => x.id);
    for (const id of Object.keys(rows)) if (!list.some((x) => x.id === id)) delete rows[id];
    for (const id of need) {
      const got: ContentRow[] = await (await rest(`content?select=id,data,updated_at&id=eq.${encodeURIComponent(id)}`)).json();
      if (got[0]) rows[id] = got[0];
    }
    const fixed = repairMeta(rows);
    if (fixed) {
      // 되살린 목록을 클라우드에도 저장해 다른 기기도 바로 고쳐지게 한다
      await rest("content?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: "meta", data: fixed }),
      }).catch(() => {});
      rows["meta"] = { id: "meta", data: fixed, updated_at: "" };
    }
    if (need.length || !cached || fixed) await idb.set("content", { owner: auth!.user.id, rows }).catch(() => {});
    return { raw: rowsToRaw(rows), offline: false };
  } catch (e) {
    if (e instanceof NetError && Object.keys(rows).length) return { raw: rowsToRaw(rows), offline: true };
    throw e;
  }
}

/** make_bundle.py로 만든 묶음 파일을 올린다(같은 id는 덮어씀) */
export async function uploadBundle(text: string, onProgress: (msg: string) => void): Promise<number> {
  let b: any;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error("JSON 파일이 아니에요.");
  }
  if (b?.format !== "bioquiz-content" || !Array.isArray(b.rows)) throw new Error("문항 묶음 파일(bioquiz-content)이 아니에요.");
  return uploadRows(b.rows, onProgress);
}

function toDataURL(blob: Blob): Promise<string> {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
}

/** 지금 화면에 불러온 문항(같은 폴더의 파일)을 그대로 묶어서 올린다. 파일을 고를 필요가 없다 */
export async function uploadFromLocal(raw: RawDB, onProgress: (msg: string) => void): Promise<number> {
  const rows: { id: string; data: any }[] = [{ id: "meta", data: { books: raw.books, rounds: raw.rounds } }];
  for (const b of raw.books) {
    const qs = raw.questions.filter((q) => q.book_id === b.id);
    const images: Record<string, string> = {};
    for (const q of qs)
      for (const p of [...(q.images || []), ...(q.explanation_images || [])]) {
        if (images[p] || p.startsWith("data:")) continue;
        onProgress(`그림 모으는 중… ${p}`);
        const res = await fetch(p);
        if (!res.ok) throw new Error(`그림을 읽지 못했어요: ${p}`);
        images[p] = await toDataURL(await res.blob());
      }
    rows.push({ id: `book:${b.id}`, data: { questions: qs, images } });
  }
  return uploadRows(rows, onProgress);
}

/** 올릴 meta(책·회차 목록)를 클라우드에 이미 있는 meta와 합친다.
    같은 id는 새것으로 바꾸고, 묶음에 없는 책·회차는 그대로 둔다(책 하나만 담은 묶음을 올려도 다른 책이 사라지지 않게) */
async function mergeMeta(meta: { books: any[]; rounds: any[] }) {
  const got: { data: any }[] = await (await rest("content?select=data&id=eq.meta")).json();
  const old = got[0]?.data;
  if (!old) return meta;
  const merge = (a: any[], b: any[]) => {
    const byId = new Map(b.map((x) => [x.id, x]));
    const out = a.map((x) => byId.get(x.id) ?? x);
    for (const x of b) if (!a.some((y) => y.id === x.id)) out.push(x);
    return out;
  };
  return { ...old, books: merge(old.books || [], meta.books || []), rounds: merge(old.rounds || [], meta.rounds || []) };
}

async function uploadRows(rows: { id: string; data: any }[], onProgress: (msg: string) => void): Promise<number> {
  rows = await Promise.all(rows.map(async (r) => (r.id === "meta" ? { id: r.id, data: await mergeMeta(r.data) } : r)));
  const b = { rows };
  let n = 0;
  for (const r of b.rows) {
    onProgress(`올리는 중… ${r.id} (${n + 1}/${b.rows.length})`);
    await rest("content?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: r.id, data: r.data }),
    });
    n++;
  }
  return b.rows.reduce((x: number, r: any) => x + (r.data?.questions?.length || 0), 0);
}

/* ───────── 학습 기록 동기화(user_state 표) ───────── */

let syncing: Promise<void> | null = null;
let again = false;

/** 받아서 합치고, 합친 결과를 올린다. 동시에 여러 번 불리면 한 번 더 돌린다 */
export function syncNow(): Promise<void> {
  if (!auth) return Promise.resolve();
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = (async () => {
    setCS({ status: "syncing", error: "" });
    try {
      do {
        again = false;
        const uid = auth!.user.id;
        const got: { state: SyncedState }[] = await (await rest(`user_state?select=state&user_id=eq.${uid}`)).json();
        const remote = got[0]?.state;
        const merged = remote ? store.mergeRemote(remote) : syncedPart(store.get());
        if (!remote || JSON.stringify(merged) !== JSON.stringify(remote)) {
          await rest("user_state?on_conflict=user_id", {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ user_id: uid, state: merged }),
          });
        }
      } while (again);
      setCS({ status: "ok", lastSync: Date.now() });
    } catch (e: any) {
      setCS({ status: e instanceof NetError ? "offline" : "error", error: e.message || String(e) });
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(ms = 2500) {
  if (!auth) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow();
  }, ms);
}

let started = false;
/** 앱이 뜰 때 한 번: 기록이 바뀌면 잠시 뒤 올리고, 앱으로 돌아오거나 인터넷이 다시 되면 맞춘다 */
export function startAutoSync() {
  if (started) return;
  started = true;
  store.onLocalChange(() => schedule());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule(300);
    else if (timer) {
      clearTimeout(timer);
      timer = null;
      syncNow();
    }
  });
  window.addEventListener("online", () => schedule(300));
  setInterval(() => document.visibilityState === "visible" && schedule(0), 5 * 60 * 1000);
}

/* ───────── 기기 저장소(IndexedDB): 문항 묶음은 커서 localStorage에 안 들어간다 ───────── */

const idb = {
  open(): Promise<IDBDatabase> {
    return new Promise((ok, no) => {
      const r = indexedDB.open("bioquiz", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
  },
  async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await idb.open();
    return new Promise((ok, no) => {
      const req = f(db.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => ok(req.result as T);
      req.onerror = () => no(req.error);
    });
  },
  get: <T>(k: string) => idb.run<T>("readonly", (s) => s.get(k)),
  set: (k: string, v: unknown) => idb.run("readwrite", (s) => s.put(v, k)),
  del: (k: string) => idb.run("readwrite", (s) => s.delete(k)),
};
