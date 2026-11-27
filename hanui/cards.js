/* 카드 탭: 생물 미니(app/src/Cards.tsx · DeckEditor.tsx · deckdata.ts)의 카드 기능을 빌드 없는 JS로 옮긴 것.
   컨닝페이퍼(마크다운 표) → 카드 덱. 오른쪽으로 밀면 알아요, 왼쪽은 몰라요, 탭하면 뒤집기. 미니 퀴즈는 4지선다.
   - 형식: '# 덱 이름', '## 묶음 이름', '| 항목 | 내용 |' 표의 각 줄이 카드 한 장
   - 기록: S.decks(덱), S.cards(카드별 기억), S.deckMeta(폴더·고정·보관), S.folders. app.js의 mergeState가 합친다.
   app.js가 HanuiCards(ctx)를 부르고, 돌려받은 render(v)/bind()를 카드 화면에서 쓴다. */
window.HanuiCards = function (ctx) {
  const esc = ctx.esc, shuffle = ctx.shuffle, toast = ctx.toast;
  const S = () => ctx.getS();
  const $ = (s, r = document) => r.querySelector(s);
  const DAY = 86400000;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ───────── 덱 데이터 (deckdata.ts) ───────── */
  const BUILT_IN = []; // 기본 덱: { id, md, createdAt } (지금은 없음 — 빈 상태로 시작)
  const HEADER_WORDS = new Set(['항목', '용어', '개념', '키워드', '질문', '앞면']);
  const plain = s => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^\w])_(.+?)_(?=[^\w]|$)/g, '$1$2').trim();
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); }
  function splitRow(line) {
    const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
    return inner.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  }
  const isSeparator = cells => cells.every(c => /^:?-{2,}:?$/.test(c) || c === '');
  const isHeader = cells => HEADER_WORDS.has(plain(cells[0])) || plain(cells[1] || '') === '내용';

  let keySeq = 0;
  const newKey = () => 'k' + (++keySeq);
  function toEditModel(md, fallbackTitle = '') {
    let title = ''; const sections = []; let cur = null;
    for (const raw of String(md || '').split(/\r?\n/)) {
      const line = raw.trim();
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        if (h[1].length === 1 && !title) title = plain(h[2]);
        else { cur = { key: newKey(), title: plain(h[2]), rows: [] }; sections.push(cur); }
        continue;
      }
      if (!line.startsWith('|')) continue;
      const cells = splitRow(line);
      if (cells.length < 2 || isSeparator(cells) || isHeader(cells)) continue;
      if (!cur) { cur = { key: newKey(), title: '', rows: [] }; sections.push(cur); }
      cur.rows.push({ key: newKey(), front: plain(cells[0]), back: cells.slice(1).filter(Boolean).join(' / ') });
    }
    if (!sections.length) sections.push({ key: newKey(), title: '', rows: [{ key: newKey(), front: '', back: '' }] });
    return { title: title || fallbackTitle, sections };
  }
  const cellOut = s => s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
  function fromEditModel(m) {
    const out = [];
    if (m.title.trim()) out.push('# ' + m.title.trim(), '');
    for (const s of m.sections) {
      const rows = s.rows.filter(r => r.front.trim() || r.back.trim());
      if (!rows.length && !s.title.trim()) continue;
      if (s.title.trim()) out.push('## ' + s.title.trim(), '');
      out.push('| 항목 | 내용 |', '| --- | --- |');
      for (const r of rows) out.push(`| ${r.front.trim() ? `**${cellOut(plain(r.front))}**` : ''} | ${cellOut(r.back)} |`);
      out.push('');
    }
    return out.join('\n');
  }
  function parseCheatSheet(id, md, fallbackTitle = '컨닝페이퍼') {
    let title = ''; const sections = []; let cur = null; const seen = new Set();
    for (const raw of String(md || '').split(/\r?\n/)) {
      const line = raw.trim();
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const text = plain(h[2]);
        if (h[1].length === 1 && !title) title = text;
        else { cur = { title: text, cards: [] }; sections.push(cur); }
        continue;
      }
      if (!line.startsWith('|')) continue;
      const cells = splitRow(line);
      if (cells.length < 2 || isSeparator(cells) || isHeader(cells)) continue;
      const front = cells[0], back = cells.slice(1).filter(Boolean).join(' / ');
      if (!plain(front) || !back) continue;
      if (!cur) { cur = { title: '', cards: [] }; sections.push(cur); }
      const si = sections.indexOf(cur);
      let cid = `${id}:${hash(si + '|' + plain(front))}`;
      while (seen.has(cid)) cid += 'x';
      seen.add(cid);
      cur.cards.push({ id: cid, front, back, section: cur.title, sectionIndex: si });
    }
    const kept = sections.filter(s => s.cards.length);
    kept.forEach((s, i) => {
      if (!s.title) s.title = kept.length === 1 ? '전체' : `묶음 ${i + 1}`;
      s.cards.forEach(c => { c.section = s.title; c.sectionIndex = i; });
    });
    return { title: title || fallbackTitle, sections: kept };
  }
  function toDeck(id, md, builtIn, createdAt, title, overridden = false) {
    const p = parseCheatSheet(id, md, title);
    return { id, title: title || p.title, builtIn, createdAt, sections: p.sections, cards: p.sections.flatMap(s => s.cards), md, overridden };
  }
  let memo = null;
  /** 기본 덱 + 만든 덱(지운 것 제외), 최근 것 먼저 */
  function allDecks() {
    const st = S();
    if (memo && memo.decks === st.decks) return memo.out;
    const saved = st.decks || {};
    const builtInIds = new Set(BUILT_IN.map(b => b.id));
    const user = Object.values(saved).filter(d => !builtInIds.has(d.id) && !d.deleted && d.md).map(d => toDeck(d.id, d.md, false, d.createdAt, d.title));
    const builtIns = BUILT_IN.map(b => {
      const o = saved[b.id];
      return o && !o.deleted && o.md ? toDeck(b.id, o.md, true, b.createdAt, o.title, true) : toDeck(b.id, b.md, true, b.createdAt);
    });
    const out = [...builtIns, ...user].sort((a, b) => b.createdAt - a.createdAt);
    memo = { decks: st.decks, out };
    return out;
  }
  const findDeck = id => allDecks().find(d => d.id === id);
  /** 'new' 아직 안 봄, 'learning' 마지막에 몰랐음, 'known' 마지막에 알았음 */
  function cardState(id) { const c = (S().cards || {})[id]; return !c ? 'new' : c.last ? 'known' : 'learning'; }
  function deckProgress(cards) {
    let known = 0, learning = 0;
    for (const c of cards) { const s = cardState(c.id); if (s === 'known') known++; else if (s === 'learning') learning++; }
    return { known, learning, fresh: cards.length - known - learning, total: cards.length };
  }
  const deckIdOf = cardId => cardId.slice(0, cardId.indexOf(':'));
  let lastMemo = null;
  function lastStudiedMap() {
    const st = S();
    if (lastMemo && lastMemo.cards === st.cards) return lastMemo.out;
    const out = {};
    for (const [id, c] of Object.entries(st.cards || {})) { const d = deckIdOf(id); if (!out[d] || c.t > out[d]) out[d] = c.t; }
    lastMemo = { cards: st.cards, out };
    return out;
  }
  /** 알아요를 이어서 받을수록 다시 볼 간격을 늘린다(1·2·4·8·16·30일). 몰라요면 바로 다시 */
  function reviewInterval(ok, ng) { const k = Math.max(1, ok - ng); return [1, 2, 4, 8, 16, 30][Math.min(k - 1, 5)] * DAY; }
  /** 오늘 다시 볼 카드: 몰라요였던 카드 + 알아요였지만 간격이 지난 카드(보관한 덱은 간격의 2배) */
  function dueCards(now = Date.now(), max = 60) {
    const st = S(), metas = st.deckMeta || {}, out = [];
    for (const d of allDecks()) {
      const archived = !!(metas[d.id] || {}).archived;
      for (const c of d.cards) {
        const s = (st.cards || {})[c.id];
        if (!s) continue;
        if (!s.last) { if (!archived) out.push({ ...c, deckId: d.id, overdue: Number.MAX_SAFE_INTEGER - (now - s.t) }); continue; }
        const wait = reviewInterval(s.ok, s.ng) * (archived ? 2 : 1);
        if (now - s.t >= wait) out.push({ ...c, deckId: d.id, overdue: now - s.t - wait });
      }
    }
    return out.sort((a, b) => b.overdue - a.overdue).slice(0, max);
  }
  const folderList = () => Object.values(S().folders || {}).filter(f => !f.deleted).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  function searchCards(q, max = 40) {
    const needle = q.trim().toLowerCase().replace(/\s+/g, '');
    if (!needle) return { decks: [], cards: [] };
    const norm = s => plain(s).toLowerCase().replace(/\s+/g, '');
    const decks = [], cards = [];
    for (const d of allDecks()) {
      if (norm(d.title).includes(needle)) decks.push(d);
      for (const c of d.cards) if (cards.length < max && (norm(c.front).includes(needle) || norm(c.back).includes(needle))) cards.push({ deck: d, card: c });
    }
    return { decks, cards };
  }
  function relDay(t, now = Date.now()) {
    if (!t) return '안 봄';
    const a = new Date(now); a.setHours(0, 0, 0, 0);
    const days = Math.round((a.getTime() - new Date(t).setHours(0, 0, 0, 0)) / DAY);
    return days <= 0 ? '오늘' : days === 1 ? '어제' : days < 30 ? `${days}일 전` : `${Math.round(days / 30)}달 전`;
  }

  /* ───────── 기록 바꾸기 (lib.ts의 store) ───────── */
  const store = {
    markCard(id, ok) {
      const st = S(), c = (st.cards || {})[id] || { ok: 0, ng: 0, last: ok, t: 0 };
      st.cards = { ...(st.cards || {}), [id]: { ok: c.ok + (ok ? 1 : 0), ng: c.ng + (ok ? 0 : 1), last: ok, t: Date.now() } };
      ctx.persist();
    },
    saveDeck(d) {
      const st = S(), now = Date.now(), id = d.id || 'u-' + uid(), old = (st.decks || {})[id];
      st.decks = { ...(st.decks || {}), [id]: { id, title: d.title, md: d.md, createdAt: (old && old.createdAt) || now, u: now } };
      ctx.persist(); return id;
    },
    setDeckMeta(id, patch) {
      const st = S(), old = (st.deckMeta || {})[id] || { u: 0 };
      st.deckMeta = { ...(st.deckMeta || {}), [id]: { ...old, ...patch, u: Date.now() } };
      ctx.persist();
    },
    saveFolder(name, id) {
      const st = S(), fid = id || 'f-' + uid(), old = (st.folders || {})[fid], now = Date.now();
      st.folders = { ...(st.folders || {}), [fid]: { id: fid, name, createdAt: (old && old.createdAt) || now, u: now } };
      ctx.persist(); return fid;
    },
    /** 폴더를 지우면 안의 덱은 '폴더 없음'으로 */
    deleteFolder(id) {
      const st = S(), old = (st.folders || {})[id]; if (!old) return;
      const now = Date.now(), metas = { ...(st.deckMeta || {}) };
      for (const [k, m] of Object.entries(metas)) if (m.folder === id) metas[k] = { ...m, folder: undefined, u: now };
      st.deckMeta = metas;
      st.folders = { ...(st.folders || {}), [id]: { ...old, deleted: true, u: now } };
      ctx.persist();
    },
    deleteDeck(id) {
      const st = S(), old = (st.decks || {})[id]; if (!old) return;
      st.decks = { ...(st.decks || {}), [id]: { ...old, md: '', deleted: true, u: Date.now() } };
      ctx.persist();
    },
  };

  /* ───────── 그리기 도우미 ───────── */
  /** **굵게**, _기울임_ 만 살려서 보여 준다 */
  function rich(text) {
    return String(text || '').split(/(\*\*.+?\*\*|_[^_\s][^_]*_)/g).filter(p => p !== '').map(p =>
      p.startsWith('**') && p.endsWith('**') && p.length > 4 ? `<strong>${esc(p.slice(2, -2))}</strong>` : /^_.+_$/.test(p) ? `<em>${esc(p.slice(1, -1))}</em>` : esc(p)).join('');
  }
  const bar = p => `<span class="deck-bar" role="img" aria-label="${p.total}장 중 알아요 ${p.known}장, 몰라요 ${p.learning}장"><span class="db-known" style="width:${p.known / Math.max(p.total, 1) * 100}%"></span><span class="db-learning" style="width:${p.learning / Math.max(p.total, 1) * 100}%"></span></span>`;
  const strip = (cells, cur) => `<div class="c-strip" role="img" aria-label="카드 진행" style="grid-template-columns:repeat(${cells.length},1fr)">${cells.map((c, i) => `<span class="cell ${c === true ? 'c-ok' : c === false ? 'c-ng' : ''} ${cur === i ? 'cur' : ''}"></span>`).join('')}</div>`;
  const ICON = {
    search: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    archive: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 5h16v4H4zM5 9v10h14V9M10 13h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    pin: '<svg class="pin" viewBox="0 0 24 24" width="14" height="14" aria-label="고정됨"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    undo: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dchev: '<svg class="dr-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  /* ───────── 화면 상태 ───────── */
  const REVIEW_ID = '__review__';
  const SORTS = [['recent', '최근 공부한 순'], ['weak', '모르는 카드 많은 순'], ['name', '이름순']];
  const UI_KEY = 'hanui:cardsui';
  function readUI() {
    try { const v = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); return { sort: v.sort || 'recent', folded: Array.isArray(v.folded) ? v.folded : ['__archived'] }; }
    catch (e) { return { sort: 'recent', folded: ['__archived'] }; }
  }
  let UI = readUI();
  function setUI(p) { UI = { ...UI, ...p }; try { localStorage.setItem(UI_KEY, JSON.stringify(UI)); } catch (e) {} }

  /* CV: 지금 카드 화면. p = home | deck | edit | play */
  let CV = { p: 'home', q: '' };
  let pendingFocus = null;
  function open(next) { CV = next; ctx.go('cards'); }
  const rerender = () => ctx.rerender();

  /* ───────── 첫 화면: 덱 목록 ───────── */
  function deckRow(d, p, last, pinned) {
    return `<li><button type="button" class="deck-row" data-c="deck" data-id="${esc(d.id)}">
      <span class="dr-main"><span class="dr-title">${pinned ? ICON.pin : ''}${esc(d.title)}</span>
        <span class="c-meta">${d.cards.length}장 · ${relDay(last)}${p.learning ? ` · 몰라요 ${p.learning}` : ''}</span></span>
      ${bar(p)}${ICON.dchev}</button></li>`;
  }
  function folderGroup(id, name, count, archive, inner) {
    const folded = UI.folded.includes(id);
    const editing = CV.editFolder === id, arm = CV.armDelFolder === id;
    let tools = '';
    if (editing) tools = `<form class="inline-form" data-cform="renameFolder" data-id="${esc(id)}"><input name="v" value="${esc(name)}" aria-label="폴더 이름" data-autofocus><button type="submit" class="btn primary c-sm">저장</button><button type="button" class="btn ghost c-sm" data-c="cancelEditFolder">취소</button></form>`;
    else {
      tools = `<span class="folder-count c-meta">${count}덱</span>`;
      if (!archive) tools += arm
        ? `<span class="folder-tools"><button type="button" class="btn ghost c-sm" data-c="cancelDelFolder">취소</button><button type="button" class="btn c-ngbtn c-sm" data-c="delFolder" data-id="${esc(id)}">폴더만 지우기</button></span>`
        : `<span class="folder-tools"><button type="button" class="icon-btn c-sm" aria-label="${esc(name)} 이름 바꾸기" title="이름 바꾸기" data-c="editFolder" data-id="${esc(id)}">${ICON.pen}</button><button type="button" class="icon-btn c-sm" aria-label="${esc(name)} 폴더 지우기" title="폴더 지우기(안의 덱은 남아요)" data-c="armDelFolder" data-id="${esc(id)}">✕</button></span>`;
    }
    return `<section class="folder ${folded ? 'is-folded' : ''}" aria-label="${esc(name)}">
      <div class="folder-head"><button type="button" class="folder-toggle" aria-expanded="${!folded}" data-c="fold" data-id="${esc(id)}">${ICON.chev}${archive ? ICON.archive : ICON.folder}${editing ? '' : `<span class="folder-name">${esc(name)}</span>`}</button>${tools}</div>
      ${folded ? '' : inner}</section>`;
  }
  function homeBody() {
    const decks = allDecks(), metas = S().deckMeta || {}, folders = folderList(), last = lastStudiedMap();
    const m = id => metas[id] || {};
    const prog = {}; decks.forEach(d => prog[d.id] = deckProgress(d.cards));
    const row = d => deckRow(d, prog[d.id], last[d.id], !!m(d.id).pinned);
    if (CV.q.trim()) {
      const found = searchCards(CV.q);
      if (!found.decks.length && !found.cards.length) return `<p class="c-meta">'${esc(CV.q)}'에 맞는 덱이나 카드가 없어요.</p>`;
      return `<section aria-label="찾은 결과" class="search-results">
        ${found.decks.length ? `<ul class="deck-list">${found.decks.map(row).join('')}</ul>` : ''}
        ${found.cards.length ? `<h2 class="c-section-title">카드 ${found.cards.length}장</h2><ul class="hit-list">${found.cards.map(({ deck, card }) => `<li><button type="button" class="hit" data-c="deck" data-id="${esc(deck.id)}"><strong>${esc(plain(card.front))}</strong><span class="hit-back">${rich(card.back)}</span><span class="c-meta">${esc(deck.title)} · ${esc(card.section)}</span></button></li>`).join('')}</ul>` : ''}
      </section>`;
    }
    const due = dueCards();
    const sorted = list => [...list].sort((a, b) => {
      if (UI.sort === 'name') return a.title.localeCompare(b.title, 'ko');
      if (UI.sort === 'weak') return prog[b.id].learning - prog[a.id].learning || prog[b.id].fresh - prog[a.id].fresh;
      return (last[b.id] || 0) - (last[a.id] || 0) || b.createdAt - a.createdAt;
    });
    const live = decks.filter(d => !m(d.id).archived);
    const pinned = sorted(live.filter(d => m(d.id).pinned));
    const unpinned = live.filter(d => !m(d.id).pinned);
    const folderIds = new Set(folders.map(f => f.id));
    const loose = sorted(unpinned.filter(d => !m(d.id).folder || !folderIds.has(m(d.id).folder)));
    const archived = sorted(decks.filter(d => m(d.id).archived));
    let h = `<section class="today-cards" aria-labelledby="today-t"><div class="tc-main">
        <h2 id="today-t" class="tc-title">${due.length ? `오늘 다시 볼 카드 ${due.length}장` : '오늘 다시 볼 카드가 없어요'}</h2>
        <p class="c-meta">${due.length ? '모든 덱에서 몰라요였거나 오래 안 본 카드만 모았어요.' : '몰라요 카드나 다시 볼 때가 된 카드가 생기면 여기 모여요.'}</p></div>
        ${due.length ? `<div class="tc-actions"><button type="button" class="btn primary" data-c="play" data-id="${REVIEW_ID}" data-mode="flip">시작</button><button type="button" class="link-btn" data-c="play" data-id="${REVIEW_ID}" data-mode="quiz">퀴즈로</button></div>` : ''}</section>`;
    if (!decks.length) {
      h += `<div class="empty c-first">아직 덱이 없어요. <b>+ 새 덱</b>으로 만들어 보세요.<br><span class="c-meta">항목 | 내용 표를 붙여 넣으면 한 줄이 카드 한 장이 돼요.</span></div>`;
    } else {
      h += `<div class="chips sort-chips" role="group" aria-label="정렬">${SORTS.map(([k, l]) => `<button type="button" class="chip" aria-pressed="${UI.sort === k}" data-c="sort" data-v="${k}">${l}</button>`).join('')}</div>`;
      if (pinned.length) h += `<section aria-labelledby="pin-t"><h2 id="pin-t" class="group-title">고정</h2><ul class="deck-list">${pinned.map(row).join('')}</ul></section>`;
      folders.forEach(f => {
        const inFolder = decks.filter(d => m(d.id).folder === f.id);
        const list = sorted(unpinned.filter(d => m(d.id).folder === f.id));
        const pinnedN = inFolder.filter(d => m(d.id).pinned && !m(d.id).archived).length;
        const archivedN = inFolder.filter(d => m(d.id).archived).length;
        const elsewhere = [pinnedN ? `고정한 덱 ${pinnedN}개는 위` : '', archivedN ? `보관한 덱 ${archivedN}개는 아래` : ''].filter(Boolean).join(', ');
        h += folderGroup(f.id, f.name, inFolder.length, false,
          (list.length ? `<ul class="deck-list">${list.map(row).join('')}</ul>` : '') +
          (elsewhere ? `<p class="c-meta empty-folder">${elsewhere}에 있어요.</p>` : '') +
          (!inFolder.length ? `<p class="c-meta empty-folder">빈 폴더예요. 덱 화면의 '폴더 옮기기'로 넣을 수 있어요.</p>` : ''));
      });
      if (loose.length) h += `<section aria-label="${folders.length ? '폴더 없는 덱' : '덱'}">${folders.length ? '<h2 class="group-title">폴더 없음</h2>' : ''}<ul class="deck-list">${loose.map(row).join('')}</ul></section>`;
      if (archived.length) h += folderGroup('__archived', '다 외운 덱(보관)', archived.length, true, `<ul class="deck-list">${archived.map(row).join('')}</ul>`);
    }
    h += `<div class="row home-tools"><button type="button" class="btn" data-c="newDeck">+ 새 덱</button>${CV.newFolder == null
      ? `<button type="button" class="btn ghost" data-c="newFolder">+ 새 폴더</button>`
      : `<form class="inline-form" data-cform="newFolder"><input name="v" placeholder="폴더 이름 (예: 경락 · 장부)" aria-label="새 폴더 이름" data-autofocus><button type="submit" class="btn primary">만들기</button><button type="button" class="btn ghost" data-c="cancelNewFolder">취소</button></form>`}</div>`;
    return h;
  }
  function homeHTML() {
    return `<div class="cards-ui cards-home"><h1>카드</h1>
      <label class="c-search">${ICON.search}<span class="sr-only">덱이나 카드 찾기</span><input type="search" id="cq" value="${esc(CV.q)}" placeholder="덱·카드 찾기" autocomplete="off"></label>
      <div id="cbody">${homeBody()}</div></div>`;
  }

  /* ───────── 덱 화면 ───────── */
  function deckHTML() {
    const deck = findDeck(CV.id);
    if (!deck) return `<div class="cards-ui"><button type="button" class="c-back" data-c="home">카드</button><h1>덱을 찾을 수 없어요</h1></div>`;
    const meta = (S().deckMeta || {})[deck.id] || {}, folders = folderList();
    const p = deckProgress(deck.cards), weakN = p.learning + p.fresh;
    const folder = folders.find(f => f.id === meta.folder);
    return `<div class="cards-ui deck-page"><button type="button" class="c-back" data-c="home">카드</button>
      <h1>${esc(deck.title)}</h1>
      <p class="c-meta">${folder ? `${esc(folder.name)} 폴더 · ` : ''}${deck.cards.length}장 · 마지막 공부 ${relDay(lastStudiedMap()[deck.id])}${meta.pinned ? ' · 고정' : ''}${meta.archived ? ' · 보관함' : ''}</p>
      ${bar(p)}
      <p class="c-meta">알아요 ${p.known} · 몰라요 ${p.learning} · 안 본 카드 ${p.fresh}</p>
      <div class="row"><button type="button" class="btn primary" data-c="play" data-id="${esc(deck.id)}" data-mode="flip">카드 넘기기</button><button type="button" class="btn" data-c="play" data-id="${esc(deck.id)}" data-mode="quiz">미니 퀴즈</button>${p.known && weakN ? `<button type="button" class="btn" data-c="play" data-id="${esc(deck.id)}" data-mode="flip" data-only="weak">모르는 ${weakN}장만</button>` : ''}</div>
      <h2 class="c-section-title">묶음</h2>
      <ul class="sec-list">${deck.sections.map((s, i) => { const sp = deckProgress(s.cards); return `<li class="sec-row"><span class="sec-name">${esc(s.title)}</span>${bar(sp)}<span class="sec-n c-meta">${sp.known}/${sp.total}</span><span class="sec-actions"><button type="button" class="link-btn" data-c="play" data-id="${esc(deck.id)}" data-mode="flip" data-sec="${i}">카드</button><button type="button" class="link-btn" data-c="play" data-id="${esc(deck.id)}" data-mode="quiz" data-sec="${i}">퀴즈</button></span></li>`; }).join('')}</ul>
      <h2 class="c-section-title">정리</h2>
      <div class="row deck-tools"><button type="button" class="btn" data-c="edit" data-id="${esc(deck.id)}">고치기</button><button type="button" class="btn" aria-expanded="${!!CV.moving}" data-c="toggleMove">폴더 옮기기</button><button type="button" class="btn" aria-pressed="${!!meta.pinned}" data-c="pin">${meta.pinned ? '고정 풀기' : '위에 고정'}</button><button type="button" class="btn" aria-pressed="${!!meta.archived}" data-c="archive">${meta.archived ? '보관에서 꺼내기' : '다 외웠어요(보관)'}</button></div>
      ${CV.moving ? `<div class="move-box" role="group" aria-label="옮길 폴더"><div class="chips"><button type="button" class="chip" aria-pressed="${!folder}" data-c="moveTo" data-id="">폴더 없음</button>${folders.map(f => `<button type="button" class="chip" aria-pressed="${!!folder && folder.id === f.id}" data-c="moveTo" data-id="${esc(f.id)}">${esc(f.name)}</button>`).join('')}</div><form class="inline-form" data-cform="moveNew"><input name="v" placeholder="새 폴더 이름" aria-label="새 폴더 이름"><button type="submit" class="btn">새 폴더로 옮기기</button></form></div>` : ''}
      ${meta.archived ? `<p class="c-meta">보관한 덱의 카드는 다시 볼 간격이 두 배로 늘어나서 '오늘 다시 볼 카드'에 가끔만 나와요.</p>` : ''}
      ${!deck.builtIn ? `<div class="row c-del-row">${!CV.armDel ? `<button type="button" class="link-btn danger" data-c="armDelDeck">덱 지우기</button>` : `<span class="c-meta">이 덱을 지울까요?</span><button type="button" class="btn ghost" data-c="cancelDelDeck">취소</button><button type="button" class="btn c-ngbtn" data-c="delDeck">지우기</button>`}</div>` : ''}
    </div>`;
  }

  /* ───────── 덱 편집기 (DeckEditor.tsx) ───────── */
  function mdToHtml(md) {
    return esc(md).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w])_([^_\s][^_]*)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  }
  function htmlToMd(root) {
    let out = '';
    root.childNodes.forEach((n, i) => {
      if (n.nodeType === Node.TEXT_NODE) { out += (n.textContent || '').replace(/ /g, ' '); return; }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n, tag = el.tagName, inner = htmlToMd(el), weight = el.style && el.style.fontWeight;
      if (tag === 'BR') out += ' ';
      else if (tag === 'STRONG' || tag === 'B' || weight === 'bold' || Number(weight) >= 600) out += inner.trim() ? `**${inner}**` : inner;
      else if (tag === 'EM' || tag === 'I' || (el.style && el.style.fontStyle === 'italic')) out += inner.trim() ? `_${inner}_` : inner;
      else if (tag === 'DIV' || tag === 'P') out += (i > 0 && out && !out.endsWith(' ') ? ' ' : '') + inner;
      else out += inner;
    });
    return out.replace(/\*\*\*\*/g, '').replace(/__/g, '');
  }
  function placeCaretAtEnd(el) {
    el.focus();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} return; }
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  const looksLikeTable = t => t.split(/\r?\n/).filter(l => /^\s*\|.*\|/.test(l)).length >= 1 && /\n/.test(t.trim());

  function startEdit(deck, folder) {
    const m = toEditModel(deck ? deck.md : '', deck ? deck.title : '');
    if (deck && deck.title) m.title = deck.title;
    const foldKey = 'hanui:edfold:' + (deck ? deck.id : 'new');
    let folded = new Set();
    try {
      const saved = localStorage.getItem(foldKey);
      if (saved) { const titles = new Set(JSON.parse(saved)); folded = new Set(m.sections.filter(x => titles.has(x.title)).map(x => x.key)); }
      else { const total = m.sections.reduce((x, y) => x + y.rows.length, 0); if (total > 30 && m.sections.length > 1) folded = new Set(m.sections.map(x => x.key)); }
    } catch (e) {}
    CV = { p: 'edit', id: deck ? deck.id : null, ed: { initial: deck ? { id: deck.id, title: deck.title, md: deck.md, builtIn: deck.builtIn, overridden: deck.overridden } : null, folder: folder || null, mode: 'visual', model: m, md: fromEditModel(m), dirty: false, folded, foldKey } };
    ctx.go('cards');
  }
  const E = () => CV.ed;
  function saveFold() { const e = E(); try { localStorage.setItem(e.foldKey, JSON.stringify(e.model.sections.filter(x => e.folded.has(x.key)).map(x => x.title))); } catch (er) {} }
  const curMd = () => E().mode === 'visual' ? fromEditModel(E().model) : E().md;
  function edCount() { const p = parseCheatSheet('preview', curMd(), E().model.title || '컨닝페이퍼'); return { p, n: p.sections.reduce((x, s) => x + s.cards.length, 0) }; }
  function edStatusText() { const { p, n } = edCount(); return n ? `${p.sections.length}묶음, 카드 ${n}장` : '아직 카드가 없어요. 항목과 내용을 채워 주세요.'; }
  function refreshEdStatus() {
    const { n } = edCount(); const st = $('#edStatus'); if (st) st.textContent = edStatusText();
    const sv = $('[data-c="edSave"]'); if (sv) sv.disabled = !n;
  }
  const secOf = key => E().model.sections.find(s => s.key === key);
  function addRow(sk, afterKey, rows) {
    const fresh = rows || [{ key: newKey(), front: '', back: '' }];
    E().folded.delete(sk);
    const s = secOf(sk); const i = afterKey ? s.rows.findIndex(r => r.key === afterKey) + 1 : s.rows.length;
    s.rows.splice(i, 0, ...fresh);
    pendingFocus = `${fresh[fresh.length - 1].key}-${rows ? 'b' : 'f'}`;
    E().dirty = true; saveFold(); rerender();
  }
  function removeRow(sk, rk, focusPrev) {
    const s = secOf(sk), i = s.rows.findIndex(r => r.key === rk);
    if (focusPrev && i > 0) pendingFocus = `${s.rows[i - 1].key}-b`;
    s.rows.splice(i, 1); E().dirty = true; rerender();
  }
  function pasteTable(sk, afterKey, text) {
    const m = toEditModel(text);
    const rows = m.sections.flatMap(s => s.rows).filter(r => r.front || r.back);
    if (!rows.length) return;
    const s = secOf(sk), cur = s.rows.find(r => r.key === afterKey);
    if (cur && !cur.front && !cur.back) {
      const i = s.rows.indexOf(cur); s.rows.splice(i, 1, ...rows);
      pendingFocus = `${rows[rows.length - 1].key}-b`; E().dirty = true; rerender();
    } else addRow(sk, afterKey, rows);
  }
  function editHTML() {
    const e = E(), m = e.model, allFolded = m.sections.length > 0 && m.sections.every(x => e.folded.has(x.key));
    const backLabel = e.initial ? e.initial.title : '카드';
    let h = `<div class="cards-ui"><button type="button" class="c-back" data-c="edCancel">${esc(backLabel)}</button><h1 class="sr-only">${e.initial ? esc(e.initial.title) + ' 고치기' : '새 덱 만들기'}</h1>
      <div class="deck-editor ed"><div class="ed-bar">
        <div class="seg sm" role="tablist" aria-label="편집 방식"><button type="button" role="tab" aria-selected="${e.mode === 'visual'}" data-c="edMode" data-v="visual">편집</button><button type="button" role="tab" aria-selected="${e.mode === 'markdown'}" data-c="edMode" data-v="markdown">마크다운</button></div>
        <span class="spacer"></span>
        ${e.mode === 'visual' ? `${m.sections.length > 1 ? `<button type="button" class="ed-tool wide" data-c="edFoldAll">${allFolded ? '모두 펼치기' : '모두 접기'}</button>` : ''}<button type="button" class="ed-tool" data-fmt="bold" aria-label="굵게 (Ctrl+B)" title="굵게 (Ctrl+B)"><b>B</b></button><button type="button" class="ed-tool" data-fmt="italic" aria-label="기울임 (Ctrl+I)" title="기울임 (Ctrl+I)"><i>I</i></button>` : ''}
      </div>`;
    if (e.mode === 'visual') {
      h += `<input class="ed-title" data-ed="title" value="${esc(m.title)}" placeholder="덱 이름" aria-label="덱 이름" data-cell="title">`;
      m.sections.forEach((s, si) => {
        const fd = e.folded.has(s.key);
        h += `<section class="ed-sec ${fd ? 'is-folded' : ''}"><div class="ed-sec-head">
          <button type="button" class="ed-fold" aria-expanded="${!fd}" aria-label="${esc(s.title || '묶음')} ${fd ? '펼치기' : '접기'}" data-c="edFold" data-sk="${s.key}">${ICON.chev}</button>
          <input class="ed-h2" data-ed="sec" data-sk="${s.key}" data-cell="${s.key}-h" value="${esc(s.title)}" placeholder="묶음 이름 (예: 수태음폐경)" aria-label="${si + 1}번째 묶음 이름">
          <span class="ed-sec-tools"><button type="button" class="icon-btn c-sm" ${si === 0 ? 'disabled' : ''} data-c="edMoveSec" data-sk="${s.key}" data-d="-1" aria-label="묶음 위로">↑</button><button type="button" class="icon-btn c-sm" ${si === m.sections.length - 1 ? 'disabled' : ''} data-c="edMoveSec" data-sk="${s.key}" data-d="1" aria-label="묶음 아래로">↓</button>${e.armSec === s.key ? `<button type="button" class="btn c-ngbtn c-sm" data-c="edDelSec" data-sk="${s.key}">묶음 지우기</button>` : `<button type="button" class="icon-btn c-sm" data-c="edArmSec" data-sk="${s.key}" aria-label="묶음 지우기">✕</button>`}</span></div>`;
        if (fd) {
          h += `<button type="button" class="ed-folded" data-c="edFold" data-sk="${s.key}"><span class="ed-folded-n">카드 ${s.rows.filter(r => r.front || r.back).length}장</span><span class="ed-folded-peek">${esc(s.rows.map(r => plain(r.front)).filter(Boolean).slice(0, 4).join(' · '))}${s.rows.length > 4 ? ' …' : ''}</span></button>`;
        } else {
          h += `<div class="ed-table" role="table" aria-label="${esc(s.title || '묶음')} 카드"><div class="ed-row ed-headrow" role="row"><span role="columnheader">항목</span><span role="columnheader">내용</span><span></span></div>
            ${s.rows.map((r, ri) => `<div class="ed-row" role="row">
              <div class="ed-cell ed-front" contenteditable="true" role="textbox" aria-label="${ri + 1}번 카드 항목" data-cell="${r.key}-f" data-sk="${s.key}" data-rk="${r.key}" data-side="f" data-ph="항목" spellcheck="false">${mdToHtml(r.front)}</div>
              <div class="ed-cell ed-back" contenteditable="true" role="textbox" aria-label="${ri + 1}번 카드 내용" data-cell="${r.key}-b" data-sk="${s.key}" data-rk="${r.key}" data-side="b" data-ph="내용" spellcheck="false">${mdToHtml(r.back)}</div>
              <button type="button" class="icon-btn c-sm ed-del" data-c="edDelRow" data-sk="${s.key}" data-rk="${r.key}" aria-label="${ri + 1}번 카드 지우기">✕</button></div>`).join('')}</div>
            <button type="button" class="ed-add" data-c="edAddRow" data-sk="${s.key}">+ 카드</button>`;
        }
        h += `</section>`;
      });
      h += `<button type="button" class="btn ghost ed-addsec" data-c="edAddSec">+ 묶음 추가</button>
        <p class="c-meta ed-help">Enter로 항목 → 내용 → 다음 카드로 넘어가요. 빈 카드에서 Backspace를 누르면 지워져요. 다른 곳의 표(| 항목 | 내용 |)를 칸에 붙여 넣으면 여러 장이 한꺼번에 들어가요.</p>`;
    } else {
      h += `<div class="field"><label for="dk-md" class="flabel">마크다운 원문</label><textarea id="dk-md" data-ed="md" rows="14" placeholder="# 덱 이름&#10;&#10;## 수태음폐경&#10;| 항목 | 내용 |&#10;| --- | --- |&#10;| **起於** | 中焦 |">${esc(e.md)}</textarea></div>`;
    }
    const { n } = edCount();
    h += `<p class="c-meta" role="status" id="edStatus">${edStatusText()}</p><div class="row ed-actions">`;
    h += e.armCancel
      ? `<span class="c-meta">고친 내용을 버릴까요?</span><button type="button" class="btn ghost" data-c="edKeep">계속 고치기</button><button type="button" class="btn c-ngbtn" data-c="edDiscard">버리기</button>`
      : `<button type="button" class="btn ghost" data-c="edCancel">취소</button><button type="button" class="btn primary" data-c="edSave" ${n ? '' : 'disabled'}>${e.initial ? '저장' : '덱 만들기'}</button>`;
    h += `</div>`;
    if (e.initial && e.initial.builtIn && e.initial.overridden) {
      h += `<div class="row">${e.armRevert ? `<span class="c-meta">처음 받은 내용으로 되돌릴까요?</span><button type="button" class="btn ghost" data-c="edRevertNo">취소</button><button type="button" class="btn c-ngbtn" data-c="edRevert">되돌리기</button>` : `<button type="button" class="link-btn" data-c="edArmRevert">원래 내용으로 되돌리기</button>`}</div>`;
    }
    return h + `</div></div>`;
  }
  function edDone(savedId) {
    const e = E();
    if (savedId && !e.initial && e.folder) store.setDeckMeta(savedId, { folder: e.folder });
    if (savedId) open({ p: 'deck', id: savedId });
    else if (e.initial) open({ p: 'deck', id: e.initial.id });
    else open({ p: 'home', q: '' });
  }
  function edSwitch(next) {
    const e = E(); if (next === e.mode) return;
    if (next === 'markdown') e.md = fromEditModel(e.model);
    else {
      const m = toEditModel(e.md, e.model.title);
      const titles = new Set(e.model.sections.filter(x => e.folded.has(x.key)).map(x => x.title));
      e.folded = new Set(m.sections.filter(x => titles.has(x.title)).map(x => x.key));
      e.model = m;
    }
    e.mode = next; rerender();
  }

  /* ───────── 카드 풀기 ───────── */
  function reviewDeck() {
    const due = dueCards();
    const titles = {}; allDecks().forEach(d => titles[d.id] = d.title);
    const order = [], bySec = {};
    for (const c of due) { if (!bySec[c.deckId]) { bySec[c.deckId] = []; order.push(c.deckId); } bySec[c.deckId].push({ ...c, section: `${titles[c.deckId]} · ${c.section}` }); }
    const sections = order.map((d, i) => ({ title: titles[d], cards: bySec[d].map(c => ({ ...c, sectionIndex: i })) }));
    return { id: REVIEW_ID, title: '오늘 다시 볼 카드', builtIn: true, createdAt: 0, sections, cards: sections.flatMap(s => s.cards), md: '' };
  }
  /** opts: { deck, mode, sec, only, ids, rev } */
  function startPlay(opts) {
    const deck = opts.deck === REVIEW_ID ? reviewDeck() : findDeck(opts.deck);
    const P = { opts, deck, mode: opts.mode === 'quiz' ? 'quiz' : 'flip', rev: !!opts.rev };
    if (deck) {
      const sec = opts.sec != null && deck.sections[+opts.sec] ? deck.sections[+opts.sec] : null;
      let cards = sec ? sec.cards : deck.cards;
      if (opts.only === 'weak') cards = cards.filter(c => cardState(c.id) !== 'known');
      if (opts.only === 'ids') { const ids = new Set(opts.ids || []); cards = cards.filter(c => ids.has(c.id)); }
      P.base = cards; P.title = sec ? sec.title : deck.title;
      P.back = deck.id === REVIEW_ID ? { p: 'home', q: '' } : { p: 'deck', id: deck.id };
      resetRun(P);
    }
    open({ p: 'play', play: P });
  }
  function resetRun(P) {
    P.order = shuffle(P.base); P.idx = 0; P.results = {}; P.flipped = false; P.picked = {}; P.leaving = null;
    if (P.mode === 'quiz') P.options = quizOptions(P);
  }
  /* 보기: 같은 묶음에서 먼저, 모자라면 덱 전체에서(오늘 다시 볼 카드는 카드가 원래 있던 덱에서) */
  function quizOptions(P) {
    const m = {}, all = allDecks();
    for (const c of P.order) {
      const home = P.deck.id === REVIEW_ID ? (all.find(d => d.id === deckIdOf(c.id)) || P.deck) : P.deck;
      const hc = home.cards.find(x => x.id === c.id);
      const homeSec = hc ? hc.sectionIndex : c.sectionIndex;
      const same = home.cards.filter(x => x.id !== c.id && x.sectionIndex === homeSec);
      const rest = home.cards.filter(x => x.id !== c.id && x.sectionIndex !== homeSec);
      const key = x => P.rev ? plain(x.front) : plain(x.back);
      const seen = new Set([key(c)]), wrong = [];
      for (const x of [...shuffle(same), ...shuffle(rest)]) { if (wrong.length >= 3) break; if (seen.has(key(x))) continue; seen.add(key(x)); wrong.push(x); }
      m[c.id] = shuffle([c, ...wrong]);
    }
    return m;
  }
  function runTop(P) {
    const total = P.order.length, cells = P.order.map(c => c.id in P.results ? P.results[c.id] : 'empty');
    return `<div class="run-top"><button type="button" class="link-btn" data-c="exitPlay">나가기</button><span class="run-title">${esc(P.title)}</span><span class="run-count">${Math.min(P.idx + 1, total)}/${total}</span></div>
      ${strip(cells, P.idx < total ? P.idx : undefined)}
      <div class="card-opts"><button type="button" class="chip" aria-pressed="${P.rev}" data-c="toggleRev">${P.rev ? '내용 → 항목' : '항목 → 내용'}</button></div>`;
  }
  function summaryHTML(P, label) {
    const ok = P.order.filter(c => P.results[c.id] === true).length, ng = P.order.filter(c => P.results[c.id] === false);
    return `<div class="card-summary"><h2 class="c-big-title">다 넘겼어요</h2>
      <div class="score"><span class="score-big">${ok}</span><span class="score-of">/ ${P.order.length}</span><span class="c-meta">${label[0]} ${ok} · ${label[1]} ${ng.length}</span></div>
      ${strip(P.order.map(c => c.id in P.results ? P.results[c.id] : 'empty'))}
      ${ng.length ? `<ul class="ng-cards">${ng.map(c => `<li><strong>${esc(plain(c.front))}</strong><span>${rich(c.back)}</span></li>`).join('')}</ul>` : ''}
      <div class="row">${ng.length ? `<button type="button" class="btn primary" data-c="retryNg">${label[1]} ${ng.length}장 다시</button>` : ''}<button type="button" class="btn" data-c="restart">처음부터 다시</button><button type="button" class="btn ghost" data-c="exitPlay">${P.deck.id === REVIEW_ID ? '카드 탭으로' : '덱으로'}</button></div></div>`;
  }
  function playHTML() {
    const P = CV.play;
    if (!P.deck) return `<div class="cards-ui"><div class="empty">덱을 찾을 수 없어요.<br><button type="button" class="btn primary" data-c="home" style="margin-top:12px">카드 탭으로</button></div></div>`;
    if (!P.base.length) return `<div class="cards-ui"><div class="empty">${P.opts.only ? '모르는 카드가 없어요. 다 외웠어요!' : '카드가 없어요.'}<br><button type="button" class="btn primary" data-c="home" style="margin-top:12px">카드 탭으로</button></div></div>`;
    const done = P.idx >= P.order.length, card = P.order[P.idx];
    let h = `<div class="cards-ui runner cards-run">${runTop(P)}`;
    if (P.mode === 'flip') {
      if (done) h += summaryHTML(P, ['알아요', '몰라요']);
      else {
        const showBack = P.flipped !== P.rev;
        h += `<div class="card-stage">${P.order[P.idx + 1] ? '<div class="flash-card under" aria-hidden="true"></div>' : ''}
          <div class="flash-card ${P.flipped ? 'is-back' : ''}" id="fcard" data-swipe="flip" role="button" tabindex="0" aria-label="${P.flipped ? '뒷면. 탭하면 앞면' : '앞면. 탭하면 뒷면'}">
            <span class="swipe-hint c-hok">알아요</span><span class="swipe-hint c-hng">몰라요</span>
            <span class="fc-side">${showBack ? '내용' : '항목'}</span>
            <div class="fc-body">${showBack ? `<p class="fc-back">${rich(card.back)}</p>` : `<p class="fc-front">${esc(plain(card.front))}</p>`}</div>
            <span class="fc-section">${esc(card.section)}</span>${!P.flipped ? '<span class="fc-tap c-meta">탭해서 뒤집기</span>' : ''}
          </div></div>
          <div class="card-actions"><button type="button" class="btn c-ngbtn c-bigbtn" data-c="decide" data-v="0" aria-label="몰라요 (왼쪽으로 밀기)">← 몰라요</button><button type="button" class="icon-btn" data-c="undo" ${P.idx === 0 ? 'disabled' : ''} aria-label="되돌리기" title="되돌리기">${ICON.undo}</button><button type="button" class="btn c-okbtn c-bigbtn" data-c="decide" data-v="1" aria-label="알아요 (오른쪽으로 밀기)">알아요 →</button></div>
          <p class="c-meta swipe-help">카드를 오른쪽으로 밀면 알아요, 왼쪽은 몰라요 · 키보드 ← → 스페이스</p>`;
      }
    } else {
      if (done) h += summaryHTML(P, ['맞힘', '틀림']);
      else {
        const answered = card.id in P.picked;
        h += `<div class="card-stage quiz"><div class="flash-card quiz-card" id="fcard" data-swipe="quiz">
            <span class="fc-side">${P.rev ? '이 내용에 맞는 항목은?' : '이 항목의 내용은?'}</span>
            <div class="fc-body">${P.rev ? `<p class="fc-back">${rich(card.back)}</p>` : `<p class="fc-front">${esc(plain(card.front))}</p>`}</div>
            <span class="fc-section">${esc(card.section)}</span></div></div>
          <ol class="c-choices">${P.options[card.id].map((o, i) => {
            const chosen = P.picked[card.id] === i, correct = o.id === card.id;
            const cls = answered ? (correct ? 'correct' : chosen ? 'wrong' : '') : '';
            return `<li><button type="button" class="c-choice ${cls}" ${answered ? 'disabled' : ''} data-c="choose" data-i="${i}"><span class="mark" aria-hidden="true">${i + 1}</span><span class="ctext">${P.rev ? esc(plain(o.front)) : rich(o.back)}</span></button></li>`;
          }).join('')}</ol>
          ${answered ? `<p class="c-verdict ${P.results[card.id] ? 'ok' : 'ng'}" role="status">${P.results[card.id] ? '맞았어요' : '틀렸어요'}</p>` : ''}
          <div class="run-actions"><button type="button" class="btn" ${P.idx === 0 ? 'disabled' : ''} data-c="qprev">이전</button><button type="button" class="btn primary" data-c="qnext">${answered ? (P.idx === P.order.length - 1 ? '결과 보기' : '다음') : '건너뛰기'}</button></div>
          <p class="c-meta swipe-help">카드를 왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전 · 숫자키 1–4</p>`;
      }
    }
    return h + `</div>`;
  }
  function decide(ok) {
    const P = CV.play, card = P.order[P.idx];
    if (!card || P.leaving) return;
    store.markCard(card.id, ok);
    P.results[card.id] = ok; P.leaving = ok ? 'right' : 'left';
    const el = $('#fcard');
    if (el) { el.style.transform = ''; el.classList.add('leave-' + P.leaving); }
    setTimeout(() => { P.leaving = null; P.flipped = false; P.idx++; rerender(); }, 220);
  }
  function undo() {
    const P = CV.play; if (P.idx === 0 || P.leaving) return;
    const prev = P.order[P.idx - 1]; delete P.results[prev.id]; P.flipped = false; P.idx--; rerender();
  }
  function flip() { const P = CV.play; if (P.idx < P.order.length && !P.leaving) { P.flipped = !P.flipped; rerender(); } }
  function choose(i) {
    const P = CV.play, card = P.order[P.idx];
    if (!card || card.id in P.picked) return;
    const ok = P.options[card.id][i].id === card.id;
    store.markCard(card.id, ok);
    P.picked[card.id] = i; P.results[card.id] = ok; rerender();
  }
  const qnext = () => { const P = CV.play; P.idx = Math.min(P.idx + 1, P.order.length); rerender(); };
  const qprev = () => { const P = CV.play; P.idx = Math.max(P.idx - 1, 0); rerender(); };

  /* ───────── 이벤트 (한 번만 붙이고, 카드 화면일 때만 처리) ───────── */
  const view = () => document.getElementById('view');
  const active = () => ctx.isActive();
  function onClick(e) {
    if (!active()) return;
    const t = e.target.closest('[data-c]'); if (!t || !view().contains(t)) return;
    const c = t.dataset.c, id = t.dataset.id;
    const deck = () => findDeck(CV.id);
    switch (c) {
      /* 첫 화면 */
      case 'home': open({ p: 'home', q: '' }); break;
      case 'deck': open({ p: 'deck', id }); break;
      case 'sort': setUI({ sort: t.dataset.v }); rerender(); break;
      case 'fold': setUI({ folded: UI.folded.includes(id) ? UI.folded.filter(x => x !== id) : [...UI.folded, id] }); rerender(); break;
      case 'newDeck': startEdit(null); break;
      case 'newFolder': CV.newFolder = ''; rerender(); break;
      case 'cancelNewFolder': CV.newFolder = null; rerender(); break;
      case 'editFolder': CV.editFolder = id; CV.armDelFolder = null; rerender(); break;
      case 'cancelEditFolder': CV.editFolder = null; rerender(); break;
      case 'armDelFolder': CV.armDelFolder = id; rerender(); break;
      case 'cancelDelFolder': CV.armDelFolder = null; rerender(); break;
      case 'delFolder': store.deleteFolder(id); CV.armDelFolder = null; rerender(); toast('폴더를 지웠어요. 안의 덱은 남아 있어요'); break;
      /* 덱 화면 */
      case 'play': startPlay({ deck: id, mode: t.dataset.mode, sec: t.dataset.sec != null ? t.dataset.sec : null, only: t.dataset.only || null }); break;
      case 'edit': startEdit(deck()); break;
      case 'toggleMove': CV.moving = !CV.moving; rerender(); break;
      case 'moveTo': store.setDeckMeta(CV.id, { folder: id || undefined }); CV.moving = false; rerender(); break;
      case 'pin': { const m = (S().deckMeta || {})[CV.id] || {}; store.setDeckMeta(CV.id, { pinned: !m.pinned }); rerender(); break; }
      case 'archive': { const m = (S().deckMeta || {})[CV.id] || {}; store.setDeckMeta(CV.id, { archived: !m.archived, pinned: m.archived ? m.pinned : false }); rerender(); break; }
      case 'armDelDeck': CV.armDel = true; rerender(); break;
      case 'cancelDelDeck': CV.armDel = false; rerender(); break;
      case 'delDeck': store.deleteDeck(CV.id); open({ p: 'home', q: '' }); toast('덱을 지웠어요'); break;
      /* 풀기 */
      case 'exitPlay': open(CV.play.back); break;
      case 'toggleRev': { const P = CV.play; P.rev = !P.rev; resetRun(P); rerender(); break; }
      case 'decide': decide(t.dataset.v === '1'); break;
      case 'undo': undo(); break;
      case 'choose': choose(+t.dataset.i); break;
      case 'qnext': qnext(); break;
      case 'qprev': qprev(); break;
      case 'restart': resetRun(CV.play); rerender(); window.scrollTo(0, 0); break;
      case 'retryNg': { const P = CV.play; startPlay({ deck: P.deck.id === REVIEW_ID ? REVIEW_ID : P.deck.id, mode: 'flip', only: 'ids', ids: P.order.filter(x => P.results[x.id] === false).map(x => x.id), rev: P.rev }); break; }
      /* 편집기 */
      case 'edMode': edSwitch(t.dataset.v); break;
      case 'edFoldAll': { const e = E(), all = e.model.sections.every(x => e.folded.has(x.key)); e.folded = all ? new Set() : new Set(e.model.sections.map(x => x.key)); saveFold(); rerender(); break; }
      case 'edFold': { const e = E(), k = t.dataset.sk; if (e.folded.has(k)) e.folded.delete(k); else e.folded.add(k); saveFold(); rerender(); break; }
      case 'edMoveSec': { const a = E().model.sections, i = a.findIndex(s => s.key === t.dataset.sk), j = i + (+t.dataset.d); if (j >= 0 && j < a.length) { [a[i], a[j]] = [a[j], a[i]]; E().dirty = true; rerender(); } break; }
      case 'edArmSec': E().armSec = t.dataset.sk; rerender(); break;
      case 'edDelSec': { const e = E(); e.model.sections = e.model.sections.filter(s => s.key !== t.dataset.sk); e.armSec = null; e.dirty = true; rerender(); break; }
      case 'edDelRow': removeRow(t.dataset.sk, t.dataset.rk, false); break;
      case 'edAddRow': addRow(t.dataset.sk); break;
      case 'edAddSec': { const s = { key: newKey(), title: '', rows: [{ key: newKey(), front: '', back: '' }] }; E().model.sections.push(s); E().dirty = true; pendingFocus = `${s.key}-h`; rerender(); break; }
      case 'edCancel': if (E().dirty) { E().armCancel = true; rerender(); } else edDone(); break;
      case 'edKeep': E().armCancel = false; rerender(); break;
      case 'edDiscard': edDone(); break;
      case 'edSave': {
        const e = E(), text = curMd(), { p, n } = edCount(); if (!n) break;
        const title = (e.mode === 'visual' ? e.model.title : toEditModel(text, e.model.title).title).trim() || p.title;
        const sid = store.saveDeck({ id: e.initial ? e.initial.id : undefined, title, md: text });
        toast(e.initial ? '덱을 저장했어요' : '덱을 만들었어요'); edDone(sid); break;
      }
      case 'edArmRevert': E().armRevert = true; rerender(); break;
      case 'edRevertNo': E().armRevert = false; rerender(); break;
      case 'edRevert': { const iid = E().initial.id; store.deleteDeck(iid); edDone(iid); break; }
    }
  }
  function onSubmit(e) {
    if (!active()) return;
    const f = e.target.closest('form[data-cform]'); if (!f) return;
    e.preventDefault();
    const v = (f.querySelector('input[name="v"]') || {}).value || '';
    const name = v.trim();
    switch (f.dataset.cform) {
      case 'newFolder': if (name) store.saveFolder(name); CV.newFolder = null; rerender(); break;
      case 'renameFolder': if (name) store.saveFolder(name, f.dataset.id); CV.editFolder = null; rerender(); break;
      case 'moveNew': if (name) { const fid = store.saveFolder(name); store.setDeckMeta(CV.id, { folder: fid }); CV.moving = false; rerender(); } break;
    }
  }
  function onInput(e) {
    if (!active()) return;
    const t = e.target;
    if (t.id === 'cq') { CV.q = t.value; const b = $('#cbody'); if (b) b.innerHTML = homeBody(); return; }
    if (CV.p !== 'edit') return;
    const ed = E();
    if (t.dataset.ed === 'title') { ed.model.title = t.value; ed.dirty = true; refreshEdStatus(); return; }
    if (t.dataset.ed === 'sec') { const s = secOf(t.dataset.sk); if (s) s.title = t.value; ed.dirty = true; return; }
    if (t.dataset.ed === 'md') { ed.md = t.value; ed.dirty = true; refreshEdStatus(); return; }
    const cell = t.closest && t.closest('.ed-cell');
    if (cell) {
      if (!cell.textContent) cell.innerHTML = '';
      const s = secOf(cell.dataset.sk), r = s && s.rows.find(x => x.key === cell.dataset.rk);
      if (r) { r[cell.dataset.side === 'f' ? 'front' : 'back'] = htmlToMd(cell); ed.dirty = true; refreshEdStatus(); }
    }
  }
  function onKey(e) {
    if (!active()) return;
    if (CV.p === 'edit') {
      const t = e.target;
      if (t.dataset && t.dataset.ed === 'sec' && e.key === 'Enter') {
        e.preventDefault(); const s = secOf(t.dataset.sk); E().folded.delete(s.key);
        if (s.rows[0]) { pendingFocus = `${s.rows[0].key}-f`; rerender(); } else addRow(s.key);
        return;
      }
      if (t.dataset && t.dataset.ed === 'title' && e.key === 'Enter') { e.preventDefault(); const s = E().model.sections[0]; if (s) { pendingFocus = `${s.key}-h`; rerender(); } return; }
      const cell = t.closest && t.closest('.ed-cell'); if (!cell) return;
      const sk = cell.dataset.sk, rk = cell.dataset.rk, side = cell.dataset.side, s = secOf(sk), r = s.rows.find(x => x.key === rk);
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); document.execCommand(e.key === 'b' ? 'bold' : 'italic'); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (side === 'f') { const b = $(`[data-cell="${rk}-b"]`); if (b) placeCaretAtEnd(b); }
        else addRow(sk, rk);
      } else if (e.key === 'Backspace' && !cell.textContent) {
        if (side === 'f' && !r.back && s.rows.length > 1) { e.preventDefault(); removeRow(sk, rk, true); }
        else if (side === 'b') { e.preventDefault(); const f = $(`[data-cell="${rk}-f"]`); if (f) placeCaretAtEnd(f); }
      }
      return;
    }
    if (CV.p !== 'play' || !CV.play || !CV.play.deck) return;
    if (e.target.matches('input, textarea')) return;
    const P = CV.play, done = P.idx >= (P.order || []).length;
    if (P.mode === 'flip') {
      if (done) return;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); flip(); }
      else if (e.key === 'ArrowRight') decide(true);
      else if (e.key === 'ArrowLeft') decide(false);
      else if (e.key === 'z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
    } else {
      if (done) return;
      if (/^[1-4]$/.test(e.key)) choose(+e.key - 1);
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); qnext(); }
      else if (e.key === 'ArrowLeft') qprev();
    }
  }
  function onPaste(e) {
    if (!active() || CV.p !== 'edit') return;
    const cell = e.target.closest && e.target.closest('.ed-cell'); if (!cell) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (looksLikeTable(text)) pasteTable(cell.dataset.sk, cell.dataset.rk, text);
    else document.execCommand('insertText', false, text.replace(/\s*\r?\n\s*/g, ' '));
  }
  function onMouseDown(e) {
    if (!active()) return;
    const b = e.target.closest('[data-fmt]'); if (!b) return;
    e.preventDefault(); document.execCommand(b.dataset.fmt);
  }
  /* 손가락(마우스)으로 좌우로 미는 동작. 조금만 움직이면 탭으로 본다 */
  let drag = null;
  function onPointerDown(e) {
    if (!active() || CV.p !== 'play') return;
    const card = e.target.closest('.flash-card[data-swipe]'); if (!card || e.target.closest('button, a, input, textarea')) return;
    if (CV.play.idx >= CV.play.order.length || CV.play.leaving) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, dx: 0, el: card, kind: card.dataset.swipe };
    card.classList.add('dragging');
    try { card.setPointerCapture(e.pointerId); } catch (er) {}
  }
  function onPointerMove(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const x = e.clientX - drag.x, y = e.clientY - drag.y;
    if (Math.abs(x) > 6 || Math.abs(y) > 6) drag.moved = true;
    if (Math.abs(x) > Math.abs(y)) {
      drag.dx = x;
      drag.el.style.transform = drag.kind === 'flip' ? `translateX(${x}px) rotate(${x / 22}deg)` : `translateX(${x}px)`;
      const ok = drag.el.querySelector('.c-hok'), ng = drag.el.querySelector('.c-hng');
      if (ok) ok.classList.toggle('show', x > 40); if (ng) ng.classList.toggle('show', x < -40);
    }
  }
  function onPointerUp(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null;
    const w = d.el.offsetWidth || 320, x = e.clientX - d.x;
    d.el.classList.remove('dragging');
    const swiped = Math.abs(x) > Math.min(110, w * 0.28);
    if (!swiped) d.el.style.transform = '';
    if (d.kind === 'flip') {
      if (swiped) decide(x > 0);
      else if (!d.moved) flip();
    } else if (swiped) { d.el.style.transform = ''; if (x < 0) qnext(); else qprev(); }
  }
  function onPointerCancel() { if (drag) { drag.el.classList.remove('dragging'); drag.el.style.transform = ''; drag = null; } }

  const root = document.getElementById('view');
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('input', onInput);
  root.addEventListener('paste', onPaste);
  root.addEventListener('mousedown', onMouseDown);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('keydown', onKey);

  return {
    render(v) {
      if (CV.p === 'deck') v.innerHTML = deckHTML();
      else if (CV.p === 'edit' && CV.ed) v.innerHTML = editHTML();
      else if (CV.p === 'play' && CV.play) v.innerHTML = playHTML();
      else { if (CV.p !== 'home') CV = { p: 'home', q: '' }; v.innerHTML = homeHTML(); }
    },
    bind() {
      const af = document.querySelector('#view [data-autofocus]');
      if (af) placeCaretAtEnd(af);
      if (pendingFocus) { const el = document.querySelector(`#view [data-cell="${pendingFocus}"]`); pendingFocus = null; if (el) placeCaretAtEnd(el); }
    },
    /** 다른 탭에서 '카드'를 누르면 첫 화면으로 */
    home() { CV = { p: 'home', q: '' }; },
    dueCount: () => dueCards().length,
    deckCount: () => allDecks().length,
  };
};
