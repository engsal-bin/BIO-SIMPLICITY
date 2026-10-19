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
    if (need.length || !cached) await idb.set("content", { owner: auth!.user.id, rows }).catch(() => {});
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
