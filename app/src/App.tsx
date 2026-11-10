import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DB, Question, Round, Session, answerText, bestScore, go, qStats, shuffle, store, roundLatest, roundDone, roundSessions, uid,
  streakDays, useRoute, useStore, wrongNoteIds, dayKey, CIRCLED, Resp, bookmarkedIds, buildDB, loadLocalRaw,
  TOPIC_NAMES, topicShort, topicStats, weakTopics, gradeDetail, WRONG_TYPES, WrongType, wrongTypeCounts, wrongTypeLabel,
} from "./lib";
import { isLoggedIn, loadCloudContent, signIn, signOut, startAutoSync, syncNow, uploadBundle, uploadFromLocal, useCloud } from "./cloud";
import { Cell, Explanation, QuestionView, SelfGrade, Strip, WrongNotePanel, fmtTime } from "./ui";
import { ExamRunner, FlashRunner, PracticeRunner, RunSpec } from "./Runner";
import { CardPlay, CardsHome, DeckEditPage, DeckPage } from "./Cards";

/* ───────── 공통 ───────── */

const TABS = [
  { to: "/", key: "", label: "오늘", icon: "M4 11.5 12 5l8 6.5V20h-5v-5h-6v5H4z" },
  { to: "/books", key: "books", label: "문제집", icon: "M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10" },
  { to: "/review", key: "review", label: "복습", icon: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" },
  { to: "/cards", key: "cards", label: "카드", icon: "M8 6h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 20H8a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 8 6zM3.5 16.5V5A1.5 1.5 0 0 1 5 3.5h11" },
  { to: "/stats", key: "stats", label: "기록", icon: "M5 20V10m7 10V4m7 16v-7" },
];

function Nav({ active }: { active: string }) {
  return (
    <nav className="nav" aria-label="주요 메뉴">
      <span className="brand" aria-hidden="true">
        <span className="brand-strip"><i /><i /><i className="n" /><i /></span>
        생물 미니
      </span>
      {TABS.map((t) => (
        <a key={t.key} href={`#${t.to}`} className={`tab ${active === t.key ? "on" : ""}`} aria-current={active === t.key ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

/** 회차 진행 띠: 문항마다 가장 최근 결과(실전·한 문제씩·카드·종이 어느 방식이든) */
function roundCells(db: DB, r: Round): Cell[] {
  const latest = roundLatest(r.id);
  const qs = db.questionsOf[r.id] || [];
  return qs.map((q) => (q.id in latest ? latest[q.id] : "empty"));
}

const isRoundDone = (db: DB, r: Round) => roundDone(r.id, (db.questionsOf[r.id] || []).map((q) => q.id));

function bookProgress(db: DB, bookId: string) {
  const rounds = db.roundsOf[bookId] || [];
  const done = rounds.filter((r) => isRoundDone(db, r)).length;
  return { done, total: rounds.length };
}

/** 지난 기록에 붙이는 풀이 방식 이름 */
const sessionMode = (s: Session) => (s.paper ? "종이" : s.kind === "round" ? "실전" : s.kind === "flash" ? "카드" : "한 문제씩");

/** 단원 이름들 → 주소에 넣을 번호 목록 */
const topicParam = (names: string[]) => names.map((n) => TOPIC_NAMES.indexOf(n)).filter((i) => i >= 0).join(",");
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

/* ───────── 오늘 ───────── */

function Home({ db }: { db: DB }) {
  const st = useStore();
  const wrong = wrongNoteIds(db);
  const bm = bookmarkedIds(st).filter((id) => db.q[id] && !db.q[id].hidden);
  const today = st.attempts.filter((a) => dayKey(a.t) === dayKey(Date.now()));
  const todayOk = today.filter((a) => a.ok).length;
  const streak = streakDays();
  const next = db.rounds.find((r) => !isRoundDone(db, r));
  const lastSession = [...st.sessions].sort((a, b) => b.startedAt - a.startedAt)[0];
  const weak = weakTopics(db);

  return (
    <main className="page">
      <h1 className="page-title">오늘의 워밍업</h1>
      <p className="lede">
        {today.length ? `오늘 ${today.length}문항을 풀고 ${todayOk}개를 맞혔어요.` : "오늘은 아직 풀지 않았어요. 한 회차는 7분이면 끝나요."}
        {streak > 1 ? ` ${streak}일 연속으로 공부 중이에요.` : ""}
      </p>

      {next ? (
        <section className="hero-round" aria-labelledby="next-t">
          <p className="hero-kicker">다음 회차</p>
          <h2 id="next-t">{db.book[next.book_id].title} {next.number}회</h2>
          <Strip cells={roundCells(db, next)} size="m" label="다음 회차 진행" />
          <p className="meta">{(db.questionsOf[next.id] || []).length}문항, 제한시간 7분</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => go(`/play/round/${next.id}?mode=exam`)}>시작하기</button>
            <button type="button" className="btn ghost" onClick={() => go(`/round/${next.id}`)}>다른 방식으로</button>
            <button type="button" className="btn ghost" onClick={() => go(`/paper/${next.id}`)}>종이로 푼 결과 입력</button>
          </div>
        </section>
      ) : (
        <section className="hero-round">
          <h2>모든 회차를 한 번씩 풀었어요</h2>
          <p className="meta">이제 오답노트와 랜덤 문제로 반복하세요.</p>
        </section>
      )}

      <section className="quick" aria-label="바로 복습">
        <button type="button" className="quick-item" disabled={!wrong.length} onClick={() => go("/play/wrong?mode=practice")}>
          <span className="qi-num ng-text">{wrong.length}</span>
          <span className="qi-label">오답노트 다시 풀기</span>
        </button>
        <button type="button" className="quick-item" disabled={!bm.length} onClick={() => go("/play/bookmarks?mode=flash")}>
          <span className="qi-num">{bm.length}</span>
          <span className="qi-label">찍은 문제 카드로 넘기기</span>
        </button>
        <button type="button" className="quick-item" onClick={() => go("/play/random?n=15&mode=practice")}>
          <span className="qi-num">15</span>
          <span className="qi-label">전체에서 랜덤 문제</span>
        </button>
      </section>

      {weak.length ? (
        <section className="review-block weak-block" aria-labelledby="weak-t">
          <h2 id="weak-t" className="section-title">약한 단원</h2>
          <div className="chips">
            {weak.map((t) => <span key={t} className="chip weak">{topicShort(t)}</span>)}
          </div>
          <p className="meta">틀렸거나 안 풀어 본 문항부터 섞어서 나와요.</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => go(`/play/random?t=${topicParam(weak)}&n=20&focus=1&mode=practice`)}>20문항 풀기</button>
            <a className="btn ghost" href="#/stats">단원별 정답률</a>
          </div>
        </section>
      ) : null}

      {lastSession ? (
        <p className="meta">
          최근 기록: <a href={`#/result/${lastSession.id}`}>{lastSession.title}</a>
        </p>
      ) : null}
    </main>
  );
}

/* ───────── 문제집 ───────── */

function Books({ db }: { db: DB }) {
  useStore();
  return (
    <main className="page">
      <h1 className="page-title">문제집</h1>
      <ul className="book-list">
        {db.books.map((b) => {
          const p = bookProgress(db, b.id);
          const n = (db.roundsOf[b.id] || []).reduce((s, r) => s + (db.questionsOf[r.id] || []).length, 0);
          return (
            <li key={b.id}>
              <a className="book" href={`#/book/${b.id}`}>
                <span className="book-title">{b.title}</span>
                <span className="meta">{p.total}회 · {n}문항</span>
                <span className="bar" aria-label={`${p.total}회 중 ${p.done}회 풀이`}>
                  <span style={{ width: `${(p.done / p.total) * 100}%` }} />
                </span>
                <span className="meta">{p.done}/{p.total}회 풀었음</span>
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function BookPage({ db, id }: { db: DB; id: string }) {
  useStore();
  const b = db.book[id];
  if (!b) return <NotFound />;
  const rounds = db.roundsOf[id] || [];
  return (
    <main className="page">
      <a className="back" href="#/books">문제집</a>
      <h1 className="page-title">{b.title}</h1>
      <ul className="round-list">
        {rounds.map((r) => {
          const best = bestScore(r.id);
          const n = (db.questionsOf[r.id] || []).length;
          return (
            <li key={r.id}>
              <a className="round" href={`#/round/${r.id}`}>
                <span className="round-num">{r.number}회</span>
                <Strip cells={roundCells(db, r)} size="s" label={`${r.number}회 최근 결과`} />
                <span className={`round-score ${best === null ? "quiet" : ""}`}>{best === null ? "안 풂" : `${best}/${n}`}</span>
                {r.part ? <span className="round-part">{r.part}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function RoundPage({ db, id }: { db: DB; id: string }) {
  const st = useStore();
  const r = db.round[id];
  if (!r) return <NotFound />;
  const b = db.book[r.book_id];
  const qs = db.questionsOf[id] || [];
  void st;
  const sessions = roundSessions(id);
  const types = qs.reduce((m, q) => ((m[q.type] = (m[q.type] || 0) + 1), m), {} as Record<string, number>);
  return (
    <main className="page">
      <a className="back" href={`#/book/${b.id}`}>{b.title}</a>
      <h1 className="page-title">{r.number}회{r.part ? <span className="title-part">{r.part}</span> : null}</h1>
      <p className="lede">
        {qs.length}문항 · 객관식 {types.mcq || 0}
        {types.blank ? ` · 빈칸 ${types.blank}` : ""}
        {types.short || types.essay ? ` · 주관식 ${(types.short || 0) + (types.essay || 0)}` : ""}
      </p>
      <div className="modes">
        <button type="button" className="mode" onClick={() => go(`/play/round/${id}?mode=exam`)}>
          <span className="mode-name">실전처럼 풀기</span>
          <span className="meta">7분 타이머, 다 풀고 한 번에 채점</span>
        </button>
        <button type="button" className="mode" onClick={() => go(`/play/round/${id}?mode=practice`)}>
          <span className="mode-name">한 문제씩 확인</span>
          <span className="meta">풀 때마다 정답과 해설을 바로 봐요</span>
        </button>
        <button type="button" className="mode" onClick={() => go(`/play/round/${id}?mode=flash`)}>
          <span className="mode-name">카드로 넘기기</span>
          <span className="meta">문제를 보고 답을 떠올린 뒤 뒤집어요</span>
        </button>
        <button type="button" className="mode" onClick={() => go(`/paper/${id}`)}>
          <span className="mode-name">종이로 푼 결과 입력</span>
          <span className="meta">프린트로 푼 뒤 틀린 문제·찍은 문제만 눌러 기록해요</span>
        </button>
      </div>
      {sessions.length ? (
        <section>
          <h2 className="section-title">지난 기록</h2>
          <ul className="history">
            {sessions.map((s) => {
              const ok = Object.values(s.results).filter((x) => x === true).length;
              return (
                <li key={s.id}>
                  <a href={`#/result/${s.id}`}>
                    <span className="hist-date">
                      {new Date(s.startedAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}
                      <span className="hist-mode">{sessionMode(s)}</span>
                    </span>
                    <Strip cells={s.qids.map((q) => (q in s.results ? s.results[q] : "empty"))} size="s" />
                    <span className="round-score">{ok}/{s.qids.length}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/* ───────── 종이로 푼 결과 입력 ───────── */

const todayStrOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayStr = () => todayStrOf(Date.now());

function PaperEntry({ db, id, editId }: { db: DB; id: string; editId: string }) {
  const st = store.get();
  const r = db.round[id];
  const edit = editId ? st.sessions.find((x) => x.id === editId && x.paper) : undefined;
  const qs = r ? db.questionsOf[id] || [] : [];
  const [wrong, setWrong] = useState<Set<string>>(() => new Set(edit ? edit.qids.filter((q) => edit.results[q] === false) : []));
  const [guess, setGuess] = useState<Set<string>>(() => new Set(edit ? edit.qids.filter((q) => st.bookmarks[q] > 0) : []));
  const [date, setDate] = useState(() => todayStrOf(edit ? edit.startedAt : Date.now()));
  const [mins, setMins] = useState(edit?.durationSec ? String(Math.round((edit.durationSec / 60) * 10) / 10) : "");
  const [quick, setQuick] = useState("");
  if (!r) return <NotFound />;
  const b = db.book[r.book_id];

  const flip = (set: Set<string>, setter: (s: Set<string>) => void, qid: string) => {
    const n = new Set(set);
    n.has(qid) ? n.delete(qid) : n.add(qid);
    setter(n);
  };
  /** '2, 4 7-9' 처럼 번호를 적으면 틀림으로 표시 */
  function applyQuick() {
    const n = new Set(wrong);
    for (const part of quick.split(/[^0-9-]+/).filter(Boolean)) {
      const [a, z] = part.split("-").map(Number);
      for (let i = a; i <= (z || a); i++) if (qs[i - 1]) n.add(qs[i - 1].id);
    }
    setWrong(n);
    setQuick("");
  }

  function save() {
    const qids = qs.map((q) => q.id);
    const results: Record<string, boolean> = {};
    for (const q of qids) results[q] = !wrong.has(q);
    // 오늘이면 지금 시각, 지난 날짜면 그날 저녁 9시로
    const isToday = date === todayStr();
    const t = isToday || !date ? Date.now() : new Date(`${date}T21:00:00`).getTime();
    const dur = Math.max(0, Math.round(Number(mins.replace(",", ".")) * 60)) || 0;
    const s: Session = {
      id: edit?.id || uid(),
      kind: "round",
      paper: true,
      title: `${b.title} ${r.number}회`,
      roundId: id,
      back: `/round/${id}`,
      qids,
      results,
      resps: {},
      startedAt: edit ? (date === todayStrOf(edit.startedAt) ? edit.startedAt : t) : t,
      durationSec: dur,
      paperT: edit?.paperT,
    };
    store.recordPaper(s, guess, edit);
    go(`/result/${s.id}`, true);
  }

  const cells: Cell[] = qs.map((q) => !wrong.has(q.id));
  const nWrong = qs.filter((q) => wrong.has(q.id)).length;
  const nGuess = qs.filter((q) => guess.has(q.id)).length;
  return (
    <main className="page paper">
      <a className="back" href={`#/round/${id}`}>{b.title} {r.number}회</a>
      <h1 className="page-title">{edit ? "종이 기록 고치기" : "종이로 푼 결과 입력"}</h1>
      <p className="lede">틀린 문제와 찍은 문제만 눌러 주세요. 나머지는 맞힌 것으로 기록돼요. 저장하면 디지털로 푼 것처럼 오답노트·찍은 문제·통계에 들어가요.</p>
      <Strip cells={cells} label="입력한 결과" />

      <div className="paper-quick">
        <div className="field">
          <label htmlFor="pq">틀린 번호 한 번에 입력</label>
          <input id="pq" inputMode="numeric" placeholder="예: 2, 4, 7-9" value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyQuick()} />
        </div>
        <button type="button" className="btn ghost" disabled={!quick.trim()} onClick={applyQuick}>표시</button>
      </div>

      <ol className="paper-list">
        {qs.map((q, i) => {
          const ng = wrong.has(q.id);
          const gs = guess.has(q.id);
          return (
            <li key={q.id} className={`paper-row ${ng ? "ng" : "ok"}`}>
              <span className="res-num">{i + 1}</span>
              <span className="paper-stem">{q.stem || q.source || ""}</span>
              <button type="button" className={`paper-tg wrong ${ng ? "on" : ""}`} aria-pressed={ng} aria-label={`${i + 1}번 틀림`} onClick={() => flip(wrong, setWrong, q.id)}>
                {ng ? "틀림" : "맞음"}
              </button>
              <button type="button" className={`guess-btn ${gs ? "on" : ""}`} aria-pressed={gs} aria-label={`${i + 1}번 찍음`} onClick={() => flip(guess, setGuess, q.id)}>
                {gs ? "찍음 ✓" : "찍음"}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="paper-meta">
        <div className="field">
          <label htmlFor="pd">푼 날짜</label>
          <input id="pd" type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pm">걸린 시간(분, 선택)</label>
          <input id="pm" inputMode="decimal" placeholder="예: 6.5" value={mins} onChange={(e) => setMins(e.target.value)} />
        </div>
      </div>

      <div className="row">
        <button type="button" className="btn primary" onClick={save}>
          {edit ? "고친 내용 저장" : "기록하기"} · {qs.length - nWrong}/{qs.length}{nGuess ? ` · 찍음 ${nGuess}` : ""}
        </button>
        <button type="button" className="btn ghost" onClick={() => go(edit ? `/result/${edit.id}` : `/round/${id}`)}>취소</button>
      </div>
      <p className="meta">저장한 뒤 결과 화면에서 틀린 문항마다 오답 유형과 메모를 고를 수 있어요.</p>
    </main>
  );
}

/* ───────── 풀이 진입 ───────── */

function Play({ db, path, query }: { db: DB; path: string[]; query: URLSearchParams }) {
  const st = store.get();
  const mode = (query.get("mode") || "practice") as "exam" | "practice" | "flash";
  const key = path.join("/") + "?" + query.toString();
  const spec: RunSpec | null = useMemo(() => {
    const [what, arg] = path;
    if (what === "round") {
      const r = db.round[arg];
      if (!r) return null;
      return {
        kind: mode === "exam" ? "round" : mode === "flash" ? "flash" : "practice",
        title: `${db.book[r.book_id].title} ${r.number}회`,
        qids: (db.questionsOf[arg] || []).map((q) => q.id),
        back: `/round/${arg}`,
        roundId: arg,
        timeLimit: r.time_limit_sec,
      };
    }
    if (what === "wrong") {
      const wt = (query.get("wt") || "") as WrongType | "none" | "";
      const label = wt === "none" ? "유형 미선택" : wrongTypeLabel((wt || undefined) as WrongType | undefined);
      return { kind: mode === "flash" ? "flash" : "practice", title: label ? `오답노트 · ${label}` : "오답노트", qids: shuffle(wrongNoteIds(db, wt || undefined)), back: "/review" };
    }
    if (what === "bookmarks")
      return { kind: mode === "flash" ? "flash" : "practice", title: "찍은 문제", qids: shuffle(bookmarkedIds(st).filter((id) => db.q[id] && !db.q[id].hidden)), back: "/review" };
    if (what === "random") {
      const books = (query.get("book") || "").split(",").filter(Boolean);
      const types = (query.get("type") || "").split(",").filter(Boolean);
      const src = query.get("src") || "";
      const n = Number(query.get("n") || 15);
      const unseen = query.get("unseen") === "1";
      const topics = (query.get("t") || "").split(",").filter(Boolean).map((i) => TOPIC_NAMES[Number(i)]).filter(Boolean);
      const focus = query.get("focus") === "1";
      const stats = qStats();
      const pool = db.questions.filter(
        (q) =>
          !q.hidden &&
          (!books.length || books.includes(q.book_id)) &&
          (!types.length || types.includes(q.type === "essay" ? "short" : q.type)) &&
          (!src || (src === "none" ? !q.source : (q.source || "").startsWith(src))) &&
          (!topics.length || topics.includes(q.topic || "")) &&
          (!unseen || !stats[q.id]),
      );
      // focus: 최근에 틀린 것 → 안 풀어 본 것 → 나머지 순으로 섞는다
      const rank = (id: string) => (!stats[id] ? 1 : stats[id].last === false ? 0 : 2);
      const ordered = focus ? [0, 1, 2].flatMap((r) => shuffle(pool.filter((q) => rank(q.id) === r))) : shuffle(pool);
      const title = topics.length === 1 ? topicShort(topics[0]) : topics.length ? "약한 단원" : "랜덤 문제";
      return { kind: mode === "flash" ? "flash" : "practice", title, qids: shuffle(ordered.slice(0, n)).map((q) => q.id), back: topics.length ? "/stats" : "/review" };
    }
    if (what === "retry") {
      const s = st.sessions.find((x) => x.id === arg);
      if (!s) return null;
      return { kind: "practice", title: `${s.title} 틀린 문제`, qids: s.qids.filter((q) => s.results[q] !== true), back: `/result/${s.id}` };
    }
    return null;
  }, [key]);

  if (!spec) return <NotFound />;
  if (spec.kind === "round") return <ExamRunner key={key} db={db} spec={spec} />;
  if (spec.kind === "flash") return <FlashRunner key={key} db={db} spec={spec} />;
  return <PracticeRunner key={key} db={db} spec={spec} />;
}

/* ───────── 결과 ───────── */

function respText(q: Question, r: Resp) {
  if (r === undefined || r === null || r === "") return "답 안 함";
  if (q.type === "mcq") return typeof r === "number" ? `${CIRCLED[r]} ${q.choices[r] ?? ""}` : "답 안 함";
  if (Array.isArray(r)) return r.map((x, i) => `${i + 1}) ${x || "(빈칸)"}`).join("  ");
  return String(r);
}

function Result({ db, id }: { db: DB; id: string }) {
  const st = useStore();
  const s = st.sessions.find((x) => x.id === id);
  // 틀린 문항·찍은 문항·채점할 문항은 펼친 채로 시작하고, 누르면 접고 펼친다
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (!s) return <NotFound />;
  const qs = s.qids.map((q) => db.q[q]).filter(Boolean);
  const ok = qs.filter((q) => s.results[q.id] === true).length;
  const pending = qs.filter((q) => s.results[q.id] === null);
  const wrong = qs.filter((q) => s.results[q.id] !== true).length;

  function selfGrade(qid: string, val: boolean) {
    store.record(qid, val, s!.kind === "round" ? "round" : s!.kind);
    store.saveSession({ ...s!, results: { ...s!.results, [qid]: val } });
  }

  return (
    <main className="page">
      <a className="back" href={`#${s.back}`}>돌아가기</a>
      <h1 className="page-title">{s.title}</h1>
      <div className="score">
        <span className="score-big">{ok}</span>
        <span className="score-of">/ {qs.length}</span>
        <span className="meta">
          {s.paper
            ? `종이로 풂${s.durationSec ? ` · ${fmtTime(s.durationSec)} 걸림${s.durationSec > 420 ? ", 7분 초과" : ", 7분 안에 끝냄"}` : ""}`
            : `${fmtTime(s.durationSec)} 걸림${s.kind === "round" ? (s.durationSec > 420 ? ", 7분 초과" : ", 7분 안에 끝냄") : ""}`}
        </span>
      </div>
      <Strip cells={qs.map((q) => (q.id in s.results ? s.results[q.id] : "empty"))} label="문항별 결과" />
      {pending.length ? <p className="notice">주관식 {pending.length}문항은 정답과 비교해 직접 채점해 주세요.</p> : null}
      <div className="row">
        {wrong ? <button type="button" className="btn primary" onClick={() => go(`/play/retry/${s.id}`)}>틀린 {wrong}문항 다시 풀기</button> : null}
        {s.paper && s.roundId ? <button type="button" className="btn ghost" onClick={() => go(`/paper/${s.roundId}?edit=${s.id}`)}>입력 고치기</button> : null}
        {s.roundId ? <button type="button" className="btn ghost" onClick={() => go(`/round/${s.roundId}`)}>회차로</button> : null}
      </div>

      <ol className="result-list">
        {qs.map((q, i) => {
          const r = s.results[q.id];
          const guessed = st.bookmarks[q.id] > 0;
          const note = st.notes?.[q.id];
          const byDefault = r !== true || guessed;
          const isOpen = r === null || (toggled[q.id] ?? byDefault);
          const part = q.type === "blank" && r === false ? gradeDetail(q, s.resps[q.id]) : null;
          const partLabel = part?.hits && part.hits.some(Boolean) ? `${part.hits.filter(Boolean).length}/${part.hits.length}칸` : "";
          return (
            <li key={q.id} className={`res ${r === true ? "ok" : r === false ? "ng" : "pend"}`}>
              <button type="button" className="res-head" aria-expanded={isOpen} onClick={() => r !== null && setToggled({ ...toggled, [q.id]: !isOpen })}>
                <span className="res-num">{i + 1}</span>
                <span className="res-stem">
                  {q.stem || `${db.book[q.book_id]?.title || ""} ${q.source || ""}`}
                  {r === false ? <span className={`wtype ${note?.type ? "" : "none"}`}>{note?.type ? wrongTypeLabel(note.type) : "유형 미선택"}</span> : null}
                  {guessed ? <span className="wtype guess">찍음</span> : null}
                </span>
                <span className="res-mark">{r === true ? "정답" : r === false ? partLabel || "오답" : "채점 필요"}</span>
              </button>
              {isOpen ? (
                <div className="res-body">
                  <QuestionView q={q} resp={s.resps[q.id]} reveal={true} interactive={q.type === "mcq" || q.type === "blank"} />
                  {q.type !== "mcq" && s.kind !== "flash" && !s.paper ? <p className="meta">내 답: {respText(q, s.resps[q.id])}</p> : null}
                  <Explanation q={q} />
                  {r === null ? <SelfGrade onGrade={(v) => selfGrade(q.id, v)} /> : null}
                  {r !== null && s.kind !== "flash" ? <WrongNotePanel q={q} wrong={r === false} /> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </main>
  );
}

/* ───────── 오답 메모 모아 보기 ───────── */

function NotesPage({ db, query }: { db: DB; query: URLSearchParams }) {
  const st = useStore();
  const [wt, setWt] = useState<WrongType | "none" | "">((query.get("wt") as any) || "");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const notes = st.notes || {};
  const inNote = new Set(wrongNoteIds(db));
  // 오답노트에 있거나 메모·유형을 남긴 문항(문제 오류 포함), 최근에 고친 것부터
  const ids = [...new Set([...inNote, ...Object.keys(notes).filter((id) => notes[id].type || notes[id].memo)])]
    .filter((id) => db.q[id] && !db.q[id].hidden)
    .filter((id) => !wt || (wt === "none" ? !notes[id]?.type : notes[id]?.type === wt))
    .sort((a, b) => (notes[b]?.u || 0) - (notes[a]?.u || 0));
  const all = [...new Set([...inNote, ...Object.keys(notes).filter((id) => notes[id].type || notes[id].memo)])].filter((id) => db.q[id] && !db.q[id].hidden);
  const count = (t: WrongType | "none") => all.filter((id) => (t === "none" ? !notes[id]?.type : notes[id]?.type === t)).length;
  return (
    <main className="page">
      <a className="back" href="#/review">복습</a>
      <h1 className="page-title">오답 메모</h1>
      <div className="chips wt-chips" role="group" aria-label="오답 유형">
        <button type="button" className={`chip-btn ${!wt ? "on" : ""}`} onClick={() => setWt("")}>전체 {all.length}</button>
        {WRONG_TYPES.map((t) => (
          <button key={t.id} type="button" className={`chip-btn ${t.id === "flawed" ? "quiet" : ""} ${wt === t.id ? "on" : ""}`} disabled={!count(t.id)} onClick={() => setWt(t.id)}>
            {t.label} {count(t.id)}
          </button>
        ))}
        {count("none") ? <button type="button" className={`chip-btn quiet ${wt === "none" ? "on" : ""}`} onClick={() => setWt("none")}>유형 미선택 {count("none")}</button> : null}
      </div>
      {!ids.length ? <p className="meta">아직 모인 문항이 없어요.</p> : null}
      <ol className="result-list note-list">
        {ids.map((id) => {
          const q = db.q[id];
          const n = notes[id];
          const isOpen = !!open[id];
          return (
            <li key={id} className="res ng">
              <button type="button" className="res-head" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [id]: !isOpen })}>
                <span className="res-num" />
                <span className="res-stem">
                  {q.stem || `${db.book[q.book_id]?.title || ""} ${q.source || ""}`}
                  {n?.memo ? <span className="note-memo">{n.memo}</span> : null}
                </span>
                <span className={`wtype ${n?.type ? "" : "none"}`}>{n?.type ? wrongTypeLabel(n.type) : "미선택"}</span>
              </button>
              {isOpen ? (
                <div className="res-body">
                  <p className="meta">{db.book[q.book_id]?.title} {db.round[q.round_id]?.number}회 {q.number}번{inNote.has(id) ? "" : " · 오답노트에서 빠짐"}</p>
                  <QuestionView q={q} resp={undefined} reveal={true} interactive={false} />
                  <Explanation q={q} open={false} />
                  <WrongNotePanel q={q} wrong={true} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </main>
  );
}

/* ───────── 복습 ───────── */

function Review({ db }: { db: DB }) {
  const st = useStore();
  const wrong = wrongNoteIds(db);
  const bm = bookmarkedIds(st).filter((id) => db.q[id] && !db.q[id].hidden);
  const [wt, setWt] = useState<WrongType | "none" | "">("");
  const wcount = wrongTypeCounts(db);
  const wsel = wt ? wcount[wt] : wrong.length;
  const [books, setBooks] = useState<string[]>([]);
  const [type, setType] = useState("");
  const [src, setSrc] = useState("");
  const [n, setN] = useState(15);
  const [unseen, setUnseen] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const weak = weakTopics(db);
  const stats = qStats();
  const pool = db.questions.filter(
    (q) =>
      !q.hidden &&
      (!books.length || books.includes(q.book_id)) &&
      (!type || (q.type === "essay" ? "short" : q.type) === type) &&
      (!src || (src === "none" ? !q.source : (q.source || "").startsWith(src))) &&
      (!topics.length || topics.includes(q.topic || "")) &&
      (!unseen || !stats[q.id]),
  ).length;
  const qs = new URLSearchParams({ book: books.join(","), type, src, n: String(n), unseen: unseen ? "1" : "", t: topicParam(topics) });
  const weakOn = weak.length > 0 && weak.length === topics.length && weak.every((t) => topics.includes(t));

  return (
    <main className="page">
      <h1 className="page-title">복습</h1>

      <section className="review-block" aria-labelledby="wn-t">
        <div className="rb-head">
          <h2 id="wn-t" className="section-title">오답노트</h2>
          <span className="rb-count ng-text">{wrong.length}</span>
        </div>
        <p className="meta">틀린 문항이 모여요. 이어서 2번 연속 맞히면 빠져요. 유형을 고르면 그 유형만 풀어요.</p>
        <div className="chips wt-chips" role="group" aria-label="오답 유형">
          <button type="button" className={`chip-btn ${!wt ? "on" : ""}`} aria-pressed={!wt} onClick={() => setWt("")}>전체 {wrong.length}</button>
          {WRONG_TYPES.filter((t) => t.id !== "flawed").map((t) => (
            <button key={t.id} type="button" className={`chip-btn ${wt === t.id ? "on" : ""}`} aria-pressed={wt === t.id} disabled={!wcount[t.id]} title={t.hint} onClick={() => setWt(t.id)}>
              {t.label} {wcount[t.id]}
            </button>
          ))}
          {wcount.none ? (
            <button type="button" className={`chip-btn quiet ${wt === "none" ? "on" : ""}`} aria-pressed={wt === "none"} onClick={() => setWt("none")}>유형 미선택 {wcount.none}</button>
          ) : null}
        </div>
        <div className="row">
          <button type="button" className="btn primary" disabled={!wsel} onClick={() => go(`/play/wrong?mode=practice${wt ? `&wt=${wt}` : ""}`)}>다시 풀기</button>
          <button type="button" className="btn ghost" disabled={!wsel} onClick={() => go(`/play/wrong?mode=flash${wt ? `&wt=${wt}` : ""}`)}>카드로 넘기기</button>
          <a className="btn ghost" href={`#/notes${wt ? `?wt=${wt}` : ""}`}>메모 모아 보기</a>
        </div>
      </section>

      <section className="review-block" aria-labelledby="bm-t">
        <div className="rb-head">
          <h2 id="bm-t" className="section-title">찍은 문제</h2>
          <span className="rb-count">{bm.length}</span>
        </div>
        <p className="meta">풀면서 문항 오른쪽 위 '찍음'을 누르거나, 맞힌 뒤 '확신 없이 맞혔나요?'에서 고르면 여기에 모여요. 시험 결과 화면에서는 펼쳐진 채로 보여요.</p>
        <div className="row">
          <button type="button" className="btn primary" disabled={!bm.length} onClick={() => go("/play/bookmarks?mode=practice")}>다시 풀기</button>
          <button type="button" className="btn ghost" disabled={!bm.length} onClick={() => go("/play/bookmarks?mode=flash")}>카드로 넘기기</button>
        </div>
      </section>

      <section className="review-block" aria-labelledby="rd-t">
        <h2 id="rd-t" className="section-title">랜덤 문제</h2>
        <fieldset className="filters">
          <legend className="sr-only">범위</legend>
          <div className="filter-row">
            <span className="f-label">문제집</span>
            <div className="chips">
              {db.books.map((b) => (
                <button key={b.id} type="button" className={`chip-btn ${books.includes(b.id) ? "on" : ""}`} aria-pressed={books.includes(b.id)}
                  onClick={() => setBooks(books.includes(b.id) ? books.filter((x) => x !== b.id) : [...books, b.id])}>
                  {b.title.replace("BIOLOGY ", "").replace("SIMPLICITY ", "")}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="f-label">단원</span>
            <div className="chips">
              <button type="button" className={`chip-btn ${!topics.length ? "on" : ""}`} aria-pressed={!topics.length} onClick={() => setTopics([])}>전체</button>
              {weak.length ? (
                <button type="button" className={`chip-btn weak ${weakOn ? "on" : ""}`} aria-pressed={weakOn} onClick={() => setTopics(weakOn ? [] : weak)}>약한 단원</button>
              ) : null}
              {db.topics.map((t) => (
                <button key={t} type="button" className={`chip-btn ${topics.includes(t) ? "on" : ""}`} aria-pressed={topics.includes(t)} title={t}
                  onClick={() => setTopics(topics.includes(t) ? topics.filter((x) => x !== t) : [...topics, t])}>
                  {topicShort(t)}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="f-label">유형</span>
            <div className="chips">
              {[["", "전체"], ["mcq", "객관식"], ["blank", "빈칸"], ["short", "주관식"]].map(([v, l]) => (
                <button key={v} type="button" className={`chip-btn ${type === v ? "on" : ""}`} aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="f-label">출처</span>
            <div className="chips">
              {[["", "전체"], ["공무원", "공무원"], ["중앙대", "중앙대"], ["none", "표시 없음"]].map(([v, l]) => (
                <button key={v} type="button" className={`chip-btn ${src === v ? "on" : ""}`} aria-pressed={src === v} onClick={() => setSrc(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="f-label">문항 수</span>
            <div className="chips">
              {[10, 15, 30].map((v) => (
                <button key={v} type="button" className={`chip-btn ${n === v ? "on" : ""}`} aria-pressed={n === v} onClick={() => setN(v)}>{v}</button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={unseen} onChange={(e) => setUnseen(e.target.checked)} />
            안 풀어 본 문항만
          </label>
        </fieldset>
        <p className="meta">조건에 맞는 문항 {pool}개</p>
        <div className="row">
          <button type="button" className="btn primary" disabled={!pool} onClick={() => go(`/play/random?${qs}&mode=practice`)}>풀기</button>
          <button type="button" className="btn ghost" disabled={!pool} onClick={() => go(`/play/random?${qs}&mode=flash`)}>카드로 넘기기</button>
        </div>
      </section>
    </main>
  );
}

/* ───────── 기록 ───────── */

/* ───────── 단원별 정답률 ───────── */

function TopicSection({ db }: { db: DB }) {
  useStore();
  const { list, overall } = topicStats(db);
  const weak = weakTopics(db);
  const rows = [...list].sort((a, b) => (a.adjusted ?? 2) - (b.adjusted ?? 2));
  return (
    <section aria-labelledby="tp-t">
      <h2 id="tp-t" className="section-title">단원별 정답률</h2>
      <p className="meta">
        처음 풀었을 때 기준이에요(빈칸은 맞힌 칸 비율). 전체 평균은 {pct(overall)}이고, 세로선이 평균 위치예요. 푼 문항이 적은 단원은 평균 쪽으로 보정해서 순서를 매겨요.
      </p>
      {weak.length ? (
        <div className="row">
          <button type="button" className="btn primary" onClick={() => go(`/play/random?t=${topicParam(weak)}&n=20&focus=1&mode=practice`)}>
            약한 단원 20문항 풀기
          </button>
        </div>
      ) : null}
      <ul className="topic-list">
        {rows.map((t) => (
          <li key={t.topic} className={`topic-row ${t.weak ? "is-weak" : ""}`}>
            <div className="tr-main">
              <span className="tr-name" title={t.topic}>
                {topicShort(t.topic)}
                {t.weak ? <span className="chip weak">약함</span> : null}
              </span>
              <span className="tr-bar" role="img" aria-label={`처음 풀 때 정답률 ${pct(t.first)}`}>
                <span className="tr-fill" style={{ width: `${(t.first ?? 0) * 100}%` }} />
                {overall !== null ? <i className="tr-avg" style={{ left: `${overall * 100}%` }} /> : null}
              </span>
              <span className="tr-pct">{pct(t.first)}</span>
            </div>
            <div className="tr-foot">
              <span className="meta">
                {t.seen}/{t.total}문항 풂{t.recent !== null && t.seen ? ` · 최근 ${pct(t.recent)}` : ""}
              </span>
              <button type="button" className="link-btn" onClick={() => go(`/play/random?t=${topicParam([t.topic])}&n=15&focus=1&mode=practice`)}>
                풀기
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────── 계정·동기화 ───────── */

function LoginForm({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await signIn(email.trim(), pw);
      onDone();
    } catch (e: any) {
      setErr(e.message || "로그인하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="auth" onSubmit={submit}>
      <div className="field">
        <label htmlFor={compact ? "em2" : "em"}>이메일</label>
        <input id={compact ? "em2" : "em"} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={compact ? "pw2" : "pw"}>비밀번호</label>
        <input id={compact ? "pw2" : "pw"} type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      {err ? <p className="err" role="alert">{err}</p> : null}
      <button type="submit" className="btn primary" disabled={busy || !email || !pw}>{busy ? "로그인하는 중…" : "로그인"}</button>
    </form>
  );
}

function UploadButton({ onDone, label = "문항 데이터 올리기" }: { onDone: (n: number) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function pick(f: File) {
    setBusy(true);
    try {
      const n = await uploadBundle(await f.text(), setMsg);
      setMsg(`${n}문항을 올렸어요.`);
      onDone(n);
    } catch (e: any) {
      setMsg(e.message || "올리지 못했어요.");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }
  return (
    <>
      <div className="row">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "올리는 중…" : label}</button>
        <input ref={ref} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </div>
      {msg ? <p className="notice" role="status">{msg}</p> : null}
    </>
  );
}

const STATUS_TEXT = { off: "꺼짐", syncing: "맞추는 중…", ok: "맞춰짐", offline: "오프라인 · 연결되면 맞춰요", error: "오류" } as const;

/** 이 사본(같은 폴더에 문항 파일이 있는 비공개 링크)에서 바로 클라우드로 올리기 */
function UploadLocal({ db, onDone }: { db: DB; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const n = await uploadFromLocal({ books: db.books, rounds: db.rounds, questions: db.questions }, setMsg);
      setMsg(`${n}문항과 그림을 클라우드에 올렸어요. 이제 공개 사이트에서 로그인하면 바로 풀 수 있어요.`);
      onDone();
    } catch (e: any) {
      setMsg(e.message || "올리지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={run}>{busy ? "올리는 중…" : "이 문항을 클라우드에 올리기"}</button>
      </div>
      {msg ? <p className="notice" role="status">{msg}</p> : null}
    </>
  );
}

function Account({ reboot, db, source }: { reboot: () => void; db: DB; source: "local" | "cloud" }) {
  const c = useCloud();
  if (!c.email)
    return (
      <div className="account">
        <p className="meta">로그인하면 풀이 기록, 오답 메모, 찍은 문제가 폰과 컴퓨터에 자동으로 맞춰져요.</p>
        <LoginForm compact onDone={reboot} />
      </div>
    );
  const when = c.lastSync ? new Date(c.lastSync).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="account">
      <p className="sync">
        <span className={`sync-dot ${c.status}`} aria-hidden="true" />
        <span>{c.email} · 동기화 {STATUS_TEXT[c.status]}{c.status === "ok" && when ? ` (${when})` : ""}</span>
      </p>
      {c.status === "error" && c.error ? <p className="err">{c.error}</p> : null}
      <div className="row">
        <button type="button" className="btn ghost" disabled={c.status === "syncing"} onClick={() => syncNow()}>지금 맞추기</button>
        <button type="button" className="btn ghost" onClick={() => signOut().then(reboot)}>로그아웃</button>
      </div>
      {source === "local" ? (
        <>
          <p className="meta">지금 보는 문항({db.questions.length}개)을 클라우드로 보내면 공개 사이트와 다른 기기에서도 로그인만 하면 풀 수 있어요. 처음 한 번, 그리고 문항이 바뀌었을 때만 누르면 돼요.</p>
          <UploadLocal db={db} onDone={() => {}} />
        </>
      ) : null}
      <details>
        <summary className="meta">문항 데이터 바꾸기</summary>
        <p className="meta">새로 받은 문항 묶음 파일(bioquiz-content….json)을 고르면 클라우드에 올라가고, 다른 기기는 다음에 열 때 받아요.</p>
        <UploadButton onDone={() => reboot()} />
      </details>
    </div>
  );
}

function LoginPage({ reboot }: { reboot: () => void }) {
  return (
    <main className="page">
      <h1 className="page-title">생물 미니</h1>
      <p className="lede">문항은 로그인한 뒤에만 보여요. Supabase에 만들어 둔 계정으로 로그인하세요.</p>
      <LoginForm onDone={reboot} />
    </main>
  );
}

function EmptyPage({ reboot }: { reboot: () => void }) {
  const c = useCloud();
  return (
    <main className="page">
      <h1 className="page-title">문항이 아직 없어요</h1>
      <p className="lede">처음 한 번, 받아 둔 문항 묶음 파일(bioquiz-content….json)을 올려 주세요. 올린 뒤에는 어느 기기에서든 로그인만 하면 돼요.</p>
      <UploadButton onDone={() => reboot()} />
      <p className="meta">{c.email} 로 로그인됨 · <button type="button" className="link-btn" onClick={() => signOut().then(reboot)}>로그아웃</button></p>
    </main>
  );
}

function Stats({ db, reboot, source }: { db: DB; reboot: () => void; source: "local" | "cloud" }) {
  const st = useStore();
  const stats = qStats();
  const seen = Object.keys(stats).filter((id) => db.q[id]);
  const tries = st.attempts.length;
  const correct = st.attempts.filter((a) => a.ok).length;
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");

  const days: { key: string; n: number; label: string }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d.getTime()), n: 0, label: `${d.getMonth() + 1}/${d.getDate()}` });
  }
  const dmap = Object.fromEntries(days.map((d) => [d.key, d]));
  for (const a of st.attempts) if (dmap[dayKey(a.t)]) dmap[dayKey(a.t)].n++;
  const maxN = Math.max(15, ...days.map((d) => d.n));

  const [armReset, setArmReset] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);

  function exportData() {
    try {
      const blob = new Blob([store.exportJSON()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `생물미니-기록-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setMsg("기록 파일 저장을 시작했어요. 파일이 안 받아지면 ‘기록 복사’를 쓰세요.");
    } catch {
      setMsg("이 화면에서는 파일 저장이 막혀 있어요. ‘기록 복사’를 쓰세요.");
    }
  }
  function copyData() {
    const text = store.exportJSON();
    navigator.clipboard
      .writeText(text)
      .then(() => setMsg("기록을 복사했어요. 다른 기기의 ‘붙여넣어 불러오기’에 붙여 넣으세요."))
      .catch(() => {
        setPaste(text);
        setMsg("복사가 막혀 있어요. 아래 칸의 내용을 직접 선택해 복사하세요.");
      });
  }
  function importText(t: string) {
    try {
      store.importJSON(t);
      setMsg("기록을 불러왔어요.");
      setPaste(null);
    } catch (e: any) {
      setMsg(e.message || "불러오지 못했어요. 기록 파일 내용 전체를 붙여 넣었는지 확인하세요.");
    }
  }
  function importData(f: File) {
    f.text().then(importText);
  }

  return (
    <main className="page">
      <h1 className="page-title">기록</h1>
      <div className="stat-row">
        <div className="stat"><span className="stat-n">{seen.length}</span><span className="meta">푼 문항 / 전체 {db.questions.filter((q) => !q.hidden).length}</span></div>
        <div className="stat"><span className="stat-n">{tries ? Math.round((correct / tries) * 100) : 0}%</span><span className="meta">정답률 ({tries}번 풂)</span></div>
        <div className="stat"><span className="stat-n">{streakDays()}</span><span className="meta">연속 공부일</span></div>
      </div>

      <section aria-labelledby="days-t">
        <h2 id="days-t" className="section-title">최근 4주 풀이 수</h2>
        <div className="days" role="img" aria-label="최근 28일 동안 하루에 푼 문항 수">
          {days.map((d) => (
            <span key={d.key} className="day" title={`${d.label} ${d.n}문항`}>
              <span className="day-bar" style={{ height: `${(d.n / maxN) * 100}%` }} />
            </span>
          ))}
        </div>
        <div className="days-axis meta"><span>{days[0].label}</span><span>오늘</span></div>
      </section>

      <section aria-labelledby="bk-t">
        <h2 id="bk-t" className="section-title">문제집별</h2>
        <table className="tbl">
          <thead><tr><th scope="col">문제집</th><th scope="col">푼 회차</th><th scope="col">푼 문항</th><th scope="col">정답률</th></tr></thead>
          <tbody>
            {db.books.map((b) => {
              const ids = db.questions.filter((q) => q.book_id === b.id && !q.hidden).map((q) => q.id);
              const s = ids.map((id) => stats[id]).filter(Boolean);
              const t = s.reduce((x, y) => x + y.tries, 0);
              const c = s.reduce((x, y) => x + y.correct, 0);
              const p = bookProgress(db, b.id);
              return (
                <tr key={b.id}>
                  <th scope="row">{b.title}</th>
                  <td>{p.done}/{p.total}</td>
                  <td>{s.length}/{ids.length}</td>
                  <td>{t ? `${Math.round((c / t) * 100)}%` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <TopicSection db={db} />

      <section aria-labelledby="set-t">
        <h2 id="set-t" className="section-title">설정</h2>
        <div className="filter-row">
          <span className="f-label">화면</span>
          <div className="chips">
            {[["system", "기기 설정"], ["light", "밝게"], ["dark", "어둡게"]].map(([v, l]) => (
              <button key={v} type="button" className={`chip-btn ${st.settings.theme === v ? "on" : ""}`} aria-pressed={st.settings.theme === v} onClick={() => store.setSettings({ theme: v as any })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <span className="f-label">글자</span>
          <div className="chips">
            {[["m", "보통"], ["l", "크게"]].map(([v, l]) => (
              <button key={v} type="button" className={`chip-btn ${st.settings.font === v ? "on" : ""}`} aria-pressed={st.settings.font === v} onClick={() => store.setSettings({ font: v as any })}>{l}</button>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="acc-t">
        <h2 id="acc-t" className="section-title">계정 · 동기화</h2>
        <Account reboot={reboot} db={db} source={source} />
      </section>

      <section aria-labelledby="bak-t">
        <h2 id="bak-t" className="section-title">백업</h2>
        <p className="meta">
          기록을 파일이나 글로 꺼내 두거나 다른 곳의 기록을 합쳐 넣을 수 있어요. 불러오면 지금 기록과 합쳐져요.
        </p>
        <div className="row">
          <button type="button" className="btn ghost" onClick={exportData}>기록 파일로 저장</button>
          <button type="button" className="btn ghost" onClick={copyData}>기록 복사</button>
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>기록 파일 불러오기</button>
          <button type="button" className="btn ghost" onClick={() => setPaste(paste === null ? "" : null)}>붙여넣어 불러오기</button>
          <input id="import-file" ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
        </div>
        {paste !== null ? (
          <div className="paste">
            <label htmlFor="paste-box" className="meta">기록 내용</label>
            <textarea id="paste-box" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="복사한 기록을 여기에 붙여 넣으세요" />
            <div className="row">
              <button type="button" className="btn primary" disabled={!paste.trim()} onClick={() => importText(paste)}>이 내용으로 불러오기</button>
            </div>
          </div>
        ) : null}
        {msg ? <p className="notice" role="status">{msg}</p> : null}
        {!armReset ? (
          <button type="button" className="link-btn danger" onClick={() => setArmReset(true)}>기록 모두 지우기</button>
        ) : (
          <div className="row">
            <span className="meta">풀이 기록, 오답 메모, 찍은 문제가 모두 지워지고 되돌릴 수 없어요.</span>
            <button type="button" className="btn ghost" onClick={() => setArmReset(false)}>취소</button>
            <button type="button" className="btn ng" onClick={() => { store.reset(); setArmReset(false); setMsg("기록을 모두 지웠어요."); }}>모두 지우기</button>
          </div>
        )}
      </section>
    </main>
  );
}

function NotFound() {
  return (
    <main className="page">
      <h1 className="page-title">찾을 수 없는 화면이에요</h1>
      <a className="btn primary" href="#/">오늘 화면으로</a>
    </main>
  );
}

/* ───────── 앱 ───────── */

type Boot =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "empty" }
  | { kind: "ready"; db: DB; notice: string; source: "local" | "cloud" }
  | { kind: "error"; msg: string };

/** 문항을 어디서 가져올지 정한다.
    로그인했으면 클라우드(기기에 남긴 사본 포함) → 없으면 같은 폴더의 파일(비공개 링크용) → 둘 다 없으면 로그인 화면 */
async function bootApp(): Promise<Boot> {
  let notice = "";
  if (isLoggedIn()) {
    try {
      const { raw, offline } = await loadCloudContent();
      if (raw) {
        startAutoSync();
        syncNow();
        return { kind: "ready", source: "cloud", db: buildDB(raw), notice: offline ? "오프라인이에요. 기기에 받아 둔 문항으로 풀고, 기록은 연결되면 맞춰요." : "" };
      }
      const local = await loadLocalRaw();
      if (!local) return { kind: "empty" };
      startAutoSync();
      syncNow();
      return { kind: "ready", source: "local", db: buildDB(local), notice: "" };
    } catch (e: any) {
      if (!isLoggedIn()) notice = e.message; // 로그인 만료
      else notice = `클라우드에서 문항을 받지 못했어요: ${e.message}`;
    }
  }
  const local = await loadLocalRaw();
  if (local) {
    if (isLoggedIn()) {
      startAutoSync();
      syncNow();
    }
    return { kind: "ready", source: "local", db: buildDB(local), notice };
  }
  if (!isLoggedIn()) return { kind: "login" };
  return { kind: "error", msg: notice || "문항을 불러오지 못했어요." };
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const [noticeShown, setNoticeShown] = useState(true);
  const route = useRoute();
  const st = useStore();
  const reboot = () => {
    setBoot({ kind: "loading" });
    setNoticeShown(true);
    bootApp().then(setBoot).catch((e) => setBoot({ kind: "error", msg: e.message || String(e) }));
  };

  useEffect(reboot, []);
  // 새 채점 기준으로 지난 빈칸 오답 다시 보기: 처음 열 때, 기록을 불러오거나 다른 기기 기록이 합쳐질 때
  useEffect(() => {
    if (boot.kind === "ready") store.regradeBlanks(boot.db);
  }, [boot, st.attempts.length]);
  useEffect(() => {
    const root = document.documentElement;
    if (st.settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", st.settings.theme);
    root.setAttribute("data-font", st.settings.font);
  }, [st.settings.theme, st.settings.font]);

  const wrap = (v: React.ReactNode) => <div className="shell"><div className="content">{v}</div></div>;
  if (boot.kind === "error")
    return wrap(
      <main className="page">
        <h1 className="page-title">문항을 불러오지 못했어요</h1>
        <p>{boot.msg}</p>
        <div className="row">
          <button className="btn primary" onClick={reboot}>다시 시도</button>
          <button className="btn ghost" onClick={() => signOut().then(reboot)}>로그아웃</button>
        </div>
      </main>,
    );
  if (boot.kind === "login") return wrap(<LoginPage reboot={reboot} />);
  if (boot.kind === "empty") return wrap(<EmptyPage reboot={reboot} />);
  if (boot.kind === "loading") return wrap(<main className="page loading" aria-busy="true"><Strip cells={Array(15).fill("empty")} label="불러오는 중" /></main>);
  const db = boot.db;

  const [p0, ...rest] = route.path;
  const playing = p0 === "play" || (p0 === "cards" && rest[0] === "play");
  let view: React.ReactNode;
  if (!p0) view = <Home db={db} />;
  else if (p0 === "books") view = <Books db={db} />;
  else if (p0 === "book") view = <BookPage db={db} id={rest[0]} />;
  else if (p0 === "round") view = <RoundPage db={db} id={rest[0]} />;
  else if (p0 === "paper") view = <PaperEntry key={route.query.get("edit") || rest[0]} db={db} id={rest[0]} editId={route.query.get("edit") || ""} />;
  else if (p0 === "play") view = <Play db={db} path={rest} query={route.query} />;
  else if (p0 === "result") view = <Result db={db} id={rest[0]} />;
  else if (p0 === "review") view = <Review db={db} />;
  else if (p0 === "notes") view = <NotesPage db={db} query={route.query} />;
  else if (p0 === "stats") view = <Stats db={db} reboot={reboot} source={boot.source} />;
  else if (p0 === "cards") {
    if (rest[0] === "play") view = <CardPlay query={route.query} />;
    else if (rest[0] === "deck" && rest[1]) view = <DeckPage key={rest[1]} id={rest[1]} />;
    else if (rest[0] === "edit" && rest[1]) view = <DeckEditPage key={rest[1]} id={rest[1]} query={route.query} />;
    else if (rest[0] === "new") view = <DeckEditPage key="new" query={route.query} />;
    else view = <CardsHome />;
  }
  else view = <NotFound />;

  const active = !p0 ? "" : p0 === "book" || p0 === "round" || p0 === "paper" ? "books" : p0 === "result" ? "" : p0 === "notes" ? "review" : p0;
  return (
    <div className={`shell ${playing ? "is-playing" : ""}`}>
      {!playing ? <Nav active={active} /> : null}
      <div className="content">
        {boot.notice && noticeShown && !playing ? (
          <p className="notice" role="status" style={{ marginTop: 16 }}>
            {boot.notice}{" "}
            <button type="button" className="link-btn" onClick={() => setNoticeShown(false)}>닫기</button>
          </p>
        ) : null}
        {view}
      </div>
    </div>
  );
}
