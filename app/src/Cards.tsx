import React, { useEffect, useMemo, useRef, useState } from "react";
import { go, shuffle, store, useStore } from "./lib";
import { Card, Deck, allDecks, cardState, deckProgress, plain } from "./deckdata";
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

export function CardsHome() {
  const st = useStore();
  const decks = allDecks(st);
  const [adding, setAdding] = useState(false);
  return (
    <main className="page">
      <h1 className="page-title">카드</h1>
      <p className="lede">컨닝페이퍼를 카드로 넘기며 외워요. 오른쪽으로 밀면 알아요, 왼쪽으로 밀면 몰라요.</p>
      {decks.map((d) => (
        <DeckBlock key={d.id} deck={d} />
      ))}
      <section className="review-block" aria-labelledby="add-t">
        <h2 id="add-t" className="section-title">새 덱 만들기</h2>
        {!adding ? (
          <>
            <p className="meta">표에 항목과 내용을 바로 적거나, '| 항목 | 내용 |' 형식의 컨닝페이퍼를 붙여 넣어 만들어요.</p>
            <button type="button" className="btn ghost" onClick={() => setAdding(true)}>새 덱 만들기</button>
          </>
        ) : (
          <DeckEditor onDone={() => setAdding(false)} />
        )}
      </section>
    </main>
  );
}

function DeckBlock({ deck }: { deck: Deck }) {
  const st = useStore();
  const p = deckProgress(st, deck.cards);
  const [armDel, setArmDel] = useState(false);
  const [editing, setEditing] = useState(false);
  const weakN = p.learning + p.fresh;
  if (editing) {
    return (
      <section className="review-block" aria-label={`${deck.title} 고치기`}>
        <DeckEditor
          initial={{ id: deck.id, title: deck.title, md: deck.md, builtIn: deck.builtIn, overridden: deck.overridden }}
          onDone={() => setEditing(false)}
        />
      </section>
    );
  }
  return (
    <section className="review-block deck" aria-labelledby={`dk-${deck.id}`}>
      <div className="rb-head">
        <h2 id={`dk-${deck.id}`} className="section-title">{deck.title}</h2>
        <span className="rb-count">{deck.cards.length}장</span>
      </div>
      <ProgressBar known={p.known} learning={p.learning} total={p.total} />
      <p className="meta">
        알아요 {p.known} · 몰라요 {p.learning} · 안 본 카드 {p.fresh}
      </p>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => go(playUrl(deck.id, { mode: "flip" }))}>카드 넘기기</button>
        <button type="button" className="btn ghost" onClick={() => go(playUrl(deck.id, { mode: "quiz" }))}>미니 퀴즈</button>
        {p.known && weakN ? (
          <button type="button" className="btn ghost" onClick={() => go(playUrl(deck.id, { mode: "flip", only: "weak" }))}>모르는 {weakN}장만</button>
        ) : null}
      </div>
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
      <div className="row deck-tools">
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>고치기</button>
        {deck.builtIn ? null : !armDel ? (
            <button type="button" className="link-btn danger" onClick={() => setArmDel(true)}>덱 지우기</button>
          ) : (
            <>
              <span className="meta">이 덱을 지울까요?</span>
              <button type="button" className="btn ghost" onClick={() => setArmDel(false)}>취소</button>
              <button type="button" className="btn ng" onClick={() => store.deleteDeck(deck.id)}>지우기</button>
            </>
          )}
      </div>
    </section>
  );
}

/* ───────── 카드 풀기 ───────── */

export function CardPlay({ query }: { query: URLSearchParams }) {
  const st = store.get();
  const deck = allDecks(st).find((d) => d.id === query.get("deck"));
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
  const toggleUrl = (k: string, v: string) => {
    const q = new URLSearchParams(query);
    q.set(k, v);
    return `/cards/play?${q}`;
  };
  return mode === "quiz" ? (
    <QuizRun key={key} deck={deck} cards={pool} title={title} rev={rev} onToggleRev={() => go(toggleUrl("rev", rev ? "0" : "1"), true)} />
  ) : (
    <FlipRun key={key} deck={deck} cards={pool} title={title} rev={rev} onToggleRev={() => go(toggleUrl("rev", rev ? "0" : "1"), true)} />
  );
}

type RunProps = { deck: Deck; cards: Card[]; title: string; rev: boolean; onToggleRev: () => void };

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

function Summary({ deck, cards, results, onRestart, label }: { deck: Deck; cards: Card[]; results: Record<string, boolean>; onRestart: () => void; label: [string, string] }) {
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
        <button type="button" className="btn ghost" onClick={() => go("/cards")}>카드 탭으로</button>
      </div>
    </div>
  );
}

/* 카드 넘기기: 탭하면 뒤집기, 오른쪽 = 알아요, 왼쪽 = 몰라요 */
function FlipRun({ deck, cards, title, rev, onToggleRev }: RunProps) {
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
      <RunTop title={title} idx={idx} total={order.length} cells={cells} onExit={() => go("/cards")} rev={rev} onToggleRev={onToggleRev} />
      {done ? (
        <Summary deck={deck} cards={order} results={results} onRestart={restart} label={["알아요", "몰라요"]} />
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
function QuizRun({ deck, cards, title, rev, onToggleRev }: RunProps) {
  const [order, setOrder] = useState(cards);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const card = order[idx];
  const done = idx >= order.length;

  // 보기: 같은 묶음에서 먼저, 모자라면 덱 전체에서
  const options = useMemo(() => {
    const m: Record<string, Card[]> = {};
    for (const c of order) {
      const same = deck.cards.filter((x) => x.id !== c.id && x.sectionIndex === c.sectionIndex);
      const rest = deck.cards.filter((x) => x.id !== c.id && x.sectionIndex !== c.sectionIndex);
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
      <RunTop title={title} idx={idx} total={order.length} cells={cells} onExit={() => go("/cards")} rev={rev} onToggleRev={onToggleRev} />
      {done ? (
        <Summary deck={deck} cards={order} results={results} onRestart={restart} label={["맞힘", "틀림"]} />
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
