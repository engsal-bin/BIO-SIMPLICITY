import React, { useEffect, useMemo, useRef, useState } from "react";
import { DB, Resp, Session, go, gradeDetail, store, uid } from "./lib";
import { Cell, Explanation, QuestionView, SelfGrade, Strip, fmtTime } from "./ui";

export type RunSpec = {
  kind: "round" | "practice" | "flash";
  title: string;
  qids: string[];
  back: string;
  roundId?: string;
  timeLimit?: number;
};

/* ───────── 회차 풀기: 끝까지 해설 없이, 제한시간, 제출 후 채점 ───────── */

export function ExamRunner({ db, spec }: { db: DB; spec: RunSpec }) {
  const qs = spec.qids.map((id) => db.q[id]);
  const [idx, setIdx] = useState(0);
  const [resps, setResps] = useState<Record<string, Resp>>({});
  const started = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(false);
  const [leave, setLeave] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", warn);
    };
  }, []);

  const elapsed = (now - started.current) / 1000;
  const left = (spec.timeLimit || 420) - elapsed;
  const q = qs[idx];
  const answered = (r: Resp) => (Array.isArray(r) ? r.some((x) => x && x.trim()) : r !== undefined && r !== null && r !== "");
  const cells: Cell[] = qs.map((x) => (answered(resps[x.id]) ? "answered" : "empty"));
  const unanswered = cells.filter((c) => c === "empty").length;

  function submit() {
    const results: Record<string, boolean | null> = {};
    for (const x of qs) {
      const g = gradeDetail(x, resps[x.id]);
      results[x.id] = g.ok;
      if (g.ok !== null) store.record(x.id, g.ok, "round", g.s);
    }
    const s: Session = {
      id: uid(),
      kind: "round",
      title: spec.title,
      roundId: spec.roundId,
      back: spec.back,
      qids: spec.qids,
      results,
      resps,
      startedAt: started.current,
      durationSec: Math.round((Date.now() - started.current) / 1000),
    };
    store.saveSession(s);
    go(`/result/${s.id}`, true);
  }

  return (
    <div className="runner">
      <div className="run-top">
        <button type="button" className="link-btn" onClick={() => (Object.keys(resps).length ? setLeave(true) : go(spec.back))}>
          그만두기
        </button>
        <span className="run-title">{spec.title}</span>
        <span className={`timer ${left < 0 ? "over" : left < 60 ? "low" : ""}`} aria-live="off" aria-label="남은 시간">
          {fmtTime(left)}
        </span>
      </div>
      <Strip cells={cells} current={idx} onPick={setIdx} label="문항 이동" />

      <QuestionView key={q.id} q={q} index={idx} total={qs.length} resp={resps[q.id]} setResp={(r) => setResps({ ...resps, [q.id]: r })} reveal={false} />

      <div className="run-actions">
        <button type="button" className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>이전</button>
        {idx < qs.length - 1 ? (
          <button type="button" className="btn primary" onClick={() => setIdx(idx + 1)}>다음</button>
        ) : (
          <button type="button" className="btn primary" onClick={() => (unanswered ? setConfirm(true) : submit())}>제출하고 채점</button>
        )}
      </div>
      {idx < qs.length - 1 ? (
        <button type="button" className="link-btn submit-early" onClick={() => (unanswered ? setConfirm(true) : submit())}>지금 제출하기</button>
      ) : null}

      {confirm ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-t">
          <div className="sheet-card">
            <p id="confirm-t">안 푼 문항이 {unanswered}개 있어요. 그대로 제출하면 오답으로 채점돼요.</p>
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>계속 풀기</button>
              <button type="button" className="btn primary" onClick={submit}>제출하고 채점</button>
            </div>
          </div>
        </div>
      ) : null}

      {leave ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="leave-t">
          <div className="sheet-card">
            <p id="leave-t">지금 나가면 이번 회차에 고른 답이 저장되지 않아요.</p>
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => setLeave(false)}>계속 풀기</button>
              <button type="button" className="btn ng" onClick={() => go(spec.back)}>저장하지 않고 나가기</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ───────── 연습 풀기: 한 문항씩 바로 정답·해설 ───────── */

export function PracticeRunner({ db, spec }: { db: DB; spec: RunSpec }) {
  const qs = useMemo(() => spec.qids.map((id) => db.q[id]).filter(Boolean), [spec.qids.join()]);
  const [idx, setIdx] = useState(0);
  const [resps, setResps] = useState<Record<string, Resp>>({});
  const [results, setResults] = useState<Record<string, boolean | null>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const started = useRef(Date.now());
  const sid = useRef(uid());

  if (!qs.length) {
    return (
      <div className="empty-state">
        <p>풀 문항이 없어요.</p>
        <button type="button" className="btn primary" onClick={() => go(spec.back)}>돌아가기</button>
      </div>
    );
  }
  const q = qs[idx];
  const isRevealed = !!revealed[q.id];
  const result = results[q.id];
  const cells: Cell[] = qs.map((x) => (x.id in results ? results[x.id] : "empty"));

  function setResult(ok: boolean, s?: number) {
    if (q.id in results) store.amendLast(q.id, ok);
    else store.record(q.id, ok, spec.kind, s);
    setResults({ ...results, [q.id]: ok });
  }
  function check() {
    setRevealed({ ...revealed, [q.id]: true });
    const g = gradeDetail(q, resps[q.id]);
    if (g.ok !== null) setResult(g.ok, g.s);
  }
  function finish() {
    const s: Session = {
      id: sid.current,
      kind: spec.kind,
      title: spec.title,
      roundId: spec.roundId,
      back: spec.back,
      qids: qs.map((x) => x.id),
      results,
      resps,
      startedAt: started.current,
      durationSec: Math.round((Date.now() - started.current) / 1000),
    };
    store.saveSession(s);
    go(`/result/${s.id}`, true);
  }
  const graded = q.id in results;
  const needsSelf = isRevealed && !graded;

  return (
    <div className="runner">
      <div className="run-top">
        <button type="button" className="link-btn" onClick={() => (Object.keys(results).length ? finish() : go(spec.back))}>
          {Object.keys(results).length ? "끝내기" : "나가기"}
        </button>
        <span className="run-title">{spec.title}</span>
        <span className="run-count">{Object.keys(results).length}/{qs.length}</span>
      </div>
      <Strip cells={cells} current={idx} onPick={setIdx} label="문항 이동" />

      <QuestionView key={q.id} q={q} index={idx} total={qs.length} resp={resps[q.id]} setResp={(r) => setResps({ ...resps, [q.id]: r })} reveal={isRevealed} />

      {isRevealed ? (
        <>
          {graded ? (
            <p className={`verdict ${result ? "ok" : "ng"}`} role="status">
              {result ? "맞았어요" : partialText(q, resps[q.id]) || "틀렸어요"}
              {q.type === "blank" && !result ? (
                <button type="button" className="link-btn" onClick={() => setResult(true)}>내 답도 맞아요</button>
              ) : null}
            </p>
          ) : null}
          <Explanation q={q} />
          {needsSelf ? <SelfGrade onGrade={setResult} /> : null}
        </>
      ) : null}

      <div className="run-actions">
        <button type="button" className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>이전</button>
        {!isRevealed ? (
          <button type="button" className="btn primary" onClick={check}>정답 확인</button>
        ) : idx < qs.length - 1 ? (
          <button type="button" className="btn primary" disabled={needsSelf} onClick={() => setIdx(idx + 1)}>다음</button>
        ) : (
          <button type="button" className="btn primary" disabled={needsSelf} onClick={finish}>결과 보기</button>
        )}
      </div>
    </div>
  );
}

/** 빈칸형 일부만 맞았을 때 '3칸 중 2칸 맞았어요' */
function partialText(q: DB["questions"][number], r: Resp): string {
  if (q.type !== "blank") return "";
  const g = gradeDetail(q, r);
  if (!g.hits || g.ok) return "";
  const n = g.hits.filter(Boolean).length;
  return n ? `${g.hits.length}칸 중 ${n}칸 맞았어요` : "";
}

/* ───────── 플래시카드: 앞면 문제, 뒷면 정답+해설 ───────── */

export function FlashRunner({ db, spec }: { db: DB; spec: RunSpec }) {
  const qs = useMemo(() => spec.qids.map((id) => db.q[id]).filter(Boolean), [spec.qids.join()]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<string, boolean | null>>({});
  const started = useRef(Date.now());
  const sid = useRef(uid());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!qs.length) {
    return (
      <div className="empty-state">
        <p>카드로 넘길 문항이 없어요.</p>
        <button type="button" className="btn primary" onClick={() => go(spec.back)}>돌아가기</button>
      </div>
    );
  }
  const q = qs[idx];
  const cells: Cell[] = qs.map((x) => (x.id in results ? results[x.id] : "empty"));

  function finish(res: Record<string, boolean | null>) {
    const s: Session = {
      id: sid.current, kind: "flash", title: spec.title, roundId: spec.roundId, back: spec.back,
      qids: qs.map((x) => x.id), results: res, resps: {}, startedAt: started.current,
      durationSec: Math.round((Date.now() - started.current) / 1000),
    };
    store.saveSession(s);
    go(`/result/${s.id}`, true);
  }
  function mark(ok: boolean) {
    store.record(q.id, ok, "flash");
    const res = { ...results, [q.id]: ok };
    setResults(res);
    setFlipped(false);
    if (idx < qs.length - 1) setIdx(idx + 1);
    else finish(res);
  }

  return (
    <div className="runner flash">
      <div className="run-top">
        <button type="button" className="link-btn" onClick={() => (Object.keys(results).length ? finish(results) : go(spec.back))}>
          {Object.keys(results).length ? "끝내기" : "나가기"}
        </button>
        <span className="run-title">{spec.title}</span>
        <span className="run-count">{idx + 1}/{qs.length}</span>
      </div>
      <Strip cells={cells} current={idx} label="카드 진행" />

      <div className={`card ${flipped ? "back" : "front"}`}>
        {!flipped ? (
          <>
            <QuestionView key={q.id} q={q} index={idx} total={qs.length} resp={undefined} reveal={false} interactive={false} />
            <button type="button" className="btn primary wide" onClick={() => setFlipped(true)}>정답 보기</button>
          </>
        ) : (
          <>
            <QuestionView key={q.id + "b"} q={q} index={idx} total={qs.length} resp={undefined} reveal={true} interactive={false} />
            <Explanation q={q} />
            <div className="row two">
              <button type="button" className="btn ng" onClick={() => mark(false)}>몰랐어요</button>
              <button type="button" className="btn ok" onClick={() => mark(true)}>알았어요</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
