import React, { useEffect, useMemo, useRef, useState } from "react";
import { go, shuffle, store, useStore } from "./lib";
import { Card, Deck, allDecks, cardState, deckIdOf, deckProgress, dueCards, folderList, lastStudiedMap, plain, relDay, searchCards } from "./deckdata";
import { Strip, Cell } from "./ui";
import { DeckEditor } from "./DeckEditor";

/** **굵게**, _기울임_ 만 살려서 보여 준다 */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*.+?\*\*|_[^_\s][^_]*_)/g).filter((p) => p !== "");
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : /^_.+_$/.test(p) ? <em key={i}>{p.slice(1, -1)}</em> : <React.Fragment key={i}>{p}</React.Fragment>,
      )}
    </>
  );
}

function ProgressBar({ known, learning, total }: { known: number; learning: number; total: number }) {
  return (
    <span className="deck-bar" role="img" aria-label={`${total}장 중 알아요 ${known}장, 몰라요 ${learning}장`}>
      <span className="db-known" style={{ width: `${(known / Math.max(total, 1)) * 100}%` }} />
      <span className="db-learning" style={{ width: `${(learning / Math.max(total, 1)) * 100}%` }} />
    </span>
  );
}

const playUrl = (deck: string, opts: Record<string, string>) => `/cards/play?${new URLSearchParams({ deck, ...opts })}`;

/* ───────── 카드 탭 첫 화면: 덱 목록 ───────── */

const REVIEW_ID = "__review__";
type SortKey = "recent" | "weak" | "name";
const SORTS: [SortKey, string][] = [["recent", "최근 공부한 순"], ["weak", "모르는 카드 많은 순"], ["name", "이름순"]];

/** 이 기기에만 기억하는 보기 설정(정렬, 접은 폴더) */
const UI_KEY = "bioquiz:cardsui";
function readUI(): { sort: SortKey; folded: string[] } {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
    return { sort: v.sort || "recent", folded: Array.isArray(v.folded) ? v.folded : ["__archived"] };
  } catch {
    return { sort: "recent", folded: ["__archived"] };
  }
}
function writeUI(v: { sort: SortKey; folded: string[] }) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(v));
  } catch {}
}

export function CardsHome() {
  const st = useStore();
  const decks = allDecks(st);
  const metas = st.deckMeta || {};
  const folders = folderList(st);
  const last = lastStudiedMap(st);
  const due = dueCards(st);
  const [ui, setUI] = useState(readUI);
  const [q, setQ] = useState("");
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const update = (p: Partial<typeof ui>) => {
    const next = { ...ui, ...p };
    setUI(next);
    writeUI(next);
  };
  const toggleFold = (k: string) => update({ folded: ui.folded.includes(k) ? ui.folded.filter((x) => x !== k) : [...ui.folded, k] });

  const prog = useMemo(() => Object.fromEntries(decks.map((d) => [d.id, deckProgress(st, d.cards)])), [decks, st.cards]);
  const sorted = (list: Deck[]) =>
    [...list].sort((a, b) => {
      if (ui.sort === "name") return a.title.localeCompare(b.title, "ko");
      if (ui.sort === "weak") return prog[b.id].learning - prog[a.id].learning || prog[b.id].fresh - prog[a.id].fresh;
      return (last[b.id] || 0) - (last[a.id] || 0) || b.createdAt - a.createdAt;
    });
  const live = decks.filter((d) => !metas[d.id]?.archived);
  const pinned = sorted(live.filter((d) => metas[d.id]?.pinned));
  const unpinned = live.filter((d) => !metas[d.id]?.pinned);
  const folderIds = new Set(folders.map((f) => f.id));
  const loose = sorted(unpinned.filter((d) => !metas[d.id]?.folder || !folderIds.has(metas[d.id]!.folder!)));
  const archived = sorted(decks.filter((d) => metas[d.id]?.archived));
  const found = q.trim() ? searchCards(st, q) : null;

  const row = (d: Deck) => <DeckRow key={d.id} deck={d} p={prog[d.id]} last={last[d.id]} pinned={!!metas[d.id]?.pinned} />;

  return (
    <main className="page cards-home">
      <h1 className="page-title">카드</h1>
      <label className="search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span className="sr-only">덱이나 카드 찾기</span>
        <input type="search" value={q} placeholder="덱·카드 찾기" onChange={(e) => setQ(e.target.value)} />
      </label>

      {found ? (
        <section aria-label="찾은 결과" className="search-results">
          {!found.decks.length && !found.cards.length ? <p className="meta">'{q}'에 맞는 덱이나 카드가 없어요.</p> : null}
          {found.decks.length ? (
            <ul className="deck-list">{found.decks.map(row)}</ul>
          ) : null}
          {found.cards.length ? (
            <>
              <h2 className="section-title">카드 {found.cards.length}장</h2>
              <ul className="hit-list">
                {found.cards.map(({ deck, card }) => (
                  <li key={card.id}>
                    <a href={`#/cards/deck/${encodeURIComponent(deck.id)}`} className="hit">
                      <strong>{plain(card.front)}</strong>
                      <span className="hit-back"><Rich text={card.back} /></span>
                      <span className="meta">{deck.title} · {card.section}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : (
        <>
          <section className="today-cards" aria-labelledby="today-t">
            <div className="tc-main">
              <h2 id="today-t" className="tc-title">{due.length ? `오늘 다시 볼 카드 ${due.length}장` : "오늘 다시 볼 카드가 없어요"}</h2>
              <p className="meta">{due.length ? "모든 덱에서 몰라요였거나 오래 안 본 카드만 모았어요." : "몰라요 카드나 다시 볼 때가 된 카드가 생기면 여기 모여요."}</p>
            </div>
            {due.length ? (
              <div className="tc-actions">
                <button type="button" className="btn primary" onClick={() => go(playUrl(REVIEW_ID, { mode: "flip" }))}>시작</button>
                <button type="button" className="link-btn" onClick={() => go(playUrl(REVIEW_ID, { mode: "quiz" }))}>퀴즈로</button>
              </div>
            ) : null}
          </section>

          <div className="chips sort-chips" role="group" aria-label="정렬">
            {SORTS.map(([k, l]) => (
              <button key={k} type="button" className={`chip-btn ${ui.sort === k ? "on" : ""}`} aria-pressed={ui.sort === k} onClick={() => update({ sort: k })}>{l}</button>
            ))}
          </div>

          {pinned.length ? (
            <section aria-labelledby="pin-t">
              <h2 id="pin-t" className="group-title">고정</h2>
              <ul className="deck-list">{pinned.map(row)}</ul>
            </section>
          ) : null}

          {folders.map((f) => {
            const inFolder = decks.filter((d) => metas[d.id]?.folder === f.id);
            const list = sorted(unpinned.filter((d) => metas[d.id]?.folder === f.id));
            const pinnedN = inFolder.filter((d) => metas[d.id]?.pinned && !metas[d.id]?.archived).length;
            const archivedN = inFolder.filter((d) => metas[d.id]?.archived).length;
            const elsewhere = [pinnedN ? `고정한 덱 ${pinnedN}개는 위` : "", archivedN ? `보관한 덱 ${archivedN}개는 아래` : ""].filter(Boolean).join(", ");
            return (
              <FolderGroup key={f.id} id={f.id} name={f.name} count={inFolder.length} folded={ui.folded.includes(f.id)} onToggle={() => toggleFold(f.id)}>
                {list.length ? <ul className="deck-list">{list.map(row)}</ul> : null}
                {elsewhere ? <p className="meta empty-folder">{elsewhere}에 있어요.</p> : null}
                {!inFolder.length ? <p className="meta empty-folder">빈 폴더예요. 덱 화면의 '폴더 옮기기'로 넣을 수 있어요.</p> : null}
              </FolderGroup>
            );
          })}

          {loose.length ? (
            <section aria-label={folders.length ? "폴더 없는 덱" : "덱"}>
              {folders.length ? <h2 className="group-title">폴더 없음</h2> : null}
              <ul className="deck-list">{loose.map(row)}</ul>
            </section>
          ) : null}

          {archived.length ? (
            <FolderGroup id="__archived" name="다 외운 덱(보관)" archive count={archived.length} folded={ui.folded.includes("__archived")} onToggle={() => toggleFold("__archived")}>
              <ul className="deck-list">{archived.map(row)}</ul>
            </FolderGroup>
          ) : null}

          <div className="row home-tools">
            <button type="button" className="btn ghost" onClick={() => go("/cards/new")}>+ 새 덱</button>
            {newFolder === null ? (
              <button type="button" className="btn ghost" onClick={() => setNewFolder("")}>+ 새 폴더</button>
            ) : (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newFolder.trim()) store.saveFolder(newFolder.trim());
                  setNewFolder(null);
                }}
              >
                <input autoFocus value={newFolder} placeholder="폴더 이름 (예: 생물 · 단원 정리)" aria-label="새 폴더 이름" onChange={(e) => setNewFolder(e.target.value)} />
                <button type="submit" className="btn primary" disabled={!newFolder.trim()}>만들기</button>
                <button type="button" className="btn ghost" onClick={() => setNewFolder(null)}>취소</button>
              </form>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function FolderGroup({ id, name, count, folded, onToggle, archive, children }: { id: string; name: string; count: number; folded: boolean; onToggle: () => void; archive?: boolean; children: React.ReactNode }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [armDel, setArmDel] = useState(false);
  return (
    <section className={`folder ${folded ? "is-folded" : ""}`} aria-label={name}>
      <div className="folder-head">
        <button type="button" className="folder-toggle" aria-expanded={!folded} onClick={onToggle}>
          <svg className="chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            {archive ? (
              <path d="M4 5h16v4H4zM5 9v10h14V9M10 13h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
            ) : (
              <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            )}
          </svg>
          {editing === null ? <span className="folder-name">{name}</span> : null}
        </button>
        {editing !== null ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (editing.trim()) store.saveFolder(editing.trim(), id);
              setEditing(null);
            }}
          >
            <input autoFocus value={editing} aria-label="폴더 이름" onChange={(e) => setEditing(e.target.value)} />
            <button type="submit" className="btn primary sm">저장</button>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>취소</button>
          </form>
        ) : (
          <>
            <span className="folder-count meta">{count}덱</span>
            {!archive ? (
              armDel ? (
                <span className="folder-tools">
                  <button type="button" className="btn ghost sm" onClick={() => setArmDel(false)}>취소</button>
                  <button type="button" className="btn ng sm" onClick={() => store.deleteFolder(id)}>폴더만 지우기</button>
                </span>
              ) : (
                <span className="folder-tools">
                  <button type="button" className="icon-btn sm" aria-label={`${name} 이름 바꾸기`} title="이름 바꾸기" onClick={() => setEditing(name)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
                  </button>
                  <button type="button" className="icon-btn sm" aria-label={`${name} 폴더 지우기`} title="폴더 지우기(안의 덱은 남아요)" onClick={() => setArmDel(true)}>✕</button>
                </span>
              )
            ) : null}
          </>
        )}
      </div>
      {!folded ? children : null}
    </section>
  );
}

function DeckRow({ deck, p, last, pinned }: { deck: Deck; p: ReturnType<typeof deckProgress>; last?: number; pinned: boolean }) {
  return (
    <li>
      <a className="deck-row" href={`#/cards/deck/${encodeURIComponent(deck.id)}`}>
        <span className="dr-main">
          <span className="dr-title">
            {pinned ? (
              <svg className="pin" viewBox="0 0 24 24" width="14" height="14" aria-label="고정됨"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
            ) : null}
            {deck.title}
          </span>
          <span className="meta">{deck.cards.length}장 · {relDay(last)}{p.learning ? ` · 몰라요 ${p.learning}` : ""}</span>
        </span>
        <ProgressBar known={p.known} learning={p.learning} total={p.total} />
        <svg className="dr-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </a>
    </li>
  );
}

/* ───────── 덱 화면 ───────── */

export function DeckPage({ id }: { id: string }) {
  const st = useStore();
  const deck = allDecks(st).find((d) => d.id === id);
  const meta = st.deckMeta?.[id];
  const folders = folderList(st);
  const [armDel, setArmDel] = useState(false);
  const [moving, setMoving] = useState(false);
  const [newName, setNewName] = useState("");
  if (!deck) {
    return (
      <main className="page">
        <a className="back" href="#/cards">카드</a>
        <h1 className="page-title">덱을 찾을 수 없어요</h1>
      </main>
    );
  }
  const p = deckProgress(st, deck.cards);
  const weakN = p.learning + p.fresh;
  const folder = folders.find((f) => f.id === meta?.folder);
  const moveTo = (fid: string | undefined) => {
    store.setDeckMeta(id, { folder: fid });
    setMoving(false);
  };
  return (
    <main className="page deck-page">
      <a className="back" href="#/cards">카드</a>
      <h1 className="page-title">{deck.title}</h1>
      <p className="meta">
        {folder ? `${folder.name} 폴더 · ` : ""}{deck.cards.length}장 · 마지막 공부 {relDay(lastStudiedMap(st)[id])}
        {meta?.pinned ? " · 고정" : ""}{meta?.archived ? " · 보관함" : ""}
      </p>
      <ProgressBar known={p.known} learning={p.learning} total={p.total} />
      <p className="meta">알아요 {p.known} · 몰라요 {p.learning} · 안 본 카드 {p.fresh}</p>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => go(playUrl(deck.id, { mode: "flip" }))}>카드 넘기기</button>
        <button type="button" className="btn ghost" onClick={() => go(playUrl(deck.id, { mode: "quiz" }))}>미니 퀴즈</button>
        {p.known && weakN ? (
          <button type="button" className="btn ghost" onClick={() => go(playUrl(deck.id, { mode: "flip", only: "weak" }))}>모르는 {weakN}장만</button>
        ) : null}
      </div>
      <h2 className="section-title">묶음</h2>
      <ul className="sec-list">
        {deck.sections.map((s, i) => {
          const sp = deckProgress(st, s.cards);
          return (
            <li key={i} className="sec-row">
              <span className="sec-name">{s.title}</span>
              <ProgressBar known={sp.known} learning={sp.learning} total={sp.total} />
              <span className="sec-n meta">{sp.known}/{sp.total}</span>
              <span className="sec-actions">
                <button type="button" className="link-btn" onClick={() => go(playUrl(deck.id, { mode: "flip", sec: String(i) }))}>카드</button>
                <button type="button" className="link-btn" onClick={() => go(playUrl(deck.id, { mode: "quiz", sec: String(i) }))}>퀴즈</button>
              </span>
            </li>
          );
        })}
      </ul>

      <h2 className="section-title">정리</h2>
      <div className="row deck-tools">
        <button type="button" className="btn ghost" onClick={() => go(`/cards/edit/${encodeURIComponent(deck.id)}`)}>고치기</button>
        <button type="button" className="btn ghost" aria-expanded={moving} onClick={() => setMoving(!moving)}>폴더 옮기기</button>
        <button type="button" className="btn ghost" aria-pressed={!!meta?.pinned} onClick={() => store.setDeckMeta(id, { pinned: !meta?.pinned })}>{meta?.pinned ? "고정 풀기" : "위에 고정"}</button>
        <button type="button" className="btn ghost" aria-pressed={!!meta?.archived} onClick={() => store.setDeckMeta(id, { archived: !meta?.archived, pinned: meta?.archived ? meta?.pinned : false })}>
          {meta?.archived ? "보관에서 꺼내기" : "다 외웠어요(보관)"}
        </button>
      </div>
      {moving ? (
        <div className="move-box" role="group" aria-label="옮길 폴더">
          <div className="chips">
            <button type="button" className={`chip-btn ${!folder ? "on" : ""}`} aria-pressed={!folder} onClick={() => moveTo(undefined)}>폴더 없음</button>
            {folders.map((f) => (
              <button key={f.id} type="button" className={`chip-btn ${folder?.id === f.id ? "on" : ""}`} aria-pressed={folder?.id === f.id} onClick={() => moveTo(f.id)}>{f.name}</button>
            ))}
          </div>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) moveTo(store.saveFolder(newName.trim()));
              setNewName("");
            }}
          >
            <input value={newName} placeholder="새 폴더 이름" aria-label="새 폴더 이름" onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" className="btn ghost" disabled={!newName.trim()}>새 폴더로 옮기기</button>
          </form>
        </div>
      ) : null}
      {meta?.archived ? <p className="meta">보관한 덱의 카드는 다시 볼 간격이 두 배로 늘어나서 '오늘 다시 볼 카드'에 가끔만 나와요.</p> : null}
      {!deck.builtIn ? (
        <div className="row">
          {!armDel ? (
            <button type="button" className="link-btn danger" onClick={() => setArmDel(true)}>덱 지우기</button>
          ) : (
            <>
              <span className="meta">이 덱을 지울까요?</span>
              <button type="button" className="btn ghost" onClick={() => setArmDel(false)}>취소</button>
              <button type="button" className="btn ng" onClick={() => { store.deleteDeck(deck.id); go("/cards", true); }}>지우기</button>
            </>
          )}
        </div>
      ) : null}
    </main>
  );
}

/* ───────── 덱 만들기·고치기 화면 ───────── */

export function DeckEditPage({ id, query }: { id?: string; query: URLSearchParams }) {
  const st = store.get();
  const deck = id ? allDecks(st).find((d) => d.id === id) : undefined;
  const back = deck ? `/cards/deck/${encodeURIComponent(deck.id)}` : "/cards";
  if (id && !deck) {
    return (
      <main className="page">
        <a className="back" href="#/cards">카드</a>
        <h1 className="page-title">덱을 찾을 수 없어요</h1>
      </main>
    );
  }
  return (
    <main className="page">
      <a className="back" href={`#${back}`}>{deck ? deck.title : "카드"}</a>
      <h1 className="sr-only">{deck ? `${deck.title} 고치기` : "새 덱 만들기"}</h1>
      <DeckEditor
        initial={deck ? { id: deck.id, title: deck.title, md: deck.md, builtIn: deck.builtIn, overridden: deck.overridden } : undefined}
        onDone={(savedId) => {
          const folder = query.get("folder");
          if (savedId && !deck && folder) store.setDeckMeta(savedId, { folder });
          go(savedId ? `/cards/deck/${encodeURIComponent(savedId)}` : back, true);
        }}
      />
    </main>
  );
}

/* ───────── 카드 풀기 ───────── */

/** '오늘 다시 볼 카드'를 덱 하나처럼 묶는다(묶음 = 원래 덱) */
function reviewDeck(st: ReturnType<typeof store.get>): Deck {
  const due = dueCards(st);
  const titles = Object.fromEntries(allDecks(st).map((d) => [d.id, d.title]));
  const order: string[] = [];
  const bySec: Record<string, Card[]> = {};
  for (const c of due) {
    if (!bySec[c.deckId]) {
      bySec[c.deckId] = [];
      order.push(c.deckId);
    }
    bySec[c.deckId].push({ ...c, section: `${titles[c.deckId]} · ${c.section}` });
  }
  const sections = order.map((d, i) => ({ title: titles[d], cards: bySec[d].map((c) => ({ ...c, sectionIndex: i })) }));
  return { id: REVIEW_ID, title: "오늘 다시 볼 카드", builtIn: true, createdAt: 0, sections, cards: sections.flatMap((s) => s.cards), md: "" };
}

export function CardPlay({ query }: { query: URLSearchParams }) {
  const st = store.get();
  const deckParam = query.get("deck");
  const deck = useMemo(() => (deckParam === REVIEW_ID ? reviewDeck(st) : allDecks(st).find((d) => d.id === deckParam)), [deckParam]);
  const key = query.toString();
  const mode = query.get("mode") === "quiz" ? "quiz" : "flip";
  const sec = query.get("sec");
  const only = query.get("only");
  const rev = query.get("rev") === "1";
  const doShuffle = query.get("shuffle") !== "0";
  const pool = useMemo(() => {
    if (!deck) return [];
    let cards = sec !== null && deck.sections[Number(sec)] ? deck.sections[Number(sec)].cards : deck.cards;
    if (only === "weak") cards = cards.filter((c) => cardState(st, c.id) !== "known");
    if (only === "ids") {
      const ids = new Set((query.get("ids") || "").split(","));
      cards = cards.filter((c) => ids.has(c.id));
    }
    return doShuffle ? shuffle(cards) : cards;
  }, [key]);

  if (!deck) {
    return (
      <div className="empty-state">
        <p>덱을 찾을 수 없어요.</p>
        <button type="button" className="btn primary" onClick={() => go("/cards")}>카드 탭으로</button>
      </div>
    );
  }
  const title = sec !== null && deck.sections[Number(sec)] ? deck.sections[Number(sec)].title : deck.title;
  if (!pool.length) {
    return (
      <div className="empty-state">
        <p>{only ? "모르는 카드가 없어요. 다 외웠어요!" : "카드가 없어요."}</p>
        <button type="button" className="btn primary" onClick={() => go("/cards")}>카드 탭으로</button>
      </div>
    );
  }
  const back = deck.id === REVIEW_ID ? "/cards" : `/cards/deck/${encodeURIComponent(deck.id)}`;
  const toggleUrl = (k: string, v: string) => {
    const q = new URLSearchParams(query);
    q.set(k, v);
    return `/cards/play?${q}`;
  };
  return mode === "quiz" ? (
    <QuizRun key={key} deck={deck} cards={pool} title={title} rev={rev} back={back} onToggleRev={() => go(toggleUrl("rev", rev ? "0" : "1"), true)} />
  ) : (
    <FlipRun key={key} deck={deck} cards={pool} title={title} rev={rev} back={back} onToggleRev={() => go(toggleUrl("rev", rev ? "0" : "1"), true)} />
  );
}

type RunProps = { deck: Deck; cards: Card[]; title: string; rev: boolean; back: string; onToggleRev: () => void };

/** 손가락(마우스)으로 좌우로 미는 동작. 조금만 움직이면 탭으로 본다 */
function useSwipe(onSwipe: (dir: "left" | "right") => void, onTap: () => void, enabled = true) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);
  const handlers = {
    onPointerDown(e: React.PointerEvent) {
      if (!enabled || (e.target as HTMLElement).closest("button, a, input, textarea")) return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      moved.current = false;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent) {
      if (!start.current || start.current.id !== e.pointerId) return;
      const x = e.clientX - start.current.x;
      const y = e.clientY - start.current.y;
      if (Math.abs(x) > 6 || Math.abs(y) > 6) moved.current = true;
      if (Math.abs(x) > Math.abs(y)) setDx(x);
    },
    onPointerUp(e: React.PointerEvent) {
      if (!start.current || start.current.id !== e.pointerId) return;
      const w = (e.currentTarget as HTMLElement).offsetWidth || 320;
      const x = e.clientX - start.current.x;
      start.current = null;
      setDragging(false);
      if (Math.abs(x) > Math.min(110, w * 0.28)) onSwipe(x > 0 ? "right" : "left");
      else if (!moved.current) onTap();
      setDx(0);
    },
    onPointerCancel() {
      start.current = null;
      setDragging(false);
      setDx(0);
    },
  };
  return { dx, dragging, handlers };
}

function RunTop({ title, idx, total, cells, onExit, rev, onToggleRev }: { title: string; idx: number; total: number; cells: Cell[]; onExit: () => void; rev: boolean; onToggleRev: () => void }) {
  return (
    <>
      <div className="run-top">
        <button type="button" className="link-btn" onClick={onExit}>나가기</button>
        <span className="run-title">{title}</span>
        <span className="run-count">{Math.min(idx + 1, total)}/{total}</span>
      </div>
      <Strip cells={cells} current={idx < total ? idx : undefined} size="s" label="카드 진행" />
      <div className="card-opts">
        <button type="button" className={`chip-btn ${rev ? "on" : ""}`} aria-pressed={rev} onClick={onToggleRev}>
          {rev ? "내용 → 항목" : "항목 → 내용"}
        </button>
      </div>
    </>
  );
}

function Summary({ deck, cards, results, onRestart, label, back }: { deck: Deck; cards: Card[]; results: Record<string, boolean>; onRestart: () => void; label: [string, string]; back: string }) {
  const ok = cards.filter((c) => results[c.id] === true).length;
  const ng = cards.filter((c) => results[c.id] === false);
  return (
    <div className="card-summary">
      <h2 className="page-title">다 넘겼어요</h2>
      <div className="score">
        <span className="score-big">{ok}</span>
        <span className="score-of">/ {cards.length}</span>
        <span className="meta">{label[0]} {ok} · {label[1]} {ng.length}</span>
      </div>
      <Strip cells={cards.map((c) => (c.id in results ? results[c.id] : "empty"))} label="카드별 결과" />
      {ng.length ? (
        <ul className="ng-cards">
          {ng.map((c) => (
            <li key={c.id}>
              <strong>{plain(c.front)}</strong>
              <span><Rich text={c.back} /></span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row">
        {ng.length ? (
          <button type="button" className="btn primary" onClick={() => go(playUrl(deck.id, { mode: "flip", only: "ids", ids: ng.map((c) => c.id).join(",") }))}>
            {label[1]} {ng.length}장 다시
          </button>
        ) : null}
        <button type="button" className="btn ghost" onClick={onRestart}>처음부터 다시</button>
        <button type="button" className="btn ghost" onClick={() => go(back)}>{back === "/cards" ? "카드 탭으로" : "덱으로"}</button>
      </div>
    </div>
  );
}

/* 카드 넘기기: 탭하면 뒤집기, 오른쪽 = 알아요, 왼쪽 = 몰라요 */
function FlipRun({ deck, cards, title, rev, back, onToggleRev }: RunProps) {
  const [order, setOrder] = useState(cards);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const card = order[idx];
  const done = idx >= order.length;

  function decide(ok: boolean) {
    if (!card || leaving) return;
    store.markCard(card.id, ok);
    setResults((r) => ({ ...r, [card.id]: ok }));
    setLeaving(ok ? "right" : "left");
    setTimeout(() => {
      setLeaving(null);
      setFlipped(false);
      setIdx((i) => i + 1);
    }, 220);
  }
  function undo() {
    if (idx === 0 || leaving) return;
    const prev = order[idx - 1];
    setResults((r) => {
      const n = { ...r };
      delete n[prev.id];
      return n;
    });
    setFlipped(false);
    setIdx(idx - 1);
  }
  const { dx, dragging, handlers } = useSwipe((d) => decide(d === "right"), () => setFlipped((f) => !f), !done);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") decide(true);
      else if (e.key === "ArrowLeft") decide(false);
      else if (e.key === "z" || e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cells: Cell[] = order.map((c) => (c.id in results ? results[c.id] : "empty"));
  const restart = () => {
    setOrder(shuffle(cards));
    setIdx(0);
    setResults({});
    setFlipped(false);
  };

  return (
    <div className="runner cards-run">
      <RunTop title={title} idx={idx} total={order.length} cells={cells} onExit={() => go(back)} rev={rev} onToggleRev={onToggleRev} />
      {done ? (
        <Summary deck={deck} cards={order} results={results} onRestart={restart} label={["알아요", "몰라요"]} back={back} />
      ) : (
        <>
          <div className="card-stage">
            {order[idx + 1] ? <div className="flash-card under" aria-hidden="true" /> : null}
            <div
              key={card.id}
              className={`flash-card ${flipped ? "is-back" : ""} ${dragging ? "dragging" : ""} ${leaving ? `leave-${leaving}` : ""}`}
              style={leaving ? undefined : { transform: `translateX(${dx}px) rotate(${dx / 22}deg)` }}
              {...handlers}
              role="button"
              tabIndex={0}
              aria-label={flipped ? "뒷면. 탭하면 앞면" : "앞면. 탭하면 뒷면"}
            >
              <span className={`swipe-hint ok ${dx > 40 ? "show" : ""}`}>알아요</span>
              <span className={`swipe-hint ng ${dx < -40 ? "show" : ""}`}>몰라요</span>
              <span className="fc-side">{flipped !== rev ? "내용" : "항목"}</span>
              <div className="fc-body">
                {flipped !== rev ? (
                  <p className="fc-back"><Rich text={card.back} /></p>
                ) : (
                  <p className="fc-front">{plain(card.front)}</p>
                )}
              </div>
              <span className="fc-section">{card.section}</span>
              {!flipped ? <span className="fc-tap meta">탭해서 뒤집기</span> : null}
            </div>
          </div>
          <div className="card-actions">
            <button type="button" className="btn ng big" onClick={() => decide(false)} aria-label="몰라요 (왼쪽으로 밀기)">← 몰라요</button>
            <button type="button" className="icon-btn" onClick={undo} disabled={idx === 0} aria-label="되돌리기" title="되돌리기">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" className="btn ok big" onClick={() => decide(true)} aria-label="알아요 (오른쪽으로 밀기)">알아요 →</button>
          </div>
        </>
      )}
    </div>
  );
}

/* 미니 퀴즈: 4개 중 고르기. 고른 뒤 왼쪽으로 밀거나 '다음'으로 넘긴다 */
function QuizRun({ deck, cards, title, rev, back, onToggleRev }: RunProps) {
  const [order, setOrder] = useState(cards);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const card = order[idx];
  const done = idx >= order.length;

  // 보기: 같은 묶음에서 먼저, 모자라면 덱 전체에서
  const options = useMemo(() => {
    const m: Record<string, Card[]> = {};
    const all = allDecks(store.get());
    for (const c of order) {
      // 보기는 그 카드가 원래 있던 덱에서(오늘 다시 볼 카드처럼 여러 덱이 섞여도)
      const home = deck.id === REVIEW_ID ? all.find((d) => d.id === deckIdOf(c.id)) || deck : deck;
      const homeSec = home.cards.find((x) => x.id === c.id)?.sectionIndex ?? c.sectionIndex;
      const same = home.cards.filter((x) => x.id !== c.id && x.sectionIndex === homeSec);
      const rest = home.cards.filter((x) => x.id !== c.id && x.sectionIndex !== homeSec);
      const key = (x: Card) => (rev ? plain(x.front) : plain(x.back));
      const seen = new Set([key(c)]);
      const wrong: Card[] = [];
      for (const x of [...shuffle(same), ...shuffle(rest)]) {
        if (wrong.length >= 3) break;
        if (seen.has(key(x))) continue;
        seen.add(key(x));
        wrong.push(x);
      }
      m[c.id] = shuffle([c, ...wrong]);
    }
    return m;
  }, [order, rev]);

  function choose(i: number) {
    if (!card || card.id in picked) return;
    const ok = options[card.id][i].id === card.id;
    store.markCard(card.id, ok);
    setPicked((p) => ({ ...p, [card.id]: i }));
    setResults((r) => ({ ...r, [card.id]: ok }));
  }
  const next = () => setIdx((i) => Math.min(i + 1, order.length));
  const prev = () => setIdx((i) => Math.max(i - 1, 0));
  const { dx, dragging, handlers } = useSwipe((d) => (d === "left" ? next() : prev()), () => {}, !done);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (/^[1-4]$/.test(e.key)) choose(Number(e.key) - 1);
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cells: Cell[] = order.map((c) => (c.id in results ? results[c.id] : "empty"));
  const restart = () => {
    setOrder(shuffle(cards));
    setIdx(0);
    setPicked({});
    setResults({});
  };

  return (
    <div className="runner cards-run">
      <RunTop title={title} idx={idx} total={order.length} cells={cells} onExit={() => go(back)} rev={rev} onToggleRev={onToggleRev} />
      {done ? (
        <Summary deck={deck} cards={order} results={results} onRestart={restart} label={["맞힘", "틀림"]} back={back} />
      ) : (
        <>
          <div className="card-stage quiz">
            <div
              key={card.id}
              className={`flash-card quiz-card ${dragging ? "dragging" : ""}`}
              style={{ transform: `translateX(${dx}px)` }}
              {...handlers}
            >
              <span className="fc-side">{rev ? "이 내용에 맞는 항목은?" : "이 항목의 내용은?"}</span>
              <div className="fc-body">
                {rev ? <p className="fc-back"><Rich text={card.back} /></p> : <p className="fc-front">{plain(card.front)}</p>}
              </div>
              <span className="fc-section">{card.section}</span>
            </div>
          </div>
          <ol className="choices quiz-choices">
            {options[card.id].map((o, i) => {
              const chosen = picked[card.id] === i;
              const answered = card.id in picked;
              const correct = o.id === card.id;
              const cls = answered ? (correct ? "correct" : chosen ? "wrong" : "") : "";
              return (
                <li key={o.id}>
                  <button type="button" className={`choice ${cls}`} disabled={answered} onClick={() => choose(i)}>
                    <span className="mark" aria-hidden="true">{i + 1}</span>
                    <span className="ctext">{rev ? plain(o.front) : <Rich text={o.back} />}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {card.id in picked ? (
            <p className={`verdict ${results[card.id] ? "ok" : "ng"}`} role="status">{results[card.id] ? "맞았어요" : "틀렸어요"}</p>
          ) : null}
          <div className="run-actions">
            <button type="button" className="btn ghost" disabled={idx === 0} onClick={prev}>이전</button>
            <button type="button" className="btn primary" onClick={next}>{card.id in picked ? (idx === order.length - 1 ? "결과 보기" : "다음") : "건너뛰기"}</button>
          </div>
          <p className="meta swipe-help">카드를 왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전</p>
        </>
      )}
    </div>
  );
}
