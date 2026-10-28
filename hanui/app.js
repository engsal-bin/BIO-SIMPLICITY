/* 한의학개론 문제은행 앱 본체. boot.js가 로그인·문항 받기를 마친 뒤 startHanui(문항, 집요데이터, 연결고리)를 부른다. */
window.startHanui = function(D, JD, hooks){
hooks = hooks || {};
const ITEMS = D.items, BYID = {}; ITEMS.forEach(i => BYID[i.id] = i);
const CH = D.chapters;
const PARTS = ['개념','기출','자체','복습'];
const PARTNAME = {'개념':'개념 확인','기출':'기출 변형','자체':'자체 제작','복습':'복습'};
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩';
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const shuffle = a => { a = a.slice(); for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };

/* ---------------- state & persistence ---------------- */
let S = { st:{}, bm:{}, memo:{}, daily:{}, exam:'', prefs:{} };
const LS_KEY = 'hanui-bank-v1';
try { const raw = localStorage.getItem(LS_KEY); if (raw) S = Object.assign(S, JSON.parse(raw)); } catch(e){}
let dbDoc = null, saveTimer = null, syncState = 'local';
function persist(){
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch(e){}
  if (dbDoc){ clearTimeout(saveTimer); saveTimer = setTimeout(() => {
    dbDoc.set({ data: JSON.stringify(S), at: Date.now() }).then(()=>setSync('cloud')).catch(e=>setSync(e && e.offline ? 'offline' : 'error', e && e.message));
  }, 1200); }
}
let syncMsg = '';
function setSync(k, msg){ syncState = k; if (msg !== undefined) syncMsg = msg || ''; const el = $('#syncNote'); if (hooks.onSync) hooks.onSync(k, syncMsg); if (!el) return;
  el.textContent = k==='cloud' ? '기록이 계정에 저장됩니다. 폰과 컴퓨터에서 이어서 풀 수 있어요.'
    : k==='offline' ? '오프라인이에요. 기록은 이 기기에 저장되고, 인터넷이 되면 계정에 올라가요.'
    : k==='error' ? '계정 저장에 실패했어요' + (syncMsg ? ' (' + syncMsg + ')' : '') + '. 이 기기에는 저장돼요.'
    : '기록이 이 기기에만 저장됩니다.'; }
function mergeState(remote){
  // keep the larger counts per item so no device loses progress
  const out = Object.assign({}, S);
  out.st = Object.assign({}, remote.st||{});
  for (const [id,v] of Object.entries(S.st||{})){
    const r = out.st[id]; if (!r || (v.t||0) > (r.t||0)) out.st[id] = v;
  }
  out.bm = Object.assign({}, remote.bm||{}, S.bm||{});
  for (const [k,v] of Object.entries(out.bm)) if (!v) delete out.bm[k];
  out.memo = Object.assign({}, remote.memo||{}, S.memo||{});
  out.daily = Object.assign({}, remote.daily||{}); for (const [d,v] of Object.entries(S.daily||{})) out.daily[d] = Math.max(v, out.daily[d]||0);
  out.exam = S.exam || remote.exam || ''; out.prefs = Object.assign({}, remote.prefs||{}, S.prefs||{});
  out.days = {}; [remote.days||{}, S.days||{}].forEach(src => { for (const [d,m] of Object.entries(src)){ const o = out.days[d] || (out.days[d] = {}); for (const [k,v] of Object.entries(m)) o[k] = (k in o) ? (((o[k]|v)&1) | ((o[k]&v)&2)) : v; } });
  out.rvp = {}; [remote.rvp||{}, S.rvp||{}].forEach(src => { for (const [k,p] of Object.entries(src)){ const o = out.rvp[k] || (out.rvp[k] = { d:[], s:[] }); (p.d||[]).forEach(x => { if (!o.d.includes(x)) o.d.push(x); }); (p.s||[]).forEach(x => { if (!o.s.includes(x) && !o.d.includes(x)) o.s.push(x); }); o.s = o.s.filter(x => !o.d.includes(x)); } });
  /* 카드 탭: 덱·폴더·덱 정리는 마지막에 고친 쪽(u), 카드 기억은 마지막에 넘긴 쪽(t) */
  const newest = (a, b, f) => { const o = Object.assign({}, a||{}); for (const [k,v] of Object.entries(b||{})){ if (!o[k] || f(v) >= f(o[k])) o[k] = v; } return o; };
  out.decks = newest(remote.decks, S.decks, d => d.u||0); out.deckMeta = newest(remote.deckMeta, S.deckMeta, d => d.u||0);
  out.folders = newest(remote.folders, S.folders, d => d.u||0); out.cards = newest(remote.cards, S.cards, c => c.t||0);
  out.routine = {}; [remote.routine||{}, S.routine||{}].forEach((src,li) => { for (const [d,r] of Object.entries(src)){ const o = out.routine[d] || (out.routine[d] = { a:{}, m:{} }); Object.assign(o.a, r.a||{}); if (li===1 || !Object.keys(o.m).length) o.m = Object.assign({}, r.m||{}); } });
  return out;
}
let pulling = null;
function applyRemote(remote){
  if (!remote || !remote.data) return false;
  try { const m = mergeState(JSON.parse(remote.data)); Object.assign(P, m.prefs); m.prefs = P; S = m; applyTheme(); return true; } catch(e){ return false; }
}
/* 계정의 기록을 받아 이 기기 기록과 합친 뒤 다시 올린다 */
function pullCloud(){
  if (!hooks.loadState) { setSync('local'); return Promise.resolve(); }
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      const remote = await hooks.loadState();
      dbDoc = { set: o => hooks.saveState(o) };
      const typing = document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName);
      applyRemote(remote);
      setSync('cloud'); persist();
      if (!typing) render(); else renderChrome();
    } catch(e){
      if (hooks.saveState) dbDoc = { set: o => hooks.saveState(o) };
      setSync(e && e.offline ? 'offline' : 'error', e && e.message);
    } finally { pulling = null; }
  })();
  return pulling;
}
pullCloud();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullCloud(); else if (dbDoc){ clearTimeout(saveTimer); dbDoc.set({ data: JSON.stringify(S), at: Date.now() }).then(()=>setSync('cloud')).catch(e=>setSync(e && e.offline ? 'offline' : 'error', e && e.message)); } });
window.addEventListener('online', () => pullCloud());
setInterval(() => { if (document.visibilityState === 'visible' && syncState !== 'cloud') pullCloud(); }, 60000);

function stOf(id){ return S.st[id] || {w:0,c:0,s:0,l:''}; }
function record(id, ok, guessed){
  const s = Object.assign({w:0,c:0,s:0,l:''}, S.st[id]);
  if (ok && !guessed){ s.c++; s.s = (s.s||0) + 1; s.l = 'o'; }
  else { s.w++; s.s = 0; s.l = 'x'; }
  s.t = Date.now(); S.st[id] = s;
  const d = today(); S.daily[d] = (S.daily[d]||0) + 1;
  rvLog(id, ok && !guessed);
  persist();
}
const GRAD = 2; // 연속 정답 2회면 오답노트에서 졸업
function isActiveWrong(id){ const s = S.st[id]; return s && s.w > 0 && (s.s||0) < (S.prefs.grad ?? GRAD); }
function isFlag(i){ return !!i.flag; }

/* ---------------- text helpers ---------------- */
function plain(h){ const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g,' ').trim(); }
function blanksOf(item){ // list of answer strings in order
  const src = item.type==='card' ? item.body : item.ctx; const out = [];
  (src||[]).forEach(([k,h]) => { h.replace(/<strong>(.*?)<\/strong>/g, (_,x) => { out.push(plain(x)); return ''; }); });
  return out;
}
function cleanAns(a){ return a.replace(/^→\s*/,'').trim(); }
function normAns(a){ return cleanAns(a).replace(/[\s·,.、()（）\[\]「」『』'"]/g,'').toLowerCase(); }
function ansMatch(user, ans){
  const u = normAns(user); if (!u) return false;
  const a = cleanAns(ans);
  const alts = [a, a.replace(/\(.*?\)/g,''), ...a.split(/[\/,·]|\s+또는\s+/)].concat((a.match(/\((.*?)\)/g)||[]).map(x=>x.slice(1,-1)));
  return alts.some(x => normAns(x) && normAns(x) === u);
}
const chName = n => (CH.find(c => c.n===n)||{}).name || '';

/* ---------------- routing ---------------- */
let view = 'home', session = null;
function go(v){ view = v; if (v !== 'quiz' && v !== 'result') session = session && session.done ? session : session; render(); window.scrollTo(0,0); }
const NAV = [['home','홈'],['setup','문제 풀기'],['jy','집요 복습'],['sl','생리학 복습'],['zg','총강 복습'],['cards','카드'],['notes','복습 노트'],['stats','기록']];
function navHTML(cur){
  const wrong = ITEMS.filter(i => isActiveWrong(i.id)).length, bm = Object.keys(S.bm).length;
  return NAV.map(([k,l]) => `<button type="button" data-go="${k}" aria-current="${cur===k||(cur==='quiz'&&k==='setup')||(cur==='result'&&k==='setup')||(String(cur).startsWith('jy')&&k===(typeof JG!=='undefined'?JG:'jy'))}">${l}${k==='notes'?`<span class="cnt">${wrong} · ★${bm}</span>`:''}${k==='cards'&&CARDS?(n => n?`<span class="cnt">${n}</span>`:'')(CARDS.dueCount()):''}</button>`).join('');
}
function renderChrome(){
  $('#nav').innerHTML = navHTML(view);
  const dd = ddayText();
  $('#topbar').innerHTML = navHTML(view) + `<span class="dd">${dd ? '시험 '+dd : ''}</span>`;
  $('#ddayNum').textContent = dd || '–';
  const n = S.daily[today()]||0;
  const days = Object.keys(S.daily).length;
  $('#todayBox').innerHTML = `오늘 ${n}문항 풀이<br>공부한 날 ${days}일`;
  setSync(syncState);
}
function ddayText(){ if (!S.exam) return ''; const t = new Date(S.exam+'T00:00:00'), n = new Date(today()+'T00:00:00');
  const d = Math.round((t-n)/86400000); return d>0 ? 'D-'+d : d===0 ? 'D-day' : 'D+'+(-d); }
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g){ if (g.dataset.go==='cards' && CARDS) CARDS.home(); go(g.dataset.go); }
});
$('#ddayEdit').addEventListener('click', openExamDlg);
function openExamDlg(){
  const dlg = $('#dlg'); dlg.hidden = false;
  dlg.innerHTML = `<div role="dialog" aria-label="시험 날짜"><h2>시험 날짜</h2><input type="date" id="examDate" value="${esc(S.exam)}"><div class="row" style="justify-content:flex-end"><button class="btn ghost" type="button" id="dlgCancel">취소</button><button class="btn primary" type="button" id="dlgOk">저장</button></div></div>`;
  $('#dlgCancel').onclick = () => dlg.hidden = true;
  $('#dlgOk').onclick = () => { S.exam = $('#examDate').value; persist(); dlg.hidden = true; render(); };
}
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(()=>t.hidden=true, 1600); }

function render(){
  rvBackfill();
  renderChrome();
  const v = $('#view');
  if (view==='home') v.innerHTML = homeHTML();
  else if (view==='setup') v.innerHTML = setupHTML();
  else if (view==='quiz') renderQuiz();
  else if (view==='result') v.innerHTML = resultHTML();
  else if (view==='notes') v.innerHTML = notesHTML();
  else if (view==='stats') v.innerHTML = statsHTML();
  else if (view==='rvdone') v.innerHTML = rvDoneHTML();
  else if (view==='cards' && CARDS) CARDS.render(v);
  else if (String(view).startsWith('jy') || view==='sl' || view==='zg') jyRender(v);
  bindView();
  if (String(view).startsWith('jy') || view==='sl' || view==='zg') jyBind();
  rvBind();
  if (view==='cards' && CARDS) CARDS.bind();
  if (view==='stats' && hooks.mountAccount) hooks.mountAccount($('#acctPanel'));
}

/* ---------------- home ---------------- */
function chapterRows(){
  return CH.map(c => {
    const its = ITEMS.filter(i => i.ch===c.n);
    const seen = its.filter(i => S.st[i.id]); const ok = its.filter(i => (S.st[i.id]||{}).l==='o').length;
    const wrong = its.filter(i => isActiveWrong(i.id)).length, bm = its.filter(i => S.bm[i.id]).length;
    const pct = its.length ? Math.round(seen.length/its.length*100) : 0;
    return {c, n:its.length, seen:seen.length, ok, wrong, bm, pct};
  });
}
function homeHTML(){
  const total = ITEMS.length, seen = ITEMS.filter(i => S.st[i.id]).length;
  let tc=0, tw=0; Object.values(S.st).forEach(s => { tc += s.c; tw += s.w; });
  const acc = tc+tw ? Math.round(tc/(tc+tw)*100) : 0;
  const wrong = ITEMS.filter(i => isActiveWrong(i.id)).length;
  const dd = ddayText();
  return `
  <div class="row" style="justify-content:space-between"><h1>오늘도 한 단원씩</h1>${dd?`<span class="tag school" style="font-size:13px">시험 ${dd}</span>`:`<button class="btn" type="button" data-act="exam">시험 날짜 정하기</button>`}</div>
  ${rvRoutineHTML()}
  <div class="stats">
    <div class="stat"><div class="v">${seen}<span class="muted" style="font-size:14px"> / ${total}</span></div><div class="k">한 번 이상 푼 문항</div></div>
    <div class="stat"><div class="v">${acc}%</div><div class="k">누적 정답률</div></div>
    <div class="stat"><div class="v" style="color:var(--bad)">${wrong}</div><div class="k">오답노트에 남은 문항</div></div>
    <div class="stat"><div class="v">${S.daily[today()]||0}</div><div class="k">오늘 푼 문항</div></div>
  </div>
  <div class="row">
    <button class="btn primary" type="button" data-quick="wrong" ${wrong?'':'disabled'}>오답 랜덤으로 다시 풀기</button>
    <button class="btn" type="button" data-quick="weak">약점 우선 30문항</button>
    <button class="btn" type="button" data-quick="new">안 푼 문제 20문항</button>
    <button class="btn" type="button" data-quick="bm" ${Object.keys(S.bm).length?'':'disabled'}>북마크만 풀기</button>
  </div>
  <div class="panel">
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>단원별 진도</h2><span class="muted" style="font-size:12.5px">행을 누르면 그 단원을 바로 풉니다</span></div>
    <div class="tablewrap"><table class="ch"><thead><tr><th>단원</th><th class="num">문항</th><th>진도</th><th class="num hide-sm">최근 정답</th><th class="num">오답</th><th class="num">★</th></tr></thead><tbody>
    ${chapterRows().map(r => `<tr class="click" data-chq="${r.c.n}"><td><b>${r.c.n}강</b> ${esc(r.c.name)}</td><td class="num">${r.n}</td><td><div class="bar"><i style="width:${r.pct}%"></i></div></td><td class="num hide-sm">${r.ok}</td><td class="num" style="color:${r.wrong?'var(--bad)':'inherit'}">${r.wrong}</td><td class="num">${r.bm}</td></tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

/* ---------------- setup ---------------- */
const P = S.prefs;
function pdef(k, v){ if (P[k]===undefined) P[k] = v; return P[k]; }
pdef('chs', CH.map(c=>c.n)); pdef('parts', PARTS.slice()); pdef('pool','all'); pdef('order','random'); pdef('shuffleOpts', true);
pdef('blank','choice'); pdef('mode','study'); pdef('count', 30); pdef('school','all');
function chipGroup(name, opts, val, multi){
  return `<div class="chips" role="group">` + opts.map(([v,l]) => {
    const on = multi ? val.includes(v) : val===v;
    return `<button type="button" class="chip" data-pref="${name}" data-v="${esc(v)}" data-multi="${multi?1:0}" aria-pressed="${on}">${l}</button>`;
  }).join('') + `</div>`;
}
function poolItems(){
  return ITEMS.filter(i => P.chs.includes(i.ch) && P.parts.includes(i.part) && (P.school==='all' || i.school===P.school) && !(P.noFlag && i.flag && P.pool!=='flag'))
    .filter(i => {
      const s = S.st[i.id];
      switch(P.pool){
        case 'wrong': return isActiveWrong(i.id);
        case 'everwrong': return s && s.w>0;
        case 'bm': return !!S.bm[i.id];
        case 'new': return !s;
        case 'weak': return s && s.w >= 2;
        case 'flag': return isFlag(i);
        case 'conflict': return !!(i.rv && (i.rv.v==='conflict'||i.rv.v==='fixed'));
        default: return true;
      }
    });
}
function setupHTML(){
  const schools = [...new Set(ITEMS.map(i=>i.school).filter(Boolean))].sort();
  const n = poolItems().length;
  return `
  <h1>문제 풀기</h1>
  <div class="panel field"><span class="flabel">단원</span>
    ${chipGroup('chs', CH.map(c=>[c.n, c.n+'강 '+c.name]), P.chs, true)}
    <div class="row"><button class="btn ghost" type="button" data-act="chall">전체 선택</button><button class="btn ghost" type="button" data-act="chnone">전체 해제</button></div>
  </div>
  <div class="grid2">
    <div class="panel field"><span class="flabel">파트</span>${chipGroup('parts', PARTS.map(p=>[p, PARTNAME[p]]), P.parts, true)}
      <span class="flabel" style="margin-top:6px">출제 학교 (기출)</span>${chipGroup('school', [['all','전체'], ...schools.map(s=>[s,s])], P.school, false)}</div>
    <div class="panel field"><span class="flabel">어떤 문제를</span>${chipGroup('pool', [['all','전체'],['new','안 푼 문제'],['wrong','오답노트'],['everwrong','한 번이라도 틀린 문제'],['weak','2번 이상 틀린 문제'],['bm','북마크'],['flag','검토 필요(모순+추가 검토)'],['conflict','단권화 기준 수정']], P.pool, false)}</div>
    <div class="panel field"><span class="flabel">순서</span>${chipGroup('order', [['seq','교재 순서'],['random','랜덤'],['weak','약점 우선']], P.order, false)}
      <span class="flabel" style="margin-top:6px">선지</span>${chipGroup('shuffleOpts', [[true,'선지 섞기'],[false,'원래 순서']], P.shuffleOpts, false)}</div>
    <div class="panel field"><span class="flabel">빈칸 문제 푸는 방식</span>${chipGroup('blank', [['choice','선지형 (보기에서 고르기)'],['short','단답형 (직접 입력)'],['reveal','가리기 (눌러서 확인 후 자가채점)']], P.blank, false)}
      <span class="flabel" style="margin-top:6px">채점</span>${chipGroup('mode', [['study','바로 채점 (학습)'],['exam','끝나고 채점 (시험)']], P.mode, false)}</div>
  </div>
  <div class="panel row" style="justify-content:space-between">
    <div class="row"><label class="flabel" for="cnt">문항 수</label>
      <select id="cnt" class="btn">${[10,20,30,50,100,0].map(v=>`<option value="${v}" ${+P.count===v?'selected':''}>${v||'전부'}</option>`).join('')}</select>
      <label class="row muted" style="gap:6px"><input type="checkbox" id="noFlag" ${P.noFlag?'checked':''}> 해설 검수 필요 문항 빼기</label>
      <span class="muted">조건에 맞는 문항 <b style="color:var(--ink)">${n}</b>개</span></div>
    <button class="btn primary" type="button" data-act="start" ${n?'':'disabled'}>시작</button>
  </div>`;
}
function startSession(list, opts={}){
  if (!list.length){ toast('조건에 맞는 문항이 없어요'); return; }
  let order = P.order;
  if (opts.order) order = opts.order;
  let L = list.slice();
  if (order==='random') L = shuffle(L);
  else if (order==='weak') L = shuffle(L).sort((a,b) => weakScore(b) - weakScore(a));
  const cnt = opts.count ?? +P.count; if (cnt) L = L.slice(0, cnt);
  session = { ids: L.map(i=>i.id), i: 0, ans: {}, mode: opts.mode || P.mode, done:false, started: Date.now(), title: opts.title || '', review: opts.review || null };
  view = 'quiz'; render(); window.scrollTo(0,0);
}
function weakScore(i){ const s = S.st[i.id]; if (!s) return 0.5; return (s.w+1)/(s.c+s.w+2) + (s.l==='x'?0.5:0) - (s.s||0)*0.15; }

/* ---------------- quiz ---------------- */
let QS = null; // per-question UI state
function buildQS(item){
  session.qs = session.qs || {};
  if (session.qs[item.id]) return session.qs[item.id];
  const qs = { sel: [], blanks: [], active: 0, submitted: false, guessed: false };
  if (item.type==='mcq'){
    const idx = item.opts.map((o,k)=>k);
    const allCombos = item.opts.length && item.opts.every(o => /^[ㄱ-ㅎ가-하A-E,\s]+$/.test(o.text));
    qs.order = (P.shuffleOpts && !allCombos && item.opts.every(o=>o.text)) ? shuffle(idx) : idx;
  }
  if (item.type==='card' || item.type==='open'){
    const ans = blanksOf(item);
    qs.blanks = ans.map(a => ({ ans: a, val: '', res: null, shown: false, opts: null }));
  }
  session.qs[item.id] = qs;
  return qs;
}
function distractors(item, k){
  const ans = cleanAns(QS.blanks[k].ans);
  const uniq = [...new Set(QS.blanks.map(b => cleanAns(b.ans)))];
  let pool = uniq.filter(a => a !== ans);
  const closedSet = uniq.length <= 5 && QS.blanks.length >= uniq.length + 1;
  if (pool.length < 4 && !closedSet){
    const more = [];
    ITEMS.forEach(i => { if (i.ch===item.ch && (i.type==='card'||i.type==='open') && i.id!==item.id) blanksOf(i).forEach(a => more.push(cleanAns(a))); });
    const L = ans.length;
    const near = shuffle([...new Set(more)].filter(a => a!==ans && !pool.includes(a))).sort((a,b) => Math.abs(a.length-L) - Math.abs(b.length-L));
    pool = pool.concat(near.slice(0, 8));
  }
  if (closedSet) return uniq.slice().sort();
  const pick = shuffle(pool).slice(0, Math.min(4, pool.length));
  return shuffle([ans, ...pick]);
}
function renderBlanksHTML(html, startIdx, interactive){
  let k = startIdx;
  return html.replace(/<strong>(.*?)<\/strong>/g, () => {
    const idx = k++; const b = QS.blanks[idx];
    if (!b) return '';
    return blankHTML(idx, b, interactive);
  });
}
function blankHTML(idx, b, interactive){
  const ans = esc(cleanAns(b.ans));
  const long = cleanAns(b.ans).length > 14;
  if (QS.submitted || b.shown){
    if (P.blank==='reveal' || b.res===null || b.skip) return `<span class="blank shown">${ans}</span>`;
    if (b.res) return `<span class="blank ok">${ans}</span>`;
    return `<span class="blank no">${esc(b.val)||'—'}</span><span class="ans-note">→ ${ans}</span><button type="button" class="fix" data-fix="${idx}">맞은 걸로</button>`;
  }
  if (P.blank==='short' && !long)
    return `<span class="blank${QS.active===idx?' active':''}"><input id="bl${idx}" data-bi="${idx}" value="${esc(b.val)}" aria-label="빈칸 ${idx+1}" autocomplete="off" size="${Math.max(4, Math.min(16, cleanAns(b.ans).length*2))}"></span>`;
  if (P.blank==='reveal' || (P.blank==='short' && long))
    return `<button type="button" class="blank" data-reveal="${idx}">${'　'.repeat(Math.min(6, Math.max(2, Math.ceil(cleanAns(b.ans).length/3))))}${idx+1}</button>`;
  return `<button type="button" class="blank${QS.active===idx?' active':''}${b.val?' filled':''}" data-bsel="${idx}">${b.val?esc(b.val):'　'+(idx+1)+'　'}</button>`;
}
function ctxHTML(item, interactive){
  const src = item.type==='card' ? item.body : item.ctx;
  let k = 0;
  return (src||[]).map(([kind,h]) => {
    const cnt = (h.match(/<strong>/g)||[]).length;
    let out;
    if (item.type==='mcq' || item.type==='multi'){
      // hide answers inside passages until graded
      out = QS.submitted ? h.replace(/<strong>(.*?)<\/strong>/g, '<span class="blank shown">$1</span>')
                         : h.replace(/<strong>(.*?)<\/strong>/g, '<span class="blank">　　</span>');
    } else { out = renderBlanksHTML(h, k, interactive); k += cnt; }
    const cls = kind==='q' ? 'q' : kind==='h' ? 'h' : '';
    return `<div class="${cls}" style="min-width:0;overflow-x:auto">${out}</div>`;
  }).join('');
}
function renderQuiz(){
  const v = $('#view');
  if (!session){ view='setup'; render(); return; }
  const id = session.ids[session.i], item = BYID[id];
  QS = buildQS(item);
  if (item.type!=='mcq' && item.type!=='multi' && P.blank==='choice' && !QS.submitted){
    const b = QS.blanks[QS.active]; if (b && !b.opts) b.opts = distractors(item, QS.active);
  }
  const st = stOf(id);
  const total = session.ids.length;
  const answered = Object.keys(session.ans).length;
  const head = (session.review ? rvPhaseLabel() : '') + `
  <div class="qhead"><div class="row"><button class="btn ghost" type="button" data-act="quit">← 그만하기</button><span class="muted" style="font-variant-numeric:tabular-nums">${session.i+1} / ${total}</span>${session.mode==='exam'?`<span class="tag">시험 모드</span>`:''}</div>
    <span class="kbd hide-sm"><kbd>1</kbd>–<kbd>5</kbd> 선택 · <kbd>Enter</kbd> 채점/다음 · <kbd>B</kbd> 북마크 · <kbd>←</kbd><kbd>→</kbd> 이동</span></div>
  <div class="progress"><i style="width:${Math.round(answered/total*100)}%"></i></div>`;
  const meta = `<div class="meta">
    <span class="tag">${item.ch}강 ${esc(chName(item.ch))}</span><span class="tag">${PARTNAME[item.part]}${item.num?' '+item.num+'번':''}${item.sub?' ('+item.sub+')':''}</span>
    ${item.school?`<span class="tag school">${esc(item.school)}</span>`:''}${item.topic?`<span class="tag">${esc(item.topic)}</span>`:''}
    ${session.review?rvTagsHTML('b:'+id):''}${st.w?`<span class="tag bad">${st.w}번 틀림</span>`:''}${st.c?`<span class="tag">${st.c}번 맞힘</span>`:''}
    ${((i)=>(i.rv?(i.rv.v==='conflict'?'<span class="tag bad">단권화와 모순</span>':i.rv.v==='check'?'<span class="tag warn">추가 검토 필요</span>':i.rv.v==='fixed'?'<span class="tag school">단권화 기준 수정</span>':'<span class="tag school">단권화 확인</span>'):(i.flag?'<span class="tag warn">해설 검수 필요</span>':'')))(item)}</div>`;
  const stem = item.type==='card' ? esc(item.title || '빈칸을 채우세요') : esc(item.stem);
  let body = '';
  if (item.img) body += `<img class="figure" src="${item.img}" alt="문제 그림">`;
  body += `<div class="ctx">${ctxHTML(item, true)}</div>`;
  if (item.stmts && item.stmts.length){
    const selectable = item.type==='multi';
    body += `<div class="stmts">` + item.stmts.map(s => {
      let cls = '';
      if (selectable && QS.submitted){
        const on = QS.sel.includes(s.label), right = item.answer.includes(s.label);
        cls = on && right ? 'ok' : on && !right ? 'no' : !on && right ? 'miss' : '';
      }
      return selectable
        ? `<button type="button" class="stmt ${cls}" data-stmt="${esc(s.label)}" aria-pressed="${QS.sel.includes(s.label)}" ${QS.submitted?'disabled':''}>${s.html}</button>`
        : `<div class="stmt static">${s.html}</div>`;
    }).join('') + `</div>`;
    if (selectable && !QS.submitted) body += `<p class="muted" style="margin:0;font-size:13px">옳은 것을 모두 눌러 고른 뒤 채점하세요.</p>`;
  }
  if (item.type==='mcq'){
    body += `<div class="opts">` + QS.order.map((oi, pos) => {
      const o = item.opts[oi]; let cls = '';
      if (QS.submitted){ if (item.answer.includes(o.n)) cls='ok'; else if (QS.sel.includes(oi)) cls='no'; }
      const label = o.text || `${CIRC[o.n-1]}번 행`;
      return `<button type="button" class="opt ${cls}" data-opt="${oi}" aria-pressed="${QS.sel.includes(oi)}" ${QS.submitted?'disabled':''}><span class="n">${CIRC[pos]}</span><span style="min-width:0">${esc(label)}</span></button>`;
    }).join('') + `</div>`;
  }
  let tray = '';
  if ((item.type==='card'||item.type==='open') && P.blank==='choice' && !QS.submitted){
    const b = QS.blanks[QS.active];
    if (b){ tray = `<div class="tray" role="group" aria-label="빈칸 ${QS.active+1} 보기"><span class="lbl">빈칸 ${QS.active+1}에 들어갈 말 · 숫자키로 선택</span>${b.opts.map((o,k)=>`<button type="button" data-pick="${esc(o)}">${k+1}. ${esc(o)}</button>`).join('')}</div>`; }
  }
  let fb = '';
  if (QS.submitted && session.mode==='study' || (QS.submitted && session.done)){
    const r = session.ans[id];
    const verdict = r ? (r.ok ? (r.guessed?'맞혔지만 찍음으로 기록':'정답') : '오답') : '';
    let ansTxt = '';
    if (item.type==='mcq') ansTxt = '정답: ' + item.answer.map(n => { const pos = QS.order.indexOf(item.opts.findIndex(o=>o.n===n)); return CIRC[pos] + (item.opts.find(o=>o.n===n).text ? ' '+esc(item.opts.find(o=>o.n===n).text) : ''); }).join(', ');
    if (item.type==='multi') ansTxt = '정답: ' + item.answer.join(', ');
    if (item.type==='card'||item.type==='open'){ const okc = QS.blanks.filter(b=>b.res).length; ansTxt = P.blank==='reveal' ? '' : `빈칸 ${QS.blanks.length}개 중 ${okc}개 정답`; }
    fb = `<div class="feedback ${r? (r.ok&&!r.guessed?'ok':'no') : 'neutral'}"><span class="verdict">${verdict}</span>${ansTxt?`<span>${ansTxt}</span>`:''}${item.expl&&item.expl.length?`<div class="expl"><b>근거</b> ${item.expl.join('<br>')}</div>`:''}${((i)=>(i.rv?`<div class="expl"><b>단권화 검토</b> ${esc(i.rv.n)}${i.rv.s&&i.rv.s!=='-'?`<br><span class="muted" style="font-size:13px">근거 위치: ${esc(i.rv.s)}</span>`:''}</div>`:''))(item)}</div>`;
  }
  const memo = S.memo[id]||'';
  const canSubmit = !QS.submitted;
  const selfGrade = (item.type==='card'||item.type==='open') && P.blank==='reveal' && !QS.submitted;
  const actions = `<div class="actions">
    <div class="row"><button type="button" class="star" data-act="bm" aria-pressed="${!!S.bm[id]}" aria-label="북마크">${S.bm[id]?'★':'☆'}</button>
      ${!QS.submitted && !selfGrade ? `<label class="row muted" style="font-size:13px;gap:6px"><input type="checkbox" id="guess" ${QS.guessed?'checked':''}> 찍음 (맞아도 오답노트에 남기기)</label>`:''}</div>
    <div class="row">
      <button class="btn" type="button" data-act="prev" ${session.i? '':'disabled'}>이전</button>
      ${session.review && !QS.submitted ? `<button class="btn ghost" type="button" data-act="rvskip" title="풀지 않고 완료로 넘기기">넘기기</button>` : ''}
      ${selfGrade ? `<button class="btn" type="button" data-act="self-x">모름</button><button class="btn primary" type="button" data-act="self-o">외웠음</button>`
        : canSubmit ? `<button class="btn primary" type="button" data-act="submit">${session.mode==='exam'?'답 저장':'채점'}</button>`
        : `<button class="btn primary" type="button" data-act="next">${session.i+1<total?'다음':session.review?'다음 단계':'결과 보기'}</button>`}
    </div></div>
    <details class="memo-d" ${memo?'open':''}><summary>메모${memo?' (있음)':''}</summary><textarea class="memo" id="memo" placeholder="헷갈린 포인트, 교재 쪽수, 해설 이의 등을 적어 두세요.">${esc(memo)}</textarea></details>`;
  v.innerHTML = head + `<div class="qcard">${meta}<div class="stem">${stem}</div>${body}${fb}${actions}</div>` + tray;
  bindQuiz(item);
}
function bindQuiz(item){
  const v = $('#view');
  v.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
    const oi = +b.dataset.opt;
    if (item.answer.length > 1){ QS.sel = QS.sel.includes(oi) ? QS.sel.filter(x=>x!==oi) : [...QS.sel, oi]; }
    else QS.sel = [oi];
    if (session.mode==='study' && item.answer.length===1 && P.instant !== false){ submit(item); return; }
    renderQuiz();
  });
  v.querySelectorAll('[data-stmt]').forEach(b => b.onclick = () => { const l = b.dataset.stmt; QS.sel = QS.sel.includes(l) ? QS.sel.filter(x=>x!==l) : [...QS.sel, l]; renderQuiz(); });
  v.querySelectorAll('[data-bsel]').forEach(b => b.onclick = () => { QS.active = +b.dataset.bsel; const bb = QS.blanks[QS.active]; if (!bb.opts) bb.opts = distractors(item, QS.active); renderQuiz(); });
  v.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => pickBlank(item, b.dataset.pick));
  v.querySelectorAll('[data-reveal]').forEach(b => b.onclick = () => { QS.blanks[+b.dataset.reveal].shown = true; renderQuiz(); });
  v.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => { const k = +b.dataset.fix; QS.blanks[k].res = true; regrade(item); });
  v.querySelectorAll('input[data-bi]').forEach(inp => {
    inp.oninput = () => { QS.blanks[+inp.dataset.bi].val = inp.value; };
    inp.onfocus = () => { QS.active = +inp.dataset.bi; };
    inp.onkeydown = e => { if (e.key==='Enter'){ e.preventDefault(); e.stopPropagation();
      const all = [...v.querySelectorAll('input[data-bi]')]; const i = all.indexOf(inp);
      if (i < all.length-1) all[i+1].focus(); else submit(item); } };
  });
  const g = $('#guess'); if (g) g.onchange = () => { QS.guessed = g.checked; };
  const memo = $('#memo'); if (memo) memo.oninput = () => { const t = memo.value.trim(); if (t) S.memo[item.id] = memo.value; else delete S.memo[item.id]; persist(); };
  bindView();
  if (P.blank==='short' && !QS.submitted){ const f = v.querySelector('input[data-bi]'); if (f && !v.contains(document.activeElement)) setTimeout(()=>{ const a = v.querySelector(`#bl${QS.active}`) || f; a.focus(); }, 0); }
}
function pickBlank(item, val){
  const b = QS.blanks[QS.active]; b.val = val;
  const next = QS.blanks.findIndex((x,i) => i > QS.active && !x.val);
  const any = QS.blanks.findIndex(x => !x.val);
  if (next >= 0) QS.active = next; else if (any >= 0) QS.active = any;
  else { renderQuiz(); return; }
  const nb = QS.blanks[QS.active]; if (!nb.opts) nb.opts = distractors(item, QS.active);
  renderQuiz();
}
function gradeItem(item){
  if (item.type==='mcq'){
    const picked = QS.sel.map(oi => item.opts[oi].n).sort();
    return picked.length && JSON.stringify(picked) === JSON.stringify(item.answer.slice().sort());
  }
  if (item.type==='multi') return JSON.stringify(QS.sel.slice().sort()) === JSON.stringify(item.answer.slice().sort());
  QS.blanks.forEach(b => { if (b.res !== null) return; if (P.blank==='short' && cleanAns(b.ans).length > 14){ b.skip = true; b.res = true; return; } b.res = P.blank==='choice' ? cleanAns(b.val)===cleanAns(b.ans) : ansMatch(b.val, b.ans); });
  return QS.blanks.every(b => b.res);
}
function submit(item, selfOk){
  if (QS.submitted) return;
  if (item.type==='mcq' && !QS.sel.length){ toast('보기를 고르세요'); return; }
  let ok;
  if (selfOk !== undefined){ ok = selfOk; QS.blanks.forEach(b => { b.shown = true; }); }
  else ok = gradeItem(item);
  QS.submitted = true;
  session.ans[item.id] = { ok, guessed: QS.guessed, qs: QS };
  if (session.mode==='study') record(item.id, ok, QS.guessed);
  if (session.review) rvMark('b:'+item.id);
  if (session.mode==='exam'){ nextQ(); return; }
  renderQuiz();
}
function regrade(item){
  const r = session.ans[item.id]; if (!r) return;
  const ok = QS.blanks.every(b => b.res);
  if (ok && !r.ok){
    r.ok = true;
    if (session.mode==='study'){ const s = S.st[item.id]; if (s){ s.w = Math.max(0, s.w-1); s.c++; s.s = (s.s||0)+1; s.l='o'; persist(); } rvFix(item.id); }
  }
  renderQuiz();
}
function nextQ(){
  if (session.i + 1 < session.ids.length){ session.i++; renderQuiz(); window.scrollTo(0,0); }
  else finish();
}
function finish(){
  if (session.review && session.mode==='study'){ rvNextPhase(); return; }
  if (session.mode==='exam' && !session.done){
    session.ids.forEach(id => { const r = session.ans[id]; if (r) record(id, r.ok, r.guessed); });
  }
  session.done = true; view = 'result'; render(); window.scrollTo(0,0);
}
document.addEventListener('keydown', e => {
  if (view !== 'quiz' || !session) return;
  if (e.target.matches('textarea, input[type=date]')) return;
  const inInput = e.target.matches('input[data-bi]');
  const item = BYID[session.ids[session.i]];
  if (e.key==='Enter' && !inInput){ e.preventDefault(); if (!QS.submitted){ if (item.type==='card'||item.type==='open'){ if (P.blank!=='reveal') submit(item); } else submit(item); } else nextQ(); return; }
  if (inInput) return;
  if (e.key==='ArrowRight'){ if (session.i+1 < session.ids.length){ session.i++; renderQuiz(); } return; }
  if (e.key==='ArrowLeft'){ if (session.i){ session.i--; renderQuiz(); } return; }
  if (e.key==='b' || e.key==='B'){ toggleBm(item.id); renderQuiz(); return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && !QS.submitted){
    if (item.type==='mcq' && n <= QS.order.length){ $(`[data-opt="${QS.order[n-1]}"]`).click(); }
    else if (item.type==='multi' && item.stmts[n-1]){ $(`[data-stmt="${item.stmts[n-1].label}"]`).click(); }
    else if (P.blank==='choice' && (item.type==='card'||item.type==='open')){ const b = QS.blanks[QS.active]; if (b && b.opts[n-1]) pickBlank(item, b.opts[n-1]); }
  }
});
function toggleBm(id){ if (S.bm[id]) delete S.bm[id]; else S.bm[id] = Date.now(); persist(); toast(S.bm[id] ? '북마크했어요' : '북마크를 뺐어요'); }

/* ---------------- result ---------------- */
function resultHTML(){
  const ids = session.ids; const rs = ids.map(id => session.ans[id]);
  const done = rs.filter(Boolean).length, ok = rs.filter(r => r && r.ok && !r.guessed).length;
  const wrongIds = ids.filter(id => { const r = session.ans[id]; return !r || !r.ok || r.guessed; });
  const mins = Math.max(1, Math.round((Date.now()-session.started)/60000));
  return `<h1>결과</h1>
  <div class="panel row" style="justify-content:space-between;align-items:flex-end">
    <div><div class="result-big">${ok}<span class="muted" style="font-size:20px"> / ${ids.length}</span></div><div class="muted">${done}문항 풀이 · 약 ${mins}분</div></div>
    <div class="row"><button class="btn" type="button" data-act="retry-wrong" ${wrongIds.length?'':'disabled'}>틀린 ${wrongIds.length}문항 다시</button><button class="btn primary" type="button" data-go="setup">새로 풀기</button></div>
  </div>
  ${wrongIds.length ? `<h2>틀렸거나 찍은 문항</h2><div class="notech">${wrongIds.map(id => noteItemHTML(BYID[id])).join('')}</div>` : `<div class="empty">모두 맞혔어요.</div>`}`;
}

/* ---------------- notes ---------------- */
let NF = { kind:'wrong', q:'', sort:'count' };
function answerSummary(item){
  if (item.type==='mcq') return item.answer.map(n => { const o = item.opts.find(o=>o.n===n); return CIRC[n-1] + ' ' + esc(o.text); }).join('<br>');
  if (item.type==='multi') return item.answer.join(', ');
  return blanksOf(item).map((a,k) => `<span>${k+1}. ${esc(cleanAns(a))}</span>`).join(' ');
}
function noteItemHTML(i){
  const s = stOf(i.id);
  const title = i.type==='card' ? (i.title||'빈칸 채우기') + (i.sub?` (${i.sub})`:'') : (i.num+'. '+i.stem);
  return `<div class="nitem"><div class="top"><div class="s">${esc(title)}</div>
    <div class="row" style="gap:4px"><span class="cnt" style="color:${s.w?'var(--bad)':'var(--ink3)'}">틀림 ${s.w} · 맞음 ${s.c}</span><button type="button" class="star" data-bmid="${i.id}" aria-pressed="${!!S.bm[i.id]}" aria-label="북마크">${S.bm[i.id]?'★':'☆'}</button></div></div>
    <div class="meta"><span class="tag">${PARTNAME[i.part]}</span>${i.school?`<span class="tag school">${esc(i.school)}</span>`:''}${s.l==='x'?'<span class="tag bad">최근 오답</span>':''}${isActiveWrong(i.id)?'':s.w?'<span class="tag">졸업</span>':''}${(i.rv?(i.rv.v==='conflict'?'<span class="tag bad">단권화와 모순</span>':i.rv.v==='check'?'<span class="tag warn">추가 검토 필요</span>':i.rv.v==='fixed'?'<span class="tag school">단권화 기준 수정</span>':'<span class="tag school">단권화 확인</span>'):(i.flag?'<span class="tag warn">해설 검수 필요</span>':''))}</div>
    <details><summary>정답·근거 보기</summary><div class="ansline"><div>${answerSummary(i)}</div>${i.expl&&i.expl.length?`<div class="muted">${i.expl.join('<br>')}</div>`:''}${S.memo[i.id]?`<div><b>메모</b> ${esc(S.memo[i.id])}</div>`:''}${(i.rv?`<div class="expl"><b>단권화 검토</b> ${esc(i.rv.n)}${i.rv.s&&i.rv.s!=='-'?`<br><span class="muted" style="font-size:13px">근거 위치: ${esc(i.rv.s)}</span>`:''}</div>`:'')}</div></details>
    <div class="row"><button class="btn" type="button" data-one="${i.id}">이 문항 풀기</button></div></div>`;
}
function notesFiltered(){
  const q = NF.q.trim().toLowerCase();
  return ITEMS.filter(i => {
    const s = S.st[i.id];
    if (NF.kind==='wrong' && !isActiveWrong(i.id)) return false;
    if (NF.kind==='ever' && !(s && s.w)) return false;
    if (NF.kind==='bm' && !S.bm[i.id]) return false;
    if (NF.kind==='memo' && !S.memo[i.id]) return false;
    if (NF.kind==='flag' && !i.flag) return false;
    if (NF.kind==='conflict' && !(i.rv && (i.rv.v==='conflict'||i.rv.v==='fixed'))) return false;
    if (!rvPerOK('b', i.id)) return false;
    if (q){ const hay = ((i.stem||'')+(i.title||'')+(i.opts||[]).map(o=>o.text).join(' ')+(i.stmts||[]).map(x=>plain(x.html)).join(' ')).toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  });
}
function notesBankHTML(){
  const list = notesFiltered();
  const sorter = NF.sort==='count' ? (a,b) => stOf(b.id).w - stOf(a.id).w : NF.sort==='recent' ? (a,b) => (stOf(b.id).t||0) - (stOf(a.id).t||0) : () => 0;
  const groups = CH.map(c => ({c, its: list.filter(i => i.ch===c.n).sort(sorter)})).filter(g => g.its.length);
  return `<div class="panel field">
    ${chipGroupNF('kind', [['wrong','오답노트'],['ever','한 번이라도 틀림'],['bm','북마크'],['memo','메모'],['flag','검토 필요'],['conflict','단권화 기준 수정']], NF.kind)}
    ${perChips()}
    <div class="row"><input class="search" id="nq" type="search" placeholder="문제 내용으로 찾기 (예: 命門, 소음병)" value="${esc(NF.q)}" style="flex:1;min-width:0">
    <select id="nsort" class="btn"><option value="count" ${NF.sort==='count'?'selected':''}>많이 틀린 순</option><option value="recent" ${NF.sort==='recent'?'selected':''}>최근 푼 순</option><option value="seq" ${NF.sort==='seq'?'selected':''}>교재 순</option></select></div>
    <div class="row" style="justify-content:space-between"><span class="muted">${list.length}문항${NF.kind==='wrong'?` · 연속 ${S.prefs.grad ?? GRAD}번 맞히면 오답노트에서 빠집니다 (틀린 횟수는 계속 남아요)`:''}</span>
    <button class="btn primary" type="button" data-act="note-start" ${list.length?'':'disabled'}>이 목록 랜덤으로 풀기</button></div>
  </div>
  ${groups.length ? groups.map(g => `<details class="notech" ${groups.length<=3?'open':''}><summary><span>${g.c.n}강 ${esc(g.c.name)}</span><span class="row" style="gap:8px"><span class="muted" style="font-weight:500">${g.its.length}문항</span><button class="btn" type="button" data-notech="${g.c.n}">이 단원만 풀기</button></span></summary>${g.its.map(noteItemHTML).join('')}</details>`).join('')
    : `<div class="empty">${NF.kind==='wrong'?'오답노트가 비어 있어요. 문제를 풀다가 틀리면 여기에 단원별로 모입니다.':NF.kind==='bm'?'북마크한 문제가 없어요. 문제 화면에서 ☆를 누르거나 B 키를 누르세요.':'해당하는 문항이 없어요.'}</div>`}`;
}
function chipGroupNF(name, opts, val){ return `<div class="chips">` + opts.map(([v,l]) => `<button type="button" class="chip" data-nf="${name}" data-v="${v}" aria-pressed="${val===v}">${l}</button>`).join('') + `</div>`; }

/* ---------------- stats ---------------- */
function statsHTML(){
  const rows = chapterRows();
  const acc = r => { let c=0,w=0; ITEMS.filter(i=>i.ch===r.c.n).forEach(i => { const s=S.st[i.id]; if(s){c+=s.c;w+=s.w;} }); return c+w ? Math.round(c/(c+w)*100) : null; };
  const top = ITEMS.filter(i => stOf(i.id).w>0).sort((a,b) => stOf(b.id).w - stOf(a.id).w).slice(0, 15);
  const days = Object.entries(S.daily).sort().slice(-14);
  const maxD = Math.max(1, ...days.map(d=>d[1]));
  const partAcc = PARTS.map(p => { let c=0,w=0; ITEMS.filter(i=>i.part===p).forEach(i => { const s=S.st[i.id]; if(s){c+=s.c;w+=s.w;} }); return [p, c+w?Math.round(c/(c+w)*100):null, c+w]; });
  return `<h1>기록</h1>
  <div class="panel"><h2 style="margin-bottom:10px">단원별 정답률</h2><div class="tablewrap"><table class="ch"><thead><tr><th>단원</th><th class="num">푼 문항</th><th>정답률</th><th class="num">%</th><th class="num">누적 오답</th></tr></thead><tbody>
  ${rows.map(r => { const a = acc(r); let w=0; ITEMS.filter(i=>i.ch===r.c.n).forEach(i=>w+=stOf(i.id).w);
    return `<tr><td><b>${r.c.n}강</b> ${esc(r.c.name)}</td><td class="num">${r.seen}/${r.n}</td><td><div class="bar"><i style="width:${a??0}%;background:${a===null?'transparent':a<60?'var(--bad)':a<80?'var(--warn)':'var(--ok)'}"></i></div></td><td class="num">${a===null?'–':a}</td><td class="num">${w}</td></tr>`; }).join('')}
  </tbody></table></div></div>
  <div class="grid2">
    <div class="panel"><h2 style="margin-bottom:10px">파트별 정답률</h2>${partAcc.map(([p,a,n]) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span>${PARTNAME[p]}</span><span class="muted" style="font-variant-numeric:tabular-nums">${a===null?'아직 없음':a+'% · '+n+'회'}</span></div>`).join('')}</div>
    <div class="panel"><h2 style="margin-bottom:10px">최근 2주 풀이량</h2>${days.length?`<div style="display:flex;align-items:flex-end;gap:4px;height:110px">${days.map(([d,v]) => `<div title="${d}: ${v}문항" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0"><div style="width:100%;background:var(--celadon);border-radius:3px 3px 0 0;height:${Math.max(3,Math.round(v/maxD*80))}px"></div><span style="font-size:10.5px;color:var(--ink3)">${d.slice(8)}</span></div>`).join('')}</div>`:'<div class="empty">아직 기록이 없어요.</div>'}</div>
  </div>
  <div class="panel"><h2 style="margin-bottom:10px">가장 많이 틀린 문항</h2>${top.length?`<div class="notech">${top.map(noteItemHTML).join('')}</div>`:'<div class="empty">아직 틀린 문항이 없어요.</div>'}</div>
  <div class="panel field"><span class="flabel">설정</span>
    <div class="row"><span>오답노트 졸업 기준</span>${[1,2,3].map(n=>`<button type="button" class="chip" data-grad="${n}" aria-pressed="${(S.prefs.grad ?? GRAD)===n}">연속 ${n}번 정답</button>`).join('')}</div>
    <div class="row"><span>테마</span>${[['','시스템'],['light','밝게'],['dark','어둡게']].map(([v,l])=>`<button type="button" class="chip" data-theme-set="${v}" aria-pressed="${(S.prefs.theme||'')===v}">${l}</button>`).join('')}</div>
    <div class="row"><button class="btn" type="button" data-act="reset">기록 초기화…</button></div>
  </div>
  <div class="panel field" id="acctPanel"></div>`;
}

/* ---------------- bindings ---------------- */
function bindView(){
  const v = $('#view');
  v.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => {
    const k = b.dataset.pref; let val = b.dataset.v;
    if (k==='chs') val = +val; if (k==='shuffleOpts') val = val==='true';
    if (b.dataset.multi==='1'){ P[k] = P[k].includes(val) ? P[k].filter(x=>x!==val) : [...P[k], val]; if (k==='chs') P[k].sort((a,b)=>a-b); }
    else P[k] = val;
    persist(); render();
  });
  const cnt = $('#cnt'); if (cnt) cnt.onchange = () => { P.count = +cnt.value; persist(); };
  const nf = $('#noFlag'); if (nf) nf.onchange = () => { P.noFlag = nf.checked; persist(); render(); };
  v.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b));
  v.querySelectorAll('[data-chq]').forEach(r => r.onclick = () => { const n = +r.dataset.chq; startSession(ITEMS.filter(i=>i.ch===n), {order:'seq', count:0, title:n+'강'}); });
  v.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => {
    const k = b.dataset.quick;
    if (k==='wrong') startSession(ITEMS.filter(i=>isActiveWrong(i.id)), {order:'random', count:0});
    if (k==='weak') startSession(ITEMS.filter(i=>S.st[i.id]), {order:'weak', count:30});
    if (k==='new') startSession(ITEMS.filter(i=>!S.st[i.id]), {order:'random', count:20});
    if (k==='bm') startSession(ITEMS.filter(i=>S.bm[i.id]), {order:'random', count:0});
  });
  v.querySelectorAll('[data-nf]').forEach(b => b.onclick = () => { NF[b.dataset.nf] = b.dataset.v; render(); });
  const nq = $('#nq'); if (nq){ nq.oninput = () => { NF.q = nq.value; const pos = nq.selectionStart; render(); const n2 = $('#nq'); n2.focus(); n2.setSelectionRange(pos,pos); }; }
  const ns = $('#nsort'); if (ns) ns.onchange = () => { NF.sort = ns.value; render(); };
  v.querySelectorAll('[data-notech]').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); const n = +b.dataset.notech; startSession(notesFiltered().filter(i=>i.ch===n), {order:'random', count:0}); });
  v.querySelectorAll('[data-one]').forEach(b => b.onclick = () => startSession([BYID[b.dataset.one]], {count:0, mode:'study'}));
  v.querySelectorAll('[data-bmid]').forEach(b => b.onclick = () => { toggleBm(b.dataset.bmid); render(); });
  v.querySelectorAll('[data-grad]').forEach(b => b.onclick = () => { S.prefs.grad = +b.dataset.grad; persist(); render(); });
  v.querySelectorAll('[data-theme-set]').forEach(b => b.onclick = () => { S.prefs.theme = b.dataset.themeSet; applyTheme(); persist(); render(); });
}
function act(a, el){
  const item = session && BYID[session.ids[session.i]];
  switch(a){
    case 'start': startSession(poolItems()); break;
    case 'chall': P.chs = CH.map(c=>c.n); persist(); render(); break;
    case 'chnone': P.chs = []; persist(); render(); break;
    case 'exam': openExamDlg(); break;
    case 'quit': if (session.review){ rvQuit(); break; } if (Object.keys(session.ans).length) finish(); else { session = null; go('setup'); } break;
    case 'rvskip': rvSkip('b:'+item.id); nextQ(); break;
    case 'submit': submit(item); break;
    case 'self-o': submit(item, true); break;
    case 'self-x': submit(item, false); break;
    case 'next': nextQ(); break;
    case 'prev': if (session.i){ session.i--; renderQuiz(); } break;
    case 'bm': toggleBm(item.id); renderQuiz(); break;
    case 'retry-wrong': { const ids = session.ids.filter(id => { const r = session.ans[id]; return !r || !r.ok || r.guessed; }); startSession(ids.map(id=>BYID[id]), {order:'random', count:0}); break; }
    case 'note-start': startSession(notesFiltered(), {order:'random', count:0}); break;
    case 'reset': {
      const dlg = $('#dlg'); dlg.hidden = false;
      dlg.innerHTML = `<div role="dialog" aria-label="기록 초기화"><h2>기록을 모두 지울까요?</h2><p class="muted" style="margin:0">맞힘·틀림 횟수, 북마크, 메모, 카드 기억(알아요·몰라요)이 모두 사라지고 되돌릴 수 없어요. 만든 카드 덱은 남아요.</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" type="button" id="dlgCancel">취소</button><button class="btn primary" type="button" id="dlgOk" style="background:var(--bad);border-color:var(--bad)">모두 지우기</button></div></div>`;
      $('#dlgCancel').onclick = () => dlg.hidden = true;
      $('#dlgOk').onclick = () => { S.st = {}; S.bm = {}; S.memo = {}; S.daily = {}; S.days = {}; S.rvp = {}; S.routine = {}; S.cards = {}; persist(); dlg.hidden = true; render(); toast('기록을 지웠어요'); };
      break; }
  }
}
function applyTheme(){ const t = S.prefs.theme; if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }

/* ================= 집요 복습 (빈칸 노트) ================= */
const JI = JD.items, JBY = {}; JI.forEach(i => JBY[i.id] = i);
const JLA = JD.lecs, JLN = {}, JLG = {}; JLA.forEach(l => { JLN[l.id] = l.t; JLG[l.id] = l.g || 'jy'; });
var JG = 'jy';
const SUBJ = { jy: { name: '집요 복습', lk: 'jyLecs', desc: '집요 수업노트', short: '집요' }, sl: { name: '생리학 복습', lk: 'slLecs', desc: '생리학 수업노트', short: '생리학' }, zg: { name: '총강 복습', lk: 'zgLecs', desc: '한의학총강 수업노트', short: '총강' } };
const JGS = Object.keys(SUBJ);
const JLg = () => JLA.filter(l => (l.g||'jy') === JG);
const LK = () => SUBJ[JG].lk;
const RD = JD.rd;
const jkey = (id,k) => id + '#' + k;
pdef('jyLecs', JLA.filter(l=>(l.g||'jy')==='jy').map(l=>l.id));
if (JD.alias && Array.isArray(P.jyLecs)){ const valid = new Set(JLA.map(l=>l.id)); P.jyLecs = [...new Set(P.jyLecs.map(x => JD.alias[x] || x))].filter(x => valid.has(x)); } pdef('slLecs', JLA.filter(l=>l.g==='sl').map(l=>l.id)); pdef('zgLecs', JLA.filter(l=>l.g==='zg').map(l=>l.id)); pdef('zgSeen', []);
{ const seen = new Set(P.zgSeen), add = JLA.filter(l => l.g==='zg' && !seen.has(l.id)).map(l => l.id); if (add.length){ add.forEach(id => { if (!P.zgLecs.includes(id)) P.zgLecs.push(id); }); P.zgSeen = [...seen, ...add]; } } pdef('jyMode','choice'); pdef('jyPool','all'); pdef('jyOrder','seq'); pdef('jyCount', 20); pdef('jyCards', 50);

/* ---- answer matching: 한자 또는 독음 ---- */
const HG = c => c >= '가' && c <= '힣';
function dueum(ch){
  if (!HG(ch)) return ch;
  const c = ch.charCodeAt(0)-0xAC00, i = Math.floor(c/588), m = Math.floor((c%588)/28), f = c%28;
  const mk = ii => String.fromCharCode(0xAC00 + ii*588 + m*28 + f);
  const Y = [2,3,6,7,12,17,20].includes(m); const v = new Set([ch]);
  if (i===5){ v.add(mk(Y?11:2)); if (Y) v.add(mk(2)); }
  if (i===2){ v.add(mk(5)); if (Y) v.add(mk(11)); }
  if (i===11 && Y){ v.add(mk(5)); v.add(mk(2)); }
  return [...v].join('');
}
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&');
function jnorm(s){ return String(s||'').replace(/[\s·,.、，()（）\[\]「」『』'"‘’“”<>《》〈〉:：~\-–—→]/g,'').toLowerCase(); }
function jalts(a){
  const out = new Set([a]);
  const noP = a.replace(/\(.*?\)/g,'').trim(); if (jnorm(noP)) out.add(noP);
  (a.match(/\((.*?)\)/g)||[]).forEach(x => { const t = x.slice(1,-1); if (jnorm(t)) out.add(t); });
  a.split(/\s*\/\s*|\s+또는\s+|\s*=\s*/).forEach(x => { if (jnorm(x)) out.add(x); });
  return [...out];
}
const RXC = {};
function jrx(alt){
  if (RXC[alt]) return RXC[alt];
  const n = jnorm(alt); let p = '';
  for (const c of n){
    if (RD[c]){ const set = new Set([c]); for (const r of RD[c]) for (const v of dueum(r)) set.add(v); p += '[' + [...set].map(reEsc).join('') + ']'; }
    else if (HG(c)) p += '[' + reEsc(dueum(c)) + ']';
    else p += reEsc(c);
  }
  return RXC[alt] = new RegExp('^' + p + '$');
}
function jmatch(user, ans){
  const u = jnorm(user); if (!u) return false;
  return jalts(ans).some(a => jrx(a).test(u));
}
function readingOf(a){ let r = '', any = false; for (const c of a){ if (RD[c]){ r += RD[c][0]; any = true; } else r += c; } return any ? r : ''; }

/* ---- distractors ---- */
const kindOf = a => /^[\d\s~,.\-]+$/.test(a) ? 'n' : ([...a].filter(HG).length > a.length/2 ? 'h' : 'c');
const LPOOL = {};
JI.forEach(it => { (LPOOL[it.l] = LPOOL[it.l] || new Set()); it.a.forEach(a => a && a.length <= 24 && LPOOL[it.l].add(a)); });
function jopts(it, k){
  const ans = it.a[k], na = jnorm(ans);
  const uniq = [...new Set(it.a)].filter(Boolean);
  if (uniq.length <= 5 && it.a.length >= uniq.length + 1 && uniq.length >= 2) return uniq.slice().sort();
  const ok = x => x && jnorm(x) !== na && !jalts(ans).some(al => jnorm(al) === jnorm(x));
  let pool = shuffle(uniq.filter(ok));
  const kd = kindOf(ans), L = [...ans].length;
  if (pool.length < 4){
    const more = shuffle([...LPOOL[it.l]].filter(x => ok(x) && !pool.includes(x) && kindOf(x)===kd))
      .sort((a,b) => Math.abs([...a].length-L) - Math.abs([...b].length-L)).slice(0, 10);
    pool = pool.concat(shuffle(more));
  }
  const seen = new Set([na]); const pick = [];
  for (const x of pool){ const n = jnorm(x); if (!seen.has(n)){ seen.add(n); pick.push(x); } if (pick.length >= 4) break; }
  return shuffle([ans, ...pick]);
}

/* ---- pools ---- */
function jBlankIn(it, k){
  const key = jkey(it.id,k), s = S.st[key];
  switch(P.jyPool){
    case 'new': return !s;
    case 'wrong': return isActiveWrong(key);
    case 'weak': return s && s.w >= 2;
    case 'bm': return !!S.bm[it.id];
    case 'flag': return (it.f||[]).includes(k);
    default: return true;
  }
}
function jTargets(it){ return it.a.map((a,k)=>k).filter(k => it.a[k] && jBlankIn(it,k)); }
function jPoolItems(){ const L = P[LK()]; return JI.filter(it => JLG[it.l]===JG && L.includes(it.l)).filter(it => jTargets(it).length); }
function jWeak(key){ const s = S.st[key]; if (!s) return 0.5; return (s.w+1)/(s.c+s.w+2) + (s.l==='x'?0.5:0) - (s.s||0)*0.15; }

/* ---- render: doc with blanks ---- */
function jDoc(it, cellFn){
  let k = -1;
  return `<div class="jy-doc">${it.h.replace(/<b class="jb" data-k="(\d+)"><\/b>/g, (_, n) => cellFn(+n))}</div>`;
}
const flagSup = (it,k) => (it.f||[]).includes(k) ? '<sup title="자동 추출 정답 — 수업노트 확인 권장">?</sup>' : '';

/* ---- state ---- */
let JQ = null;   // quiz session
let JC = null;   // card session
let JR = null;   // result

function jHomeHTML(){
  const JL = JLg();
  const rows = JL.map(l => {
    const its = JI.filter(i => i.l===l.id); let seen=0, wrong=0, ok=0, tot=0;
    its.forEach(it => it.a.forEach((a,k) => { if (!a) return; tot++; const key=jkey(it.id,k), s=S.st[key]; if (s){ seen++; if (s.l==='o') ok++; } if (isActiveWrong(key)) wrong++; }));
    return {l, tot, seen, ok, wrong, pct: tot ? Math.round(seen/tot*100) : 0};
  });
  const T = rows.reduce((a,r) => ({tot:a.tot+r.tot, seen:a.seen+r.seen, ok:a.ok+r.ok, wrong:a.wrong+r.wrong}), {tot:0,seen:0,ok:0,wrong:0});
  const n = jPoolItems(); const nb = n.reduce((a,it)=>a+jTargets(it).length,0);
  const isCard = P.jyMode==='card';
  return `
  <h1>${SUBJ[JG].name}</h1>
  <p class="muted" style="margin:0">${SUBJ[JG].desc} 빈칸 ${T.tot.toLocaleString()}개 · 강의 ${JL.length}개. 기존 문제은행 기록과 따로 저장돼요.</p>
  <div class="stats">
    <div class="stat"><div class="v">${T.seen.toLocaleString()}</div><div class="k">풀어본 빈칸</div></div>
    <div class="stat"><div class="v">${T.tot?Math.round(T.seen/T.tot*100):0}%</div><div class="k">진도</div></div>
    <div class="stat"><div class="v">${T.ok.toLocaleString()}</div><div class="k">최근에 맞힌 빈칸</div></div>
    <div class="stat"><div class="v" style="color:${T.wrong?'var(--bad)':'inherit'}">${T.wrong.toLocaleString()}</div><div class="k">오답 빈칸</div></div>
  </div>
  <div class="panel field"><span class="flabel">강의</span>
    ${chipGroup(LK(), JL.map(l=>[l.id, l.t]), P[LK()], true)}
    <div class="row"><button class="btn ghost" type="button" data-ja="lall">전체 선택</button><button class="btn ghost" type="button" data-ja="lnone">전체 해제</button></div>
  </div>
  <div class="grid2">
    <div class="panel field"><span class="flabel">푸는 방식</span>${chipGroup('jyMode', [['choice','선지형 (보기에서 고르기)'],['short','단답형 (한자·독음 입력)'],['card','카드형 (넘기며 체크)']], P.jyMode, false)}
      <span class="muted" style="font-size:12.5px">${P.jyMode==='card' ? '오른쪽으로 넘기면 알아요, 왼쪽은 몰라요. 탭하면 뒤집혀요. 키보드 ← → / 스페이스' : P.jyMode==='short' ? '한자나 한글 독음 모두 정답. 두음법칙(육/륙 등)과 띄어쓰기는 상관없어요.' : '빈칸을 누르고 아래 보기에서 고르세요. 숫자키 1–5도 돼요.'}</span></div>
    <div class="panel field"><span class="flabel">어떤 빈칸을</span>${chipGroup('jyPool', [['all','전체'],['new','안 푼 빈칸'],['wrong','오답 빈칸'],['weak','2번 이상 틀린 빈칸'],['bm','북마크'],['flag','정답 확인 필요']], P.jyPool, false)}
      <span class="flabel" style="margin-top:6px">순서</span>${chipGroup('jyOrder', [['seq','노트 순서'],['random','랜덤'],['weak','약점 우선']], P.jyOrder, false)}</div>
  </div>
  <div class="panel row" style="justify-content:space-between">
    <div class="row"><label class="flabel" for="jcnt">${isCard?'카드 수':'블록 수'}</label>
      <select id="jcnt" class="btn">${(isCard?[20,50,100,200,0]:[10,20,30,50,0]).map(v=>`<option value="${v}" ${+(isCard?P.jyCards:P.jyCount)===v?'selected':''}>${v||'전부'}</option>`).join('')}</select>
      <span class="muted">조건에 맞는 ${isCard?'카드':'블록'} <b style="color:var(--ink)">${(isCard?nb:n.length).toLocaleString()}</b>${isCard?'장':'개'} · 빈칸 ${nb.toLocaleString()}개</span></div>
    <button class="btn primary" type="button" data-ja="start" ${n.length?'':'disabled'}>시작</button>
  </div>
  <div class="panel">
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>강의별 진도</h2><span class="muted" style="font-size:12.5px">행을 누르면 그 강의만 지금 방식으로 시작</span></div>
    <div class="tablewrap"><table class="jy-lec"><thead><tr><th>강의</th><th class="num">빈칸</th><th>진도</th><th class="num">오답</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-jlec="${r.l.id}"><td>${esc(r.l.t)}</td><td class="num">${r.tot}</td><td><div class="bar"><i style="width:${r.pct}%"></i></div></td><td class="num" style="color:${r.wrong?'var(--bad)':'inherit'}">${r.wrong}</td></tr>`).join('')}
    </tbody></table></div>
  </div>
  ${jWrongListHTML()}`;
}
function jWrongListHTML(){
  const its = JI.filter(it => JLG[it.l]===JG && it.a.some((a,k) => isActiveWrong(jkey(it.id,k))));
  if (!its.length) return '';
  const show = its.slice(0, 40);
  return `<div class="panel field"><div class="row" style="justify-content:space-between"><h2>오답 빈칸 (${its.reduce((a,it)=>a+it.a.filter((x,k)=>isActiveWrong(jkey(it.id,k))).length,0)})</h2>
    <div class="row"><button class="btn" type="button" data-ja="wrong-card">카드로 복습</button><button class="btn" type="button" data-ja="wrong-quiz">다시 풀기</button></div></div>
    <span class="muted" style="font-size:12.5px">연속 ${S.prefs.grad ?? GRAD}번 맞히면 오답에서 빠져요.</span>
    <div class="jy-wl">${show.map(it => `<div class="nitem"><div class="meta"><span class="tag school">${esc(JLN[it.l])}</span><span class="tag">${esc(it.s)}</span><span class="tag">p.${it.p}</span></div>
      ${jDoc(it, k => { const key = jkey(it.id,k), s = S.st[key]; const w = isActiveWrong(key);
        return `<span class="blank ${w?'wrongb':'given'}">${esc(it.a[k])}${w?`<sup style="color:var(--bad)">×${s.w}</sup>`:''}</span>`; })}</div>`).join('')}
    ${its.length>40?`<p class="muted">외 ${its.length-40}블록</p>`:''}</div></div>`;
}

/* ---- quiz (선지/단답) ---- */
function jStart(list, opts={}){
  const mode = opts.mode || P.jyMode;
  if (mode==='card') return jStartCards(list, opts);
  let L = list.slice();
  const order = opts.order || P.jyOrder;
  if (order==='random') L = shuffle(L);
  else if (order==='weak') L = shuffle(L).sort((a,b) => Math.max(...jTargets(b).map(k=>jWeak(jkey(b.id,k)))) - Math.max(...jTargets(a).map(k=>jWeak(jkey(a.id,k)))));
  const cnt = opts.count ?? +P.jyCount; if (cnt) L = L.slice(0, cnt);
  if (!L.length){ toast('조건에 맞는 빈칸이 없어요'); return; }
  JQ = { mode, ids: L.map(i=>i.id), tg: {}, i: 0, qs: {}, ok:0, tot:0, wrong: [], review: opts.review || null };
  L.forEach(it => JQ.tg[it.id] = opts.targets ? opts.targets[it.id] : jTargets(it));
  view = 'jyq'; render(); window.scrollTo(0,0);
}
function jQS(it){
  if (JQ.qs[it.id]) return JQ.qs[it.id];
  const tg = JQ.tg[it.id];
  const q = { tg, val: {}, res: {}, opts: {}, active: tg[0], submitted: false, shown: {} };
  return JQ.qs[it.id] = q;
}
function jQuizHTML(){
  const it = JBY[JQ.ids[JQ.i]], q = jQS(it), short = JQ.mode==='short';
  const isT = k => q.tg.includes(k);
  const cell = k => {
    const a = it.a[k];
    if (!isT(k)) return `<span class="blank given">${esc(a)}</span>`;
    const idx = q.tg.indexOf(k) + 1;
    if (q.submitted){
      if (q.res[k]===true) return `<span class="blank ok">${esc(a)}</span>${flagSup(it,k)}`;
      if (q.res[k]==='self') return `<span class="blank shown">${esc(a)}</span>${flagSup(it,k)}`;
      return `<span class="blank no">${esc(q.val[k]||'—')}</span><span class="ans-note">→ ${esc(a)}</span>${flagSup(it,k)}<button type="button" class="fix" data-jfix="${k}">맞은 걸로</button>`;
    }
    const long = [...a].length > 14;
    if (short && !long) return `<span class="blank${q.active===k?' active':''}"><input data-jin="${k}" value="${esc(q.val[k]||'')}" aria-label="빈칸 ${idx}" autocomplete="off" autocapitalize="off" spellcheck="false" size="${Math.max(4, Math.min(14, [...a].length*2))}"></span>`;
    if (short && long) return q.shown[k] ? `<span class="blank shown">${esc(a)}</span>` : `<button type="button" class="blank" data-jrev="${k}">　긴 답 ${idx} · 눌러서 확인　</button>`;
    return `<button type="button" class="blank${q.active===k?' active':''}${q.val[k]?' filled':''}" data-jsel="${k}">${q.val[k]?esc(q.val[k]):'　'+idx+'　'}</button>`;
  };
  const total = JQ.ids.length;
  let tray = '';
  if (!short && !q.submitted && q.active!=null){
    q.opts[q.active] = q.opts[q.active] || jopts(it, q.active);
    tray = `<div class="tray jy-tray" role="group" aria-label="보기"><span class="lbl"><span>빈칸 ${q.tg.indexOf(q.active)+1}에 들어갈 말</span><span>숫자키 1–${q.opts[q.active].length}</span></span>${q.opts[q.active].map((o,n) => `<button type="button" data-jpick="${n}">${n+1}. ${esc(o)}</button>`).join('')}</div>`;
  }
  const longs = short ? q.tg.filter(k => [...it.a[k]].length > 14) : [];
  let fb = '';
  if (q.submitted){
    const okc = q.tg.filter(k => q.res[k]===true).length, sc = q.tg.filter(k => q.res[k]==='self').length;
    fb = `<div class="feedback ${okc+sc===q.tg.length?'ok':'no'}"><span class="verdict">빈칸 ${q.tg.length}개 중 ${okc}개 정답${sc?` · 확인 ${sc}개`:''}</span>${(it.f||[]).some(k=>q.tg.includes(k))?'<span class="muted" style="font-size:12.5px">? 표시는 수업노트에서 자동으로 뽑은 정답이라 한 번 확인해 주세요.</span>':''}</div>`;
  }
  const allFilled = q.tg.every(k => (q.val[k]||'').trim() || ([...it.a[k]].length>14 && short));
  return `${JQ.review?rvPhaseLabel():''}<div class="qhead"><div class="row" style="gap:8px"><b>${SUBJ[JG].name}</b><span class="muted" style="font-variant-numeric:tabular-nums">${JQ.i+1} / ${total}</span><span class="tag">${JQ.mode==='short'?'단답형':'선지형'}</span></div>
    <div class="row"><button class="btn ghost" type="button" data-ja="quit">그만하기</button></div></div>
  <div class="progress"><i style="width:${JQ.i/total*100}%"></i></div>
  <div class="qcard"><div class="meta"><span class="tag school">${esc(JLN[it.l])}</span><span class="tag">${esc(it.s)}</span><span class="tag">p.${it.p}</span><span class="tag">빈칸 ${q.tg.length}</span>${JQ.review?rvTagsHTML('j:'+it.id):''}
    <button type="button" class="star" data-ja="bm" aria-pressed="${!!S.bm[it.id]}" aria-label="북마크" style="margin-left:auto">${S.bm[it.id]?'★':'☆'}</button></div>
    ${jDoc(it, cell)}
    ${fb}
    <div class="actions"><div class="row"><button class="btn" type="button" data-ja="prev" ${JQ.i?'':'disabled'}>이전</button></div>
      <div class="row">${q.submitted ? '' : longs.length && longs.every(k=>q.shown[k]) ? '' : ''}
      ${q.submitted ? `<button class="btn primary" type="button" data-ja="next">${JQ.i+1<total?'다음':JQ.review?'다음 단계':'결과 보기'}</button>`
        : `${JQ.review?'<button class="btn ghost" type="button" data-ja="rvskip" title="풀지 않고 완료로 넘기기">넘기기</button>':''}<button class="btn ghost" type="button" data-ja="giveup">모르겠어요</button><button class="btn primary" type="button" data-ja="grade" ${allFilled||short?'':'disabled'}>채점</button>`}</div></div>
    <div class="kbd hide-sm">${short?'<kbd>Enter</kbd> 다음 칸 · 마지막 칸에서 채점':'<kbd>1</kbd>–<kbd>5</kbd> 보기 선택'} · 채점 후 <kbd>Enter</kbd> 다음</div>
    ${jMemoHTML(it)}
  </div>${tray}`;
}
function jGrade(giveup){
  const it = JBY[JQ.ids[JQ.i]], q = jQS(it); if (q.submitted) return;
  q.tg.forEach(k => {
    const a = it.a[k], long = [...a].length > 14;
    let ok;
    if (giveup) ok = false;
    else if (JQ.mode==='short' && long) ok = 'self';
    else ok = JQ.mode==='short' ? jmatch(q.val[k], a) : jnorm(q.val[k]) === jnorm(a);
    q.res[k] = ok;
    if (ok !== 'self') record(jkey(it.id,k), ok===true, false);
    JQ.tot++; if (ok===true || ok==='self') JQ.ok++; else JQ.wrong.push([it.id,k]);
  });
  q.submitted = true; if (JQ.review) rvMark('j:'+it.id); render();
}
function jFix(k){
  const it = JBY[JQ.ids[JQ.i]], q = jQS(it); if (q.res[k]===true) return;
  q.res[k] = true; JQ.ok++; JQ.wrong = JQ.wrong.filter(([id,kk]) => !(id===it.id && kk===k));
  const s = S.st[jkey(it.id,k)]; if (s){ s.w = Math.max(0, s.w-1); s.c++; s.s = (s.s||0)+1; s.l='o'; persist(); }
  rvFix(jkey(it.id,k));
  render();
}
function jNext(){
  if (JQ.i+1 < JQ.ids.length){ JQ.i++; render(); window.scrollTo(0,0); }
  else if (JQ.review) rvNextPhase();
  else { JR = { kind:'quiz', ok: JQ.ok, tot: JQ.tot, wrong: JQ.wrong.slice() }; view = 'jyr'; render(); window.scrollTo(0,0); }
}
function jAdvance(q){
  const empty = q.tg.filter(k => !(q.val[k]||'').trim());
  const after = empty.find(k => q.tg.indexOf(k) > q.tg.indexOf(q.active));
  q.active = after ?? empty[0] ?? q.active;
}

/* ---- cards ---- */
function jStartCards(list, opts={}){
  let deck = [];
  list.forEach(it => (opts.targets ? opts.targets[it.id] : jTargets(it)).forEach(k => deck.push([it.id,k])));
  const order = opts.order || P.jyOrder;
  if (order==='random') deck = shuffle(deck);
  else if (order==='weak') deck = shuffle(deck).sort((a,b) => jWeak(jkey(...b)) - jWeak(jkey(...a)));
  const cnt = opts.count ?? +P.jyCards; if (cnt) deck = deck.slice(0, cnt);
  if (!deck.length){ toast('조건에 맞는 카드가 없어요'); return; }
  JC = { deck, i: 0, flip: false, know: [], dunno: [], hist: [], round: 1, review: opts.review || null };
  view = 'jyc'; render(); window.scrollTo(0,0);
}
function jCardHTML(){
  if (JC.i >= JC.deck.length) return jCardDoneHTML();
  const [id,k] = JC.deck[JC.i], it = JBY[id], a = it.a[k];
  const s = S.st[jkey(id,k)];
  const rd = readingOf(a);
  const cell = n => n===k ? (JC.flip ? `<span class="blank shown big">${esc(a)}</span>${flagSup(it,n)}` : `<span class="blank target">?</span>`) : `<span class="blank given">${esc(it.a[n])}</span>`;
  return `${JC.review?rvPhaseLabel():''}<div class="qhead"><div class="row" style="gap:8px"><b>${SUBJ[JG].name}</b><span class="tag">카드형${JC.round>1?` · ${JC.round}회차`:''}</span><span class="muted" style="font-variant-numeric:tabular-nums">${JC.i+1} / ${JC.deck.length}</span></div>
    <div class="row"><button class="btn ghost" type="button" data-ja="cundo" ${JC.hist.length?'':'disabled'}>되돌리기</button>${JC.review?'<button class="btn ghost" type="button" data-ja="cskip" title="이 블록의 남은 카드를 넘기기">넘기기</button>':''}<button class="btn ghost" type="button" data-ja="cquit">그만하기</button></div></div>
  <div class="progress"><i style="width:${JC.i/JC.deck.length*100}%"></i></div>
  <div class="jy-count"><span class="u">몰라요 ${JC.dunno.length}</span><span class="k">알아요 ${JC.know.length}</span></div>
  <div class="jy-stage" id="jstage">
    <div class="jy-card" id="jcard" tabindex="0" aria-label="카드. 탭하면 뒤집혀요">
      <span class="jy-badge u" id="jbu">몰라요</span><span class="jy-badge k" id="jbk">알아요</span>
      <div class="meta"><span class="tag school">${esc(JLN[it.l])}</span><span class="tag">${esc(it.s)}</span>${s?`<span class="tag ${s.l==='x'?'bad':''}">맞음 ${s.c} · 틀림 ${s.w}</span>`:'<span class="tag">처음</span>'}${JC.review?rvTagsHTML('j:'+id):''}<button type="button" class="star" data-ja="cbm" aria-pressed="${!!S.bm[id]}" aria-label="북마크" style="margin-left:auto">${S.bm[id]?'★':'☆'}</button></div>
      <div class="ctx">${jDoc(it, cell)}</div>
      <div class="face">${JC.flip ? `<div class="a">${esc(a)}</div>${rd && rd!==a ? `<div class="rd">${esc(rd)}</div>`:''}${(it.f||[]).includes(k)?'<div class="rd">? 자동 추출 정답 — 확인 권장</div>':''}` : `<div class="q">노란 칸에 들어갈 말은? 탭해서 확인</div>`}</div>
    </div>
  </div>
  <div class="jy-cbtns"><button class="btn no" type="button" data-ja="cno">← 몰라요</button><button class="btn" type="button" data-ja="cflip">뒤집기</button><button class="btn yes" type="button" data-ja="cyes">알아요 →</button></div>
  ${JC.flip ? jMemoHTML(it) : ''}
  <div class="kbd hide-sm" style="text-align:center"><kbd>←</kbd> 몰라요 · <kbd>Space</kbd> 뒤집기 · <kbd>→</kbd> 알아요 · <kbd>Z</kbd> 되돌리기</div>`;
}
function jCardDoneHTML(){
  const n = JC.know.length + JC.dunno.length;
  return `<h1>카드 ${JC.round}회차 끝</h1>
  <div class="panel row" style="justify-content:space-between;align-items:flex-end">
    <div><div class="result-big" style="color:var(--ok)">${JC.know.length}<span class="muted" style="font-size:20px"> / ${n}</span></div><div class="muted">알아요 ${JC.know.length} · 몰라요 ${JC.dunno.length}</div></div>
    <div class="row">${JC.review?'<button class="btn primary" type="button" data-ja="rvnext">다음 단계 →</button>':''}${JC.dunno.length?`<button class="btn ${JC.review?'':'primary'}" type="button" data-ja="cagain">몰라요 ${JC.dunno.length}장 다시</button>`:''}<button class="btn" type="button" data-ja="creshuffle">전체 다시 섞기</button><button class="btn" type="button" data-ja="home">${SUBJ[JG].name} 처음으로</button></div>
  </div>
  ${JC.dunno.length ? `<h2>몰라요 카드</h2><div class="jy-wl">${JC.dunno.slice(0,60).map(([id,k]) => { const it = JBY[id]; return `<div class="nitem"><div class="meta"><span class="tag school">${esc(JLN[it.l])}</span><span class="tag">${esc(it.s)}</span></div>${jDoc(it, n => `<span class="blank ${n===k?'wrongb':'given'}">${esc(it.a[n])}</span>`)}</div>`; }).join('')}</div>` : '<div class="empty">모두 알아요로 넘겼어요.</div>'}`;
}
function jSwipe(dir){
  if (!JC || JC.i >= JC.deck.length) return;
  const c = JC.deck[JC.i], key = jkey(...c);
  JC.hist.push({ c, dir, prev: S.st[key] ? Object.assign({}, S.st[key]) : null, day: today(), dv: rvPeek(key) });
  record(key, dir > 0, false);
  (dir > 0 ? JC.know : JC.dunno).push(c);
  if (JC.review && !JC.deck.slice(JC.i+1).some(x => x[0]===c[0])) rvMark('j:'+c[0]);
  const card = $('#jcard');
  const go2 = () => { JC.i++; JC.flip = false; render(); };
  if (card && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    card.classList.remove('drag'); card.classList.add('anim');
    card.style.transform = `translateX(${dir*130}%) rotate(${dir*14}deg)`; card.style.opacity = '0';
    setTimeout(go2, 200);
  } else go2();
}
function jUndo(){
  const h = JC.hist.pop(); if (!h) return;
  const key = jkey(...h.c);
  if (h.prev) S.st[key] = h.prev; else delete S.st[key];
  rvRestore(key, h.dv, h.day);
  if (S.daily[h.day]) S.daily[h.day] = Math.max(0, S.daily[h.day]-1);
  const arr = h.dir > 0 ? JC.know : JC.dunno; arr.pop();
  JC.i = Math.max(0, JC.i-1); JC.flip = false; persist(); render();
}
function jBindCard(){
  const card = $('#jcard'); if (!card) return;
  let sx=0, sy=0, dx=0, drag=false, moved=false, pid=null;
  const bu = $('#jbu'), bk = $('#jbk');
  card.addEventListener('pointerdown', e => { if (e.button) return; const tw = e.target.closest('.jtw'); if (tw && tw.scrollWidth > tw.clientWidth + 2) return; drag = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0; pid = e.pointerId; });
  card.addEventListener('pointermove', e => {
    if (!drag || e.pointerId!==pid) return;
    dx = e.clientX - sx; const dy = e.clientY - sy;
    if (!moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)){ moved = true; card.setPointerCapture(pid); card.classList.add('drag'); }
    if (!moved) return;
    e.preventDefault();
    card.style.transform = `translateX(${dx}px) rotate(${dx/22}deg)`;
    const r = Math.min(1, Math.abs(dx)/100);
    bk.style.opacity = dx > 0 ? r : 0; bu.style.opacity = dx < 0 ? r : 0;
  });
  const end = e => {
    if (!drag) return; drag = false;
    if (moved){
      if (Math.abs(dx) > 90) jSwipe(dx > 0 ? 1 : -1);
      else { card.classList.remove('drag'); card.classList.add('anim'); card.style.transform = ''; bk.style.opacity = 0; bu.style.opacity = 0; setTimeout(()=>card.classList.remove('anim'), 230); }
    } else if (e.type==='pointerup' && !e.target.closest('button,a,.ctx .jtw,textarea,details')) { JC.flip = !JC.flip; render(); }
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
}

/* ---- result ---- */
function jResultHTML(){
  const r = JR; const ids = [...new Set(r.wrong.map(x=>x[0]))];
  return `<h1>결과</h1>
  <div class="panel row" style="justify-content:space-between;align-items:flex-end">
    <div><div class="result-big">${r.ok}<span class="muted" style="font-size:20px"> / ${r.tot}</span></div><div class="muted">빈칸 기준</div></div>
    <div class="row">${r.wrong.length?`<button class="btn" type="button" data-ja="rwrong-card">틀린 ${r.wrong.length}칸 카드로</button><button class="btn" type="button" data-ja="rwrong-quiz">틀린 칸 다시 풀기</button>`:''}<button class="btn primary" type="button" data-ja="home">${SUBJ[JG].name} 처음으로</button></div>
  </div>
  ${ids.length ? `<h2>틀린 빈칸</h2><div class="jy-wl">${ids.map(id => { const it = JBY[id]; const wk = r.wrong.filter(x=>x[0]===id).map(x=>x[1]);
    return `<div class="nitem"><div class="meta"><span class="tag school">${esc(JLN[it.l])}</span><span class="tag">${esc(it.s)}</span><span class="tag">p.${it.p}</span></div>${jDoc(it, n => `<span class="blank ${wk.includes(n)?'wrongb':'given'}">${esc(it.a[n])}</span>`)}</div>`; }).join('')}</div>` : '<div class="empty">모두 맞혔어요.</div>'}`;
}
function jTargetsFrom(pairs){ const t = {}; pairs.forEach(([id,k]) => (t[id] = t[id] || []).push(k)); Object.values(t).forEach(a => a.sort((x,y)=>x-y)); return t; }

/* ---- render & bind ---- */
function jMigrateK(){
  try{
    if (P.jyKmap1 || !JD.kmap) return;
    if (hooks.loadState && syncState!=='cloud') return;
    const st = S.st;
    for (const [id, mp] of Object.entries(JD.kmap)){
      const pairs = Object.entries(mp.m||{});
      const tmp = {};
      pairs.forEach(([o]) => { const k = id+'#'+o; if (st[k]){ tmp[o] = st[k]; delete st[k]; } });
      pairs.forEach(([o,n]) => { if (tmp[o]) st[id+'#'+n] = tmp[o]; });
    }
    P.jyKmap1 = 1; persist();
  }catch(e){}
}
function jyRender(v){
  jMigrateK();
  if (view==='jy' || view==='sl' || view==='zg'){ JG = view; v.innerHTML = jHomeHTML(); }
  else if (view==='jyq'){ if (!JQ){ view=JG; return jyRender(v); } v.innerHTML = jQuizHTML(); }
  else if (view==='jyc'){ if (!JC){ view=JG; return jyRender(v); } v.innerHTML = jCardHTML(); }
  else if (view==='jyr'){ if (!JR){ view=JG; return jyRender(v); } v.innerHTML = jResultHTML(); }
}
function jyBind(){
  const v = $('#view');
  v.querySelectorAll('[data-pref^="jy"],[data-pref="slLecs"],[data-pref="zgLecs"]').forEach(b => b.onclick = () => {
    const k = b.dataset.pref, multi = b.dataset.multi==='1'; let val = b.dataset.v;
    if (multi){ const arr = P[k]; const i = arr.indexOf(val); if (i>=0) arr.splice(i,1); else arr.push(val); }
    else P[k] = val;
    persist(); render();
  });
  const jc = $('#jcnt'); if (jc) jc.onchange = () => { if (P.jyMode==='card') P.jyCards = +jc.value; else P.jyCount = +jc.value; persist(); render(); };
  v.querySelectorAll('[data-jlec]').forEach(r => r.onclick = () => jStart(JI.filter(it => it.l===r.dataset.jlec && jTargets(it).length)));
  v.querySelectorAll('[data-ja]').forEach(b => b.onclick = e => { e.stopPropagation(); jAct(b.dataset.ja); });
  if (view==='jyq'){
    const it = JBY[JQ.ids[JQ.i]], q = jQS(it);
    v.querySelectorAll('[data-jsel]').forEach(b => b.onclick = () => { q.active = +b.dataset.jsel; render(); });
    v.querySelectorAll('[data-jpick]').forEach(b => b.onclick = () => jPick(+b.dataset.jpick));
    v.querySelectorAll('[data-jrev]').forEach(b => b.onclick = () => { q.shown[+b.dataset.jrev] = true; render(); });
    v.querySelectorAll('[data-jfix]').forEach(b => b.onclick = () => jFix(+b.dataset.jfix));
    const ins = [...v.querySelectorAll('[data-jin]')];
    ins.forEach((inp, n) => {
      inp.oninput = () => { q.val[+inp.dataset.jin] = inp.value; };
      inp.onfocus = () => { q.active = +inp.dataset.jin; };
      inp.onkeydown = e => { if (e.key==='Enter' && !e.isComposing){ e.preventDefault(); if (n+1 < ins.length) ins[n+1].focus(); else jGrade(); } };
    });
    if (ins.length && !q.submitted){ const t = ins.find(x => +x.dataset.jin===q.active) || ins.find(x=>!x.value) || ins[0]; t.focus({preventScroll:true}); }
  }
  if (view==='jyc'){ jBindCard();
    const tgt = v.querySelector('.jy-card .blank.target, .jy-card .blank.big');
    if (tgt){ const tw = tgt.closest('.jtw'); if (tw){ const r0 = tgt.getBoundingClientRect(), t0 = tw.getBoundingClientRect(); tw.scrollLeft += (r0.left + r0.width/2) - (t0.left + tw.clientWidth/2); }
      const cx = v.querySelector('.jy-card .ctx'); if (cx){ const r = tgt.getBoundingClientRect(), rc = cx.getBoundingClientRect(); if (r.top < rc.top || r.bottom > rc.bottom) cx.scrollTop += (r.top - rc.top) - cx.clientHeight/2; } } }
}
function jPick(n){
  const it = JBY[JQ.ids[JQ.i]], q = jQS(it); if (q.submitted || q.active==null) return;
  const o = (q.opts[q.active]||[])[n]; if (o==null) return;
  q.val[q.active] = o; jAdvance(q);
  render();
}
function jAct(a){
  switch(a){
    case 'lall': P[LK()] = JLg().map(l=>l.id); persist(); render(); break;
    case 'lnone': P[LK()] = []; persist(); render(); break;
    case 'start': jStart(jPoolItems()); break;
    case 'home': view = JG; render(); window.scrollTo(0,0); break;
    case 'quit': if (JQ.review){ rvQuit(); break; } if (JQ.tot){ JR = { kind:'quiz', ok: JQ.ok, tot: JQ.tot, wrong: JQ.wrong.slice() }; view = 'jyr'; } else view = JG; render(); break;
    case 'grade': jGrade(); break;
    case 'giveup': jGrade(true); break;
    case 'next': jNext(); break;
    case 'prev': if (JQ.i){ JQ.i--; render(); } break;
    case 'bm': { const it = JBY[JQ ? JQ.ids[JQ.i] : '']; if (it){ toggleBm(it.id); render(); } break; }
    case 'cflip': JC.flip = !JC.flip; render(); break;
    case 'cyes': jSwipe(1); break;
    case 'cno': jSwipe(-1); break;
    case 'cundo': jUndo(); break;
    case 'cquit': if (JC.review){ rvQuit(); break; } JC.i = JC.deck.length; render(); break;
    case 'rvskip': { const it = JBY[JQ.ids[JQ.i]]; rvSkip('j:'+it.id); jNext(); break; }
    case 'cskip': { if (JC.i >= JC.deck.length) break; const id = JC.deck[JC.i][0]; rvSkip('j:'+id); JC.deck = JC.deck.filter((c,n) => n < JC.i || c[0]!==id); JC.flip = false; render(); break; }
    case 'rvnext': rvNextPhase(); break;
    case 'cbm': { if (JC.i < JC.deck.length){ toggleBm(JC.deck[JC.i][0]); render(); } break; }
    case 'cagain': { const d = shuffle(JC.dunno); JC = { deck: d, i:0, flip:false, know:[], dunno:[], hist:[], round: JC.round+1, review: JC.review }; render(); break; }
    case 'creshuffle': { const d = shuffle(JC.deck); JC = { deck: d, i:0, flip:false, know:[], dunno:[], hist:[], round: 1, review: JC.review }; render(); break; }
    case 'wrong-card': case 'wrong-quiz': {
      const pairs = []; JI.forEach(it => { if (JLG[it.l]!==JG) return; it.a.forEach((x,k) => { if (isActiveWrong(jkey(it.id,k))) pairs.push([it.id,k]); }); });
      const t = jTargetsFrom(pairs); const list = Object.keys(t).map(id => JBY[id]);
      jStart(list, { mode: a==='wrong-card' ? 'card' : (P.jyMode==='card' ? 'choice' : P.jyMode), targets: t, order: 'random', count: 0 }); break; }
    case 'rwrong-card': case 'rwrong-quiz': {
      const t = jTargetsFrom(JR.wrong); const list = Object.keys(t).map(id => JBY[id]);
      jStart(list, { mode: a==='rwrong-card' ? 'card' : (P.jyMode==='card' ? 'choice' : P.jyMode), targets: t, order: 'random', count: 0 }); break; }
  }
}
document.addEventListener('keydown', e => {
  if (!view.startsWith('jy')) return;
  if (e.target.matches('textarea, select, input[type=date]')) return;
  if (view==='jyc' && JC){
    if (e.key==='ArrowRight'){ e.preventDefault(); jSwipe(1); }
    else if (e.key==='ArrowLeft'){ e.preventDefault(); jSwipe(-1); }
    else if (e.key===' ' || e.key==='ArrowUp' || e.key==='ArrowDown'){ if (JC.i < JC.deck.length){ e.preventDefault(); JC.flip = !JC.flip; render(); } }
    else if (e.key==='z' || e.key==='Z'){ jUndo(); }
    return;
  }
  if (view==='jyq' && JQ){
    const it = JBY[JQ.ids[JQ.i]], q = jQS(it);
    if (e.target.matches('input[data-jin]')) return;
    if (e.key==='Enter'){ e.preventDefault(); if (q.submitted) jNext(); else jGrade(); return; }
    const n = parseInt(e.key, 10);
    if (JQ.mode==='choice' && n>=1 && n<=9 && !q.submitted) jPick(n-1);
  }
});


/* ================= 복습 루틴 · 날짜별 기록 ================= */
const dstr = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const dayAdd = (s, n) => { const d = new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return dstr(d); };
const DOW = ['일','월','화','수','목','금','토'];
const mdLabel = s => { const d = new Date(s+'T00:00:00'); return `${d.getMonth()+1}/${d.getDate()} (${DOW[d.getDay()]})`; };
const DAYS = () => (S.days = S.days || {});
// value bits: 1 = 틀림, 2 = 복습 세션에서만 풂
const vComb = (a, b) => ((a|b)&1) | ((a&b)&2);
function rvCtxReview(){
  if (view==='quiz') return !!(session && session.review);
  if (view==='jyq') return !!(JQ && JQ.review);
  if (view==='jyc') return !!(JC && JC.review);
  return false;
}
function rvLog(key, ok){
  const d = today(), D = DAYS(), m = D[d] || (D[d] = {});
  const nv = (ok ? 0 : 1) | (rvCtxReview() ? 2 : 0);
  m[key] = (key in m) ? vComb(m[key], nv) : nv;
}
function rvFix(key){ const m = DAYS()[today()]; if (m && key in m){ m[key] = m[key] & 2; persist(); } }
function rvPeek(key, day){ const m = DAYS()[day||today()]; return m ? m[key] : undefined; }
function rvRestore(key, v, day){ const m = DAYS()[day]; if (!m) return; if (v===undefined) delete m[key]; else m[key] = v; }
function rvBackfill(){
  try{
    if (P.daysBF) return;
    jMigrateK(); if (!P.jyKmap1 && JD.kmap) return;
    if (hooks.loadState && syncState!=='cloud') return;
    const D = DAYS(), seen = new Set();
    Object.values(D).forEach(m => Object.keys(m).forEach(k => seen.add(k)));
    for (const [k,s] of Object.entries(S.st)){
      if (!s || !s.t || seen.has(k)) continue;
      const d = dstr(new Date(s.t)); (D[d] = D[d] || {})[k] = s.l==='x' ? 1 : 0;
    }
    P.daysBF = 1; persist();
  }catch(e){}
}

/* ---- 날짜별 세트 ---- */
const BIDX = {}; ITEMS.forEach((it,i) => BIDX[it.id] = i);
const JIDX = {}; JI.forEach((it,i) => JIDX[it.id] = i);
function keyInfo(k){
  const i = k.indexOf('#');
  if (i < 0) return BYID[k] ? { t:'b', id:k } : null;
  const id = k.slice(0,i), it = JBY[id]; if (!it) return null;
  return { t: SUBJ[JLG[it.l]] ? JLG[it.l] : 'jy', id, k: +k.slice(i+1) };
}
function rvSet(d){
  const m = DAYS()[d] || {};
  const bank = new Map(), J = { jy:new Map(), sl:new Map(), zg:new Map() };
  for (const [k,v] of Object.entries(m)){
    const inf = keyInfo(k); if (!inf) continue;
    if (inf.t==='b'){ const u = bank.get(inf.id) || { id:inf.id, x:false, fresh:false }; if (v&1) u.x = true; if (!(v&2)) u.fresh = true; bank.set(inf.id, u); }
    else { const mp = J[inf.t]; const u = mp.get(inf.id) || { id:inf.id, solved:[], wrong:[], fresh:false }; u.solved.push(inf.k); if (v&1) u.wrong.push(inf.k); if (!(v&2)) u.fresh = true; mp.set(inf.id, u); }
  }
  const why = u => { const r = []; if (u.x || (u.wrong && u.wrong.length)) r.push('x'); if (u.fresh && S.bm[u.id]) r.push('bm'); if (u.fresh && S.memo[u.id]) r.push('memo'); return r; };
  const out = { d, bank:[], jy:[], sl:[], zg:[], n:{ x:0, bm:0, memo:0 }, solved: bank.size + J.jy.size + J.sl.size + J.zg.size, keys: Object.keys(m).length };
  bank.forEach(u => { const w = why(u); if (!w.length) return; out.bank.push({ key:'b:'+u.id, t:'b', id:u.id, why:w, grad: u.x && !isActiveWrong(u.id) }); });
  JGS.forEach(g => J[g].forEach(u => {
    const w = why(u); if (!w.length) return;
    const it = JBY[u.id];
    const tg = [...new Set(u.wrong.length ? u.wrong : u.solved)].filter(k => it.a[k]).sort((a,b) => a-b);
    if (!tg.length) return;
    const grad = u.wrong.length > 0 && u.wrong.every(k => !isActiveWrong(jkey(u.id,k)));
    out[g].push({ key:'j:'+u.id, t:g, id:u.id, tg, why:w, grad });
  }));
  out.bank.sort((a,b) => BIDX[a.id]-BIDX[b.id]); JGS.forEach(g => out[g].sort((a,b) => JIDX[a.id]-JIDX[b.id]));
  out.all = [...out.bank, ...out.jy, ...out.sl, ...out.zg];
  out.all.forEach(u => u.why.forEach(w => out.n[w]++));
  return out;
}
function rvProg(pk){ const R = (S.rvp = S.rvp || {}); return R[pk] || (R[pk] = { d:[], s:[] }); }
function rvStatus(pk, set){
  const p = (S.rvp||{})[pk] || { d:[], s:[] };
  const handled = set.all.filter(u => p.d.includes(u.key) || p.s.includes(u.key)).length;
  return { handled, total: set.all.length, done: set.all.length ? handled >= set.all.length : true };
}

/* ---- 루틴 ---- */
const RT = [
  { k:'d0', name:'오늘 정리', off:0,  hint:'오늘 푼 것 중 오답·북마크·메모를 다시 풀며 하루 마무리' },
  { k:'d1', name:'어제 복습', off:-1, hint:'어제 푼 것 중 오답·북마크·메모' },
  { k:'d7', name:'7일 전 복습', off:-7, hint:'일주일 전에 푼 것 중 오답·북마크·메모' },
];
const RTD = () => (S.routine = S.routine || {});
function rtState(day){
  const T = day || today(), R = RTD(), rec = R[T] || { a:{}, m:{} };
  return RT.map(r => {
    const d = dayAdd(T, r.off), set = rvSet(d), pk = r.k+':'+d, st = rvStatus(pk, set);
    const empty = !set.all.length;
    const auto = r.k==='d0' ? (!empty && st.done) : st.done;
    return { ...r, d, set, pk, st, empty, auto, manual: !!(rec.m||{})[r.k], done: auto || !!(rec.m||{})[r.k] };
  });
}
function rtSync(rows){
  const T = today(), R = RTD(), rec = R[T] || (R[T] = { a:{}, m:{} }); rec.a = rec.a || {}; rec.m = rec.m || {};
  let ch = false;
  rows.forEach(r => { const v = r.auto ? 1 : 0; if ((rec.a[r.k]||0) !== v){ if (v) rec.a[r.k] = 1; else delete rec.a[r.k]; ch = true; } });
  if (ch) persist();
}
function dayDoneCount(d){ const rec = RTD()[d]; if (!rec) return 0; return RT.filter(r => (rec.a||{})[r.k] || (rec.m||{})[r.k]).length; }
function rtStreak(){
  let n = 0, d = today();
  if (dayDoneCount(d) < 3) d = dayAdd(d, -1);
  while (dayDoneCount(d) >= 3){ n++; d = dayAdd(d, -1); }
  return n;
}
function whyTags(why){ return why.map(w => w==='x' ? '<span class="tag bad">오답</span>' : w==='bm' ? '<span class="tag warn">★ 북마크</span>' : '<span class="tag">메모</span>').join(''); }
function setSummary(set){
  const parts = [];
  if (set.n.x) parts.push(`오답 ${set.n.x}`); if (set.n.bm) parts.push(`★${set.n.bm}`); if (set.n.memo) parts.push(`메모 ${set.n.memo}`);
  const sub = [];
  if (set.bank.length) sub.push(`문제은행 ${set.bank.length}`); if (set.jy.length) sub.push(`집요 ${set.jy.length}`); if (set.sl.length) sub.push(`생리학 ${set.sl.length}`); if (set.zg.length) sub.push(`총강 ${set.zg.length}`);
  return { reasons: parts.join(' · '), subj: sub.join(' · ') };
}
function rvRoutineHTML(){
  const rows = rtState(); rtSync(rows);
  const streak = rtStreak();
  const T = today();
  const mon = dayAdd(T, -((new Date(T+'T00:00:00').getDay()+6)%7));
  const week = Array.from({length:7}, (_,i) => dayAdd(mon, i));
  return `<div class="panel rt">
    <div class="row" style="justify-content:space-between"><h2>오늘의 루틴 <span class="muted" style="font-weight:500;font-size:13px">${mdLabel(T)}</span></h2>
      <span class="rt-streak">${streak ? `루틴 연속 <b>${streak}</b>일째` : '오늘부터 루틴 시작'}</span></div>
    <div class="rt-list">${rows.map((r,i) => { const sm = setSummary(r.set); const pct = r.st.total ? Math.round(r.st.handled/r.st.total*100) : 0;
      const label = r.empty ? (r.k==='d0' ? '아직 오늘 푼 문제가 없어요' : '복습할 문제 없음') : (sm.reasons + (sm.subj ? ` <span class="muted">· ${sm.subj}</span>` : ''));
      const btn = r.empty ? '' : r.st.done ? `<button class="btn" type="button" data-rtgo="${r.k}">다시 보기</button>` : `<button class="btn primary" type="button" data-rtgo="${r.k}">${r.st.handled ? '이어서' : '시작'}</button>`;
      return `<div class="rt-row${r.done?' done':''}">
        <button type="button" class="rt-ck" data-rtck="${r.k}" aria-pressed="${r.done}" aria-label="${r.name} 체크" title="${r.auto?'자동 완료':'눌러서 직접 체크'}">${r.done?'✓':''}</button>
        <div class="rt-body"><div class="rt-t"><b>${i+1}. ${r.name}</b> <span class="muted">${r.k==='d0'?'':mdLabel(r.d)}</span>${r.manual && !r.auto ? '<span class="tag">직접 체크</span>' : ''}</div>
          <div class="rt-s">${label}</div>
          ${!r.empty ? `<div class="rt-prog"><div class="bar"><i style="width:${pct}%"></i></div><span>${r.st.handled}/${r.st.total}</span></div>` : ''}</div>
        <div class="rt-go">${btn}</div></div>`; }).join('')}</div>
    <div class="rt-foot"><span class="flabel">빈칸(집요·생리·총강) 푸는 방식</span>${['choice','short','card'].map(m => `<button type="button" class="chip" data-rvmode="${m}" aria-pressed="${(P.rvMode||'choice')===m}">${m==='choice'?'선지형':m==='short'?'단답형':'카드형'}</button>`).join('')}</div>
    <div class="rt-week">${week.map(d => { const n = dayDoneCount(d); const solved = Object.keys(DAYS()[d]||{}).length; const isT = d===T;
      return `<button type="button" class="rt-day${isT?' today':''}${d>T?' future':''}" data-ntday="${d}" ${d>T?'disabled':''} aria-label="${mdLabel(d)} 루틴 ${n}/3">
        <span class="w">${DOW[new Date(d+'T00:00:00').getDay()]}</span><span class="dot f${n}"></span><span class="c">${solved?solved:''}</span></button>`; }).join('')}</div>
  </div>`;
}

/* ---- 복습 세션: 문제은행 → 집요 → 생리학 → 총강 ---- */
let RVS = null;
const RVNAME = { d0:'오늘 정리', d1:'어제 복습', d7:'7일 전 복습', cal:'날짜별 복습' };
function rvStart(kind, d){
  const set = rvSet(d), pk = kind+':'+d, p = rvProg(pk);
  let left = u => !p.d.includes(u.key) && !p.s.includes(u.key);
  if (!set.all.length){ toast('복습할 문제가 없어요'); return; }
  if (!set.all.some(left)){ p.d = []; p.s = []; left = () => true; toast('다시 처음부터 풀어요'); }
  const phases = [['b',set.bank],['jy',set.jy],['sl',set.sl],['zg',set.zg]].map(([t,us]) => ({ t, units: us.filter(left) })).filter(x => x.units.length);
  RVS = { pk, d, kind, set, phases, pi:-1, label: RVNAME[kind] + ' · ' + mdLabel(d) };
  persist(); rvNextPhase();
}
function rvNextPhase(){
  if (!RVS) return;
  RVS.pi++;
  const ph = RVS.phases[RVS.pi];
  if (!ph){ const done = RVS; RVS = null; session = null; JQ = null; JC = null; RVDONE = done; view = 'rvdone'; render(); window.scrollTo(0,0); return; }
  const label = ph.t==='b' ? '문제은행' : SUBJ[ph.t].name;
  if (RVS.pi > 0) toast(`${label} ${ph.units.length}개 이어서 풀어요`);
  if (ph.t==='b') startSession(ph.units.map(u => BYID[u.id]), { order:'seq', count:0, mode:'study', review: RVS });
  else {
    JG = ph.t;
    const targets = {}; ph.units.forEach(u => targets[u.id] = u.tg);
    jStart(ph.units.map(u => JBY[u.id]), { mode: P.rvMode || 'choice', targets, order:'seq', count:0, review: RVS });
  }
}
function rvUnit(key){ return RVS && RVS.set.all.find(u => u.key===key); }
function rvMark(key){ if (!RVS) return; const p = rvProg(RVS.pk); if (!p.d.includes(key)) p.d.push(key); p.s = p.s.filter(x => x!==key); persist(); }
function rvSkip(key){ if (!RVS) return; const p = rvProg(RVS.pk); if (!p.d.includes(key) && !p.s.includes(key)) p.s.push(key); persist(); }
function rvQuit(){ toast('진행 상황을 저장했어요. 홈에서 이어서 풀 수 있어요'); RVS = null; session = null; JQ = null; JC = null; view = 'home'; render(); window.scrollTo(0,0); }
function rvPhaseLabel(){
  if (!RVS) return '';
  const ph = RVS.phases[RVS.pi]; const names = RVS.phases.map((p,i) => `<span class="${i===RVS.pi?'on':i<RVS.pi?'past':''}">${p.t==='b'?'문제은행':SUBJ[p.t].short} ${p.units.length}</span>`).join('<i>→</i>');
  return `<div class="rv-bar"><b>${esc(RVS.label)}</b><span class="rv-steps">${names}</span></div>`;
}
function rvTagsHTML(key){
  const u = rvUnit(key); if (!u) return '';
  return whyTags(u.why) + (u.grad ? '<span class="tag school" title="이미 오답노트에서 졸업한 문제">졸업</span>' : '');
}
let RVDONE = null;
function rvDoneHTML(){
  const r = RVDONE; if (!r){ view='home'; return homeHTML(); }
  const st = rvStatus(r.pk, rvSet(r.d));
  const rows = rtState(); rtSync(rows);
  return `<h1>${esc(RVNAME[r.kind])} 끝</h1>
  <div class="panel row" style="justify-content:space-between;align-items:flex-end">
    <div><div class="result-big">${(S.rvp[r.pk]||{d:[]}).d.length}<span class="muted" style="font-size:20px"> / ${st.total}</span></div><div class="muted">${mdLabel(r.d)} 세트 · 다시 푼 문제 ${(S.rvp[r.pk]||{d:[]}).d.length}개 · 넘긴 문제 ${(S.rvp[r.pk]||{s:[]}).s.length}개</div></div>
    <div class="row"><button class="btn" type="button" data-go="notes" data-ntday-go="${r.d}">이 날짜 목록 보기</button><button class="btn primary" type="button" data-go="home">홈으로</button></div>
  </div>
  <div class="panel"><h2 style="margin-bottom:8px">오늘의 루틴</h2>${rows.map((x,i) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span>${x.done?'✅':'⬜'} ${i+1}. ${x.name}</span><span class="muted">${x.empty?'없음':x.st.handled+'/'+x.st.total}</span></div>`).join('')}</div>`;
}

/* ---- 집요·생리 블록 메모 ---- */
function jMemoHTML(it){
  const m = S.memo[it.id] || '';
  return `<details class="memo-d" ${m?'open':''}><summary>블록 메모${m?' (있음)':''}</summary><textarea class="memo" data-jmemo="${esc(it.id)}" placeholder="헷갈린 빈칸, 외우는 요령, 교재 쪽수 등을 적어 두세요.">${esc(m)}</textarea></details>`;
}

/* ---- 복습 노트: 과목 탭 · 모아보기 · 날짜별 ---- */
let NT = { subj:'bank', mode:'list', per:'all', date: null, month: null, jk:'wrong', q:'' };
function ntDates(){
  const T = today();
  if (NT.per==='d0') return [T]; if (NT.per==='d1') return [dayAdd(T,-1)]; if (NT.per==='d7') return [dayAdd(T,-7)];
  if (NT.per==='date') return [NT.date || T];
  return null;
}
function solvedOn(dates, t, id){
  for (const d of dates){ const m = DAYS()[d]; if (!m) continue;
    if (t==='b'){ if (id in m) return true; }
    else { const p = id+'#'; for (const k in m) if (k.startsWith(p)) return true; } }
  return false;
}
function rvPerOK(t, id){ const ds = ntDates(); return !ds || solvedOn(ds, t, id); }
function perChips(){
  const T = today();
  const opts = [['all','전체 기간'],['d0','오늘'],['d1','어제'],['d7','7일 전 ('+mdLabel(dayAdd(T,-7))+')'],['date', NT.per==='date' && NT.date ? mdLabel(NT.date) : '날짜 선택…']];
  return `<div class="chips">${opts.map(([v,l]) => `<button type="button" class="chip" data-ntper="${v}" aria-pressed="${NT.per===v}">${l}</button>`).join('')}${NT.per==='date'?`<input type="date" class="btn" id="ntdate" value="${esc(NT.date||T)}" max="${T}" style="padding:4px 8px">`:''}</div>`;
}
function notesHTML(){
  if (!NT.date) NT.date = today();
  if (!NT.month) NT.month = NT.date.slice(0,7);
  const tabs = [['bank','문제은행'],['jy','집요 복습'],['sl','생리학 복습'],['zg','총강 복습']];
  const head = `<h1>복습 노트</h1>
  <div class="seg" role="tablist">${tabs.map(([k,l]) => `<button type="button" role="tab" data-ntsubj="${k}" aria-selected="${NT.subj===k}">${l}</button>`).join('')}</div>
  <div class="seg sm" role="tablist">${[['list','모아보기'],['date','날짜별']].map(([k,l]) => `<button type="button" role="tab" data-ntmode="${k}" aria-selected="${NT.mode===k}">${l}</button>`).join('')}</div>`;
  if (NT.mode==='date') return head + calHTML();
  if (NT.subj==='bank') return head + notesBankHTML();
  return head + jNotesHTML(NT.subj);
}
function jUnitHTML(it, opts={}){
  const g = JLG[it.l], wk = opts.tg || it.a.map((a,k)=>k).filter(k => isActiveWrong(jkey(it.id,k)));
  const memo = S.memo[it.id];
  let w = 0, c = 0; it.a.forEach((a,k) => { const s = S.st[jkey(it.id,k)]; if (s){ w += s.w; c += s.c; } });
  return `<div class="nitem">
    <div class="top"><div class="meta"><span class="tag school">${esc(JLN[it.l])}</span><span class="tag">${esc(it.s)}</span><span class="tag">p.${it.p}</span>${opts.why?whyTags(opts.why):''}${opts.grad?'<span class="tag school">졸업</span>':''}</div>
      <div class="row" style="gap:4px"><span class="cnt" style="color:${w?'var(--bad)':'var(--ink3)'}">틀림 ${w} · 맞음 ${c}</span><button type="button" class="star" data-jbm="${esc(it.id)}" aria-pressed="${!!S.bm[it.id]}" aria-label="북마크">${S.bm[it.id]?'★':'☆'}</button></div></div>
    ${jDoc(it, n => `<span class="blank ${wk.includes(n)?'wrongb':'given'}">${esc(it.a[n])}</span>`)}
    ${memo ? `<div class="ansline"><div><b>메모</b> ${esc(memo)}</div></div>` : ''}
    <div class="row"><button class="btn" type="button" data-jone="${esc(it.id)}" data-jtg="${wk.join(',')}">${wk.length?`틀린 ${wk.length}칸 풀기`:'이 블록 풀기'}</button></div></div>`;
}
function jNotesFiltered(g){
  const q = NT.q.trim().toLowerCase();
  return JI.filter(it => {
    if (JLG[it.l] !== g) return false;
    const keys = it.a.map((a,k) => jkey(it.id,k));
    if (NT.jk==='wrong' && !keys.some(isActiveWrong)) return false;
    if (NT.jk==='ever' && !keys.some(k => (S.st[k]||{}).w)) return false;
    if (NT.jk==='bm' && !S.bm[it.id]) return false;
    if (NT.jk==='memo' && !S.memo[it.id]) return false;
    if (!rvPerOK('j', it.id)) return false;
    if (q && !(it.a.join(' ')+' '+it.s+' '+(S.memo[it.id]||'')).toLowerCase().includes(q)) return false;
    return true;
  });
}
function jNotesHTML(g){
  const list = jNotesFiltered(g);
  const nb = list.reduce((a,it) => a + it.a.filter((x,k) => isActiveWrong(jkey(it.id,k))).length, 0);
  const show = list.slice(0, 60);
  return `<div class="panel field">
    <div class="chips">${[['wrong','오답 빈칸'],['ever','한 번이라도 틀림'],['bm','북마크'],['memo','메모']].map(([v,l]) => `<button type="button" class="chip" data-ntjk="${v}" aria-pressed="${NT.jk===v}">${l}</button>`).join('')}</div>
    ${perChips()}
    <input class="search" id="ntq" type="search" placeholder="빈칸 정답·소단원·메모로 찾기" value="${esc(NT.q)}">
    <div class="row" style="justify-content:space-between"><span class="muted">${list.length}블록${NT.jk==='wrong'?` · 오답 빈칸 ${nb}개`:''}</span>
      <div class="row"><button class="btn" type="button" data-ntjgo="card" ${list.length?'':'disabled'}>카드로 복습</button><button class="btn primary" type="button" data-ntjgo="quiz" ${list.length?'':'disabled'}>이 목록 풀기</button></div></div>
  </div>
  ${list.length ? `<div class="jy-wl">${show.map(it => jUnitHTML(it)).join('')}</div>${list.length>60?`<p class="muted">외 ${list.length-60}블록 — 위 버튼으로 전체를 풀 수 있어요</p>`:''}` : `<div class="empty">해당하는 블록이 없어요.</div>`}`;
}
function calHTML(){
  const T = today(), [y, mo] = NT.month.split('-').map(Number);
  const first = new Date(y, mo-1, 1), start = first.getDay(), days = new Date(y, mo, 0).getDate();
  const cells = [];
  for (let i=0; i<start; i++) cells.push('<span class="cal-c empty"></span>');
  for (let dd=1; dd<=days; dd++){
    const d = `${y}-${String(mo).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    const n = Object.keys(DAYS()[d]||{}).length;
    const lv = n===0 ? 0 : n<20 ? 1 : n<60 ? 2 : n<150 ? 3 : 4;
    const rc = dayDoneCount(d);
    cells.push(`<button type="button" class="cal-c lv${lv}${d===NT.date?' sel':''}${d===T?' today':''}" data-ntday="${d}" ${d>T?'disabled':''} aria-label="${mdLabel(d)} ${n}문항">${dd}${rc?`<i class="rc r${rc}"></i>`:''}</button>`);
  }
  const set = rvSet(NT.date), sm = setSummary(set), pk = 'cal:'+NT.date, st = rvStatus(pk, set);
  const listFor = NT.subj==='bank' ? set.bank : set[NT.subj];
  const body = listFor.length
    ? (NT.subj==='bank' ? `<div class="jy-wl">${listFor.map(u => rvBankUnitHTML(u)).join('')}</div>` : `<div class="jy-wl">${listFor.map(u => jUnitHTML(JBY[u.id], { tg:u.tg, why:u.why, grad:u.grad })).join('')}</div>`)
    : `<div class="empty">${set.solved ? '이 과목에는 이 날의 오답·북마크·메모가 없어요.' : '이 날 푼 문제가 없어요.'}</div>`;
  return `<div class="cal-wrap">
    <div class="panel cal">
      <div class="row" style="justify-content:space-between"><button class="btn ghost" type="button" data-ntmon="-1" aria-label="이전 달">◀</button><b>${y}년 ${mo}월</b><button class="btn ghost" type="button" data-ntmon="1" aria-label="다음 달" ${NT.month>=T.slice(0,7)?'disabled':''}>▶</button></div>
      <div class="cal-g">${DOW.map(w => `<span class="cal-h">${w}</span>`).join('')}${cells.join('')}</div>
      <div class="cal-legend"><span><i class="lv lv1"></i>푼 양</span><span><i class="rc r3"></i>루틴 완료</span></div>
    </div>
    <div class="panel field">
      <div class="row" style="justify-content:space-between"><h2>${mdLabel(NT.date)}</h2><span class="muted">푼 문항·빈칸 ${set.keys}</span></div>
      ${set.all.length ? `<div>${sm.reasons}<br><span class="muted">${sm.subj}</span></div>
        <div class="rt-prog"><div class="bar"><i style="width:${st.total?Math.round(st.handled/st.total*100):0}%"></i></div><span>${st.handled}/${st.total}</span></div>
        <div class="row"><button class="btn primary" type="button" data-rvcal="${NT.date}">${st.handled && !st.done ? '이어서 풀기' : '이 세트 풀기'}</button><span class="muted" style="font-size:12.5px">문제은행 → 집요 → 생리학 → 총강 순서</span></div>`
        : `<div class="muted">${set.solved ? '이 날은 오답·북마크·메모가 없어요.' : '이 날 푼 기록이 없어요.'}</div>`}
    </div>
  </div>
  <h2>${NT.subj==='bank'?'문제은행':SUBJ[NT.subj].name} · ${mdLabel(NT.date)}</h2>
  ${body}`;
}
function rvBankUnitHTML(u){
  const html = noteItemHTML(BYID[u.id]);
  return html.replace('<div class="meta">', `<div class="meta">${whyTags(u.why)}`);
}

/* ---- 바인딩 ---- */
function rvBind(){
  const v = $('#view');
  v.querySelectorAll('[data-rtgo]').forEach(b => b.onclick = () => { const r = rtState().find(x => x.k===b.dataset.rtgo); rvStart(r.k, r.d); });
  v.querySelectorAll('[data-rtck]').forEach(b => b.onclick = () => {
    const k = b.dataset.rtck, T = today(), R = RTD(), rec = R[T] || (R[T] = { a:{}, m:{} }); rec.m = rec.m || {};
    const r = rtState().find(x => x.k===k);
    if (r.auto){ toast('다 풀어서 자동으로 체크됐어요'); return; }
    if (rec.m[k]) delete rec.m[k]; else rec.m[k] = 1;
    persist(); render();
  });
  v.querySelectorAll('[data-rvmode]').forEach(b => b.onclick = () => { P.rvMode = b.dataset.rvmode; persist(); render(); });
  v.querySelectorAll('[data-ntday]').forEach(b => b.onclick = () => { NT.date = b.dataset.ntday; NT.month = NT.date.slice(0,7); NT.mode = 'date'; if (view!=='notes'){ view = 'notes'; window.scrollTo(0,0); } render(); });
  v.querySelectorAll('[data-ntday-go]').forEach(b => b.addEventListener('click', () => { NT.date = b.dataset.ntdayGo; NT.month = NT.date.slice(0,7); NT.mode = 'date'; }, true));
  v.querySelectorAll('[data-ntsubj]').forEach(b => b.onclick = () => { NT.subj = b.dataset.ntsubj; render(); });
  v.querySelectorAll('[data-ntmode]').forEach(b => b.onclick = () => { NT.mode = b.dataset.ntmode; render(); });
  v.querySelectorAll('[data-ntper]').forEach(b => b.onclick = () => { NT.per = b.dataset.ntper; if (NT.per==='date' && !NT.date) NT.date = today(); render(); });
  const nd = $('#ntdate'); if (nd) nd.onchange = () => { if (nd.value){ NT.date = nd.value; render(); } };
  v.querySelectorAll('[data-ntmon]').forEach(b => b.onclick = () => { const [y,m] = NT.month.split('-').map(Number); const d = new Date(y, m-1+(+b.dataset.ntmon), 1); NT.month = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); render(); });
  v.querySelectorAll('[data-ntjk]').forEach(b => b.onclick = () => { NT.jk = b.dataset.ntjk; render(); });
  const nq = $('#ntq'); if (nq) nq.oninput = () => { NT.q = nq.value; const pos = nq.selectionStart; render(); const n2 = $('#ntq'); if (n2){ n2.focus(); n2.setSelectionRange(pos,pos); } };
  v.querySelectorAll('[data-ntjgo]').forEach(b => b.onclick = () => {
    const g = NT.subj, list = jNotesFiltered(g); JG = g;
    const targets = {};
    list.forEach(it => { const ks = it.a.map((a,k)=>k).filter(k => it.a[k]);
      const wk = ks.filter(k => NT.jk==='ever' ? (S.st[jkey(it.id,k)]||{}).w : isActiveWrong(jkey(it.id,k)));
      targets[it.id] = (NT.jk==='wrong' || NT.jk==='ever') && wk.length ? wk : jTargets(it); });
    jStart(list.filter(it => targets[it.id].length), { mode: b.dataset.ntjgo==='card' ? 'card' : (P.jyMode==='card' ? 'choice' : P.jyMode), targets, order:'random', count:0 });
  });
  v.querySelectorAll('[data-jone]').forEach(b => b.onclick = () => {
    const it = JBY[b.dataset.jone]; JG = JLG[it.l];
    const tg = b.dataset.jtg ? b.dataset.jtg.split(',').map(Number) : jTargets(it);
    jStart([it], { mode: P.jyMode==='card' ? 'choice' : P.jyMode, targets: { [it.id]: tg.length ? tg : jTargets(it) }, order:'seq', count:0 });
  });
  v.querySelectorAll('[data-jbm]').forEach(b => b.onclick = () => { toggleBm(b.dataset.jbm); render(); });
  v.querySelectorAll('[data-rvcal]').forEach(b => b.onclick = () => rvStart('cal', b.dataset.rvcal));
  v.querySelectorAll('[data-jmemo]').forEach(t => t.oninput = () => { const id = t.dataset.jmemo; if (t.value.trim()) S.memo[id] = t.value; else delete S.memo[id]; persist(); });
}

/* 카드 탭 (cards.js) */
var CARDS = window.HanuiCards ? window.HanuiCards({ getS: () => S, persist, toast, esc, shuffle, go: v => go(v), rerender: () => render(), isActive: () => view==='cards' }) : null;
applyTheme();
render();
/* 다른 곳에서 가져온 기록(예: 예전 Claude 아티팩트)을 지금 기록과 합친다 */
function importState(obj){
  const m = mergeState(obj); Object.assign(P, m.prefs); m.prefs = P; S = m; applyTheme(); persist(); render();
}
return { importState, exportState: () => JSON.parse(JSON.stringify(S)), render };
};