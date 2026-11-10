/* 한의학개론 문제은행: 로그인, 문항 받기(Supabase hanui_content), 기록 동기화(hanui_state).
   생물 미니와 같은 Supabase 프로젝트·같은 계정을 쓰고, 표만 따로 쓴다.
   공개 키(publishable)만 들어 있고, 표마다 RLS로 본인(members)만 읽고 쓰게 막아 두었다.
   문항은 저장소·사이트에 없고 로그인해야 받는다. */
(function () {
  const SUPABASE_URL = "https://bdnipfhflsmvfpajuqvn.supabase.co";
  const SUPABASE_KEY = "sb_publishable_fOATSR7SKx0Hh48i6svIgQ_tN7qVpvf";
  const AUTH_KEY = "hanui:auth";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /* ───────── 기기 저장소(IndexedDB): 문항은 커서 localStorage에 안 들어간다 ───────── */
  const idb = {
    open() {
      return new Promise((ok, no) => {
        const r = indexedDB.open("hanui", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
      });
    },
    async run(mode, f) {
      const db = await idb.open();
      return new Promise((ok, no) => {
        const req = f(db.transaction("kv", mode).objectStore("kv"));
        req.onsuccess = () => ok(req.result);
        req.onerror = () => no(req.error);
      });
    },
    get: (k) => idb.run("readonly", (s) => s.get(k)),
    set: (k, v) => idb.run("readwrite", (s) => s.put(v, k)),
    del: (k) => idb.run("readwrite", (s) => s.delete(k)),
  };

  /* ───────── 로그인 세션 ───────── */
  let auth = null;
  try { auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (e) {}
  function saveAuth(a) {
    auth = a;
    try { a ? localStorage.setItem(AUTH_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTH_KEY); } catch (e) {}
  }
  function err(msg, kind) { const e = new Error(msg); if (kind) e[kind] = true; return e; }

  async function call(path, init = {}, useAuth = true) {
    const headers = Object.assign({ apikey: SUPABASE_KEY, "Content-Type": "application/json" }, init.headers || {});
    if (useAuth && auth) headers.Authorization = "Bearer " + auth.access_token;
    try { return await fetch(SUPABASE_URL + path, Object.assign({}, init, { headers })); }
    catch (e) { throw err("서버에 연결하지 못했어요. 인터넷 연결을 확인하세요.", "offline"); }
  }
  async function authFrom(res) {
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const m = j.error_description || j.msg || j.message || "";
      if (/invalid login credentials/i.test(m)) throw err("이메일 또는 비밀번호가 맞지 않아요.", "auth");
      if (/email not confirmed/i.test(m)) throw err("이메일 인증이 아직 안 됐어요.", "auth");
      throw err(m || "로그인하지 못했어요 (" + res.status + ")", "auth");
    }
    return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } };
  }
  async function signIn(email, password) {
    saveAuth(await authFrom(await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }, false)));
  }
  let refreshing = null;
  async function ensureFresh() {
    if (!auth) throw err("로그인이 필요해요.", "auth");
    if (auth.expires_at - 60 > Date.now() / 1000) return;
    if (!refreshing) refreshing = (async () => {
      const res = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: auth.refresh_token }) }, false);
      if (res.status >= 400 && res.status < 500) { saveAuth(null); throw err("로그인이 만료됐어요. 다시 로그인하세요.", "auth"); }
      if (!res.ok) throw err("서버 응답 오류 (" + res.status + ")");
      saveAuth(await authFrom(res));
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function rest(path, init) {
    await ensureFresh();
    const res = await call("/rest/v1/" + path, init);
    if (res.status === 401) { saveAuth(null); throw err("로그인이 만료됐어요. 다시 로그인하세요.", "auth"); }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.code === "42P01" || /hanui_/.test(j.message || "") && /does not exist|schema cache/.test(j.message || "")) throw err("Supabase에 한의학 표가 아직 없어요. hanui/schema.sql을 SQL Editor에서 실행하세요.");
      throw err(j.message || "서버 응답 오류 (" + res.status + ")");
    }
    return res;
  }

  /* ───────── 문항(hanui_content: 행 id = data / jydata) ───────── */
  async function loadContent() {
    const cached = (await idb.get("content").catch(() => null)) || null;
    const rows = cached && cached.owner === auth.user.id ? Object.assign({}, cached.rows) : {};
    try {
      const list = await (await rest("hanui_content?select=id,updated_at")).json();
      const need = list.filter((x) => !rows[x.id] || rows[x.id].updated_at !== x.updated_at).map((x) => x.id);
      for (const id of Object.keys(rows)) if (!list.some((x) => x.id === id)) delete rows[id];
      for (const id of need) {
        setGate("loading", "문항 받는 중… (" + (need.indexOf(id) + 1) + "/" + need.length + ")");
        const got = await (await rest("hanui_content?select=id,data,updated_at&id=eq." + encodeURIComponent(id))).json();
        if (got[0]) rows[id] = got[0];
      }
      if (need.length || !cached) await idb.set("content", { owner: auth.user.id, rows }).catch(() => {});
      return { rows, offline: false };
    } catch (e) {
      if (e.offline && rows.data && rows.jydata) return { rows, offline: true };
      throw e;
    }
  }

  /* 묶음 파일: { format: "hanui-content", rows: [{id, data(문자열)}], progress?: 기록 } */
  function parseBundle(text) {
    let b;
    try { b = JSON.parse(text); } catch (e) { throw err("JSON 파일이 아니에요."); }
    if (b && b.format === "hanui-content" && Array.isArray(b.rows)) return b;
    if (b && b.format === "hanui-progress" && b.state) return { rows: [], progress: b.state };
    throw err("한의학 문제은행 묶음 파일(hanui-content)이 아니에요.");
  }
  async function uploadRows(rows, onMsg) {
    for (let i = 0; i < rows.length; i++) {
      onMsg && onMsg("문항 올리는 중… " + rows[i].id + " (" + (i + 1) + "/" + rows.length + ")");
      await rest("hanui_content?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: rows[i].id, data: rows[i].data }),
      });
    }
  }

  /* ───────── 기록(hanui_state: 사람마다 한 행) ───────── */
  let lastSaved = null;
  async function loadState() {
    const got = await (await rest("hanui_state?select=data&user_id=eq." + auth.user.id)).json();
    if (got[0]) lastSaved = got[0].data;
    return got[0] ? { data: got[0].data } : null;
  }
  async function saveState(o) {
    if (!auth) throw err("로그인이 필요해요.", "auth");
    if (o.data === lastSaved) return;
    await rest("hanui_state?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: auth.user.id, data: o.data }),
    });
    lastSaved = o.data;
  }

  /* ───────── 첫 화면(로그인·문항 올리기) ───────── */
  const gate = () => $("#gate");
  function setGate(kind, msg) {
    const g = gate();
    g.hidden = false;
    $("#appRoot").hidden = true;
    if (kind === "loading") {
      g.innerHTML = `<div class="gate-card"><div class="brand">한의학개론<small>문제은행</small></div><p class="muted">${esc(msg || "불러오는 중…")}</p></div>`;
    } else if (kind === "login") {
      g.innerHTML = `<form class="gate-card" id="loginForm">
        <div class="brand">한의학개론<small>문제은행</small></div>
        <p class="muted" style="margin:0">생물 미니와 같은 계정으로 로그인하세요.</p>
        <label class="field"><span class="flabel">이메일</span><input class="search" type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span class="flabel">비밀번호</span><input class="search" type="password" name="password" autocomplete="current-password" required></label>
        <p class="gate-err" id="gateErr">${esc(msg || "")}</p>
        <button class="btn primary" type="submit">로그인</button>
      </form>`;
      $("#loginForm").onsubmit = async (ev) => {
        ev.preventDefault();
        const f = ev.target, btn = f.querySelector("button");
        btn.disabled = true; $("#gateErr").textContent = "";
        try { await signIn(f.email.value.trim(), f.password.value); boot(); }
        catch (e) { $("#gateErr").textContent = e.message; btn.disabled = false; }
      };
    } else if (kind === "upload") {
      g.innerHTML = `<div class="gate-card">
        <div class="brand">한의학개론<small>문제은행</small></div>
        <p style="margin:0">아직 계정에 올린 문항이 없어요. Claude가 준 묶음 파일(<b>hanui-content….json</b>)을 고르면 문항과 예전 기록이 함께 올라가요.</p>
        <label class="btn primary" style="text-align:center">묶음 파일 고르기<input type="file" accept=".json,application/json" id="bundleFile" hidden></label>
        <p class="gate-err" id="gateErr">${esc(msg || "")}</p>
        <button class="btn ghost" type="button" id="gateOut">로그아웃</button>
      </div>`;
      $("#gateOut").onclick = logout;
      $("#bundleFile").onchange = async (ev) => {
        const file = ev.target.files[0]; if (!file) return;
        try {
          const b = parseBundle(await file.text());
          if (!b.rows.length) throw err("이 파일에는 문항이 없어요.");
          await uploadRows(b.rows, (m) => setGate("loading", m));
          if (b.progress) pendingImport = b.progress;
          boot();
        } catch (e) { setGate("upload", e.message); }
      };
    }
  }

  async function logout() {
    saveAuth(null);
    await idb.del("content").catch(() => {});
    location.reload();
  }

  /* ───────── 기록 화면 아래 '계정·데이터' 칸 ───────── */
  let api = null, pendingImport = null, sync = { k: "local", msg: "" };
  function mountAccount(el) {
    if (!el) return;
    const st = { cloud: "계정에 저장됨", offline: "오프라인 (이 기기에만 저장 중)", error: "저장 실패" + (sync.msg ? " · " + sync.msg : ""), local: "확인 중" }[sync.k] || sync.k;
    el.innerHTML = `<span class="flabel">계정·데이터</span>
      <div class="row" style="justify-content:space-between"><span>${esc(auth ? auth.user.email : "")}</span><span class="muted" style="font-size:13px">${esc(st)}</span></div>
      <div class="row">
        <button class="btn" type="button" data-acc="export">기록 내보내기</button>
        <label class="btn">기록·문항 가져오기<input type="file" accept=".json,application/json" data-acc="import" hidden></label>
        <button class="btn ghost" type="button" data-acc="logout">로그아웃</button>
      </div>
      <p class="muted" style="font-size:12.5px;margin:0">문항을 고치거나 추가하면 Claude가 새 묶음 파일을 줘요. '기록·문항 가져오기'로 고르면 문항이 바뀌고, 기록은 지금 것과 합쳐져요.</p>`;
    el.querySelector('[data-acc="logout"]').onclick = () => { if (confirm("로그아웃할까요? 이 기기에 받아 둔 문항도 지워져요.")) logout(); };
    el.querySelector('[data-acc="export"]').onclick = () => {
      const blob = new Blob([JSON.stringify({ format: "hanui-progress", at: new Date().toISOString(), state: api.exportState() })], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "hanui-기록-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    el.querySelector('[data-acc="import"]').onchange = async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      try {
        const b = parseBundle(await file.text());
        if (b.rows.length) {
          if (!confirm("문항 데이터를 이 파일로 바꿀까요? 기록은 그대로 남아요.")) return;
          if (b.progress) sessionStorage.setItem("hanui:pendingImport", JSON.stringify(b.progress));
          await uploadRows(b.rows, (m) => (el.querySelector(".muted").textContent = m));
          location.reload();
          return;
        }
        if (b.progress) { api.importState(b.progress); alert("기록을 합쳤어요."); }
      } catch (e) { alert(e.message); }
    };
  }

  /* ───────── 시작 ───────── */
  let started = false;
  async function boot() {
    if (!auth) return setGate("login");
    setGate("loading");
    let got;
    try { got = await loadContent(); }
    catch (e) { return e.auth ? setGate("login", e.message) : setGate("loading", e.message + " 새로고침해 보세요."); }
    if (!got.rows.data || !got.rows.jydata) return setGate("upload");
    let D, JD;
    try { D = JSON.parse(got.rows.data.data); JD = JSON.parse(got.rows.jydata.data); }
    catch (e) { return setGate("upload", "받은 문항을 읽지 못했어요. 묶음 파일을 다시 올려 주세요."); }
    if (started) return location.reload();
    started = true;
    gate().hidden = true;
    $("#appRoot").hidden = false;
    $("#brandSub").textContent = "1–15강 문제은행 · " + D.items.length + "문항";
    api = window.startHanui(D, JD, {
      loadState, saveState, mountAccount,
      onSync: (k, msg) => { sync = { k, msg }; },
    });
    try {
      const p = sessionStorage.getItem("hanui:pendingImport");
      if (p) { sessionStorage.removeItem("hanui:pendingImport"); pendingImport = JSON.parse(p); }
    } catch (e) {}
    if (pendingImport) { api.importState(pendingImport); pendingImport = null; }
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  boot();
})();
