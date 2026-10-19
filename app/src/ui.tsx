import React, { useState } from "react";
import { CIRCLED, Question, Resp, answerText, blankMatches, store, useStore } from "./lib";

/** 회차 진행 띠: 칸마다 정답(보라)·오답(분홍)·미채점·현재 */
export type Cell = true | false | null | "answered" | "empty";
export function Strip({ cells, current, onPick, size = "m", label }: { cells: Cell[]; current?: number; onPick?: (i: number) => void; size?: "s" | "m"; label?: string }) {
  return (
    <div className={`strip strip-${size}`} role={onPick ? "tablist" : "img"} aria-label={label || "진행 상황"} style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
      {cells.map((c, i) => {
        const cls = c === true ? "ok" : c === false ? "ng" : c === null ? "pend" : c === "answered" ? "ans" : "";
        const props = {
          key: i,
          className: `cell ${cls} ${current === i ? "cur" : ""}`,
          title: `${i + 1}번`,
        };
        return onPick ? <button {...props} type="button" role="tab" aria-selected={current === i} aria-label={`${i + 1}번으로 이동`} onClick={() => onPick(i)} /> : <span {...props} />;
      })}
    </div>
  );
}

export function BookmarkButton({ qid }: { qid: string }) {
  const st = useStore();
  const on = st.bookmarks[qid] > 0;
  return (
    <button type="button" className={`icon-btn ${on ? "on" : ""}`} aria-pressed={on} aria-label={on ? "북마크 해제" : "북마크"} onClick={() => store.toggleBookmark(qid)}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M6 3.5h12v17l-6-4.2-6 4.2z" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function Paragraphs({ text }: { text: string }) {
  return <>{text.split(/\n+/).map((t, i) => <p key={i}>{t}</p>)}</>;
}

/** 지문 속 '1)____' 빈칸을 번호가 보이는 칸으로 바꿔 보여준다 */
function PassageText({ text }: { text: string }) {
  const parts = text.split(/(\d\)\s*_{3,}|_{3,})/);
  let auto = 0;
  return (
    <p>
      {parts.map((p, i) => {
        const m = p.match(/^(\d)\)\s*_{3,}$/);
        if (m) return <span key={i} className="blank-mark">{m[1]}</span>;
        if (/^_{3,}$/.test(p)) {
          auto++;
          return <span key={i} className="blank-mark">{auto}</span>;
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </p>
  );
}

type QVProps = {
  q: Question;
  resp: Resp;
  setResp?: (r: Resp) => void;
  reveal: boolean;
  index?: number;
  total?: number;
  interactive?: boolean;
};

export function QuestionView({ q, resp, setResp, reveal, index, total, interactive = true }: QVProps) {
  const blanks = q.type === "blank" ? Math.max(q.accepted_answers.length, (q.answer as string[] | null)?.length || 0, 1) : 0;
  return (
    <article className="question" aria-labelledby={`stem-${q.id}`}>
      <header className="q-head">
        <span className="q-num">
          {index != null ? `${index + 1}` : q.number}
          {total ? <span className="q-total"> / {total}</span> : null}
        </span>
        {q.source ? <span className="chip">{q.source}</span> : null}
        {q.type !== "mcq" ? <span className="chip quiet">{q.type === "blank" ? "빈칸" : "주관식"}</span> : null}
        <span className="spacer" />
        <BookmarkButton qid={q.id} />
      </header>

      <h2 className="stem" id={`stem-${q.id}`}>{q.stem}</h2>

      {q.images.map((src) => (
        <figure key={src} className="figure">
          <img src={src} alt={`${q.number}번 문항 그림`} loading="lazy" />
        </figure>
      ))}

      {q.passage ? (
        <div className="passage">
          <PassageText text={q.passage} />
        </div>
      ) : null}

      {q.statements.length ? (
        <dl className="statements" aria-label="보기">
          {q.statements.map((s) => (
            <div key={s.label} className="st">
              <dt>{s.label}.</dt>
              <dd>{s.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {q.type === "mcq" ? (
        <ol className="choices">
          {q.choices.map((c, i) => {
            const chosen = resp === i;
            const correct = (q.answer as number[]).includes(i);
            const cls = reveal ? (correct ? "correct" : chosen ? "wrong" : "") : chosen ? "chosen" : "";
            return (
              <li key={i}>
                <button
                  type="button"
                  className={`choice ${cls}`}
                  aria-pressed={chosen}
                  disabled={!interactive || reveal || !setResp}
                  onClick={() => setResp && setResp(i)}
                >
                  <span className="mark" aria-hidden="true">{CIRCLED[i]}</span>
                  <span className="ctext">{c}</span>
                  {reveal && correct ? <span className="sr-only">정답</span> : null}
                  {reveal && chosen && !correct ? <span className="sr-only">내가 고른 오답</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}

      {q.type === "blank" && interactive ? (
        <div className="blanks">
          {Array.from({ length: blanks }, (_, i) => {
            const arr = Array.isArray(resp) ? resp : [];
            const acc = q.accepted_answers[i] || [((q.answer as string[]) || [])[i] || ""];
            const ok = reveal ? blankMatches(arr[i] || "", acc) : null;
            return (
              <label key={i} className={`blank ${ok === true ? "correct" : ok === false ? "wrong" : ""}`}>
                <span className="blank-mark">{i + 1}</span>
                <input
                  value={arr[i] || ""}
                  readOnly={reveal}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="답 입력"
                  onChange={(e) => {
                    const next = Array.from({ length: blanks }, (_, k) => arr[k] || "");
                    next[i] = e.target.value;
                    setResp && setResp(next);
                  }}
                />
                {reveal ? <span className="blank-ans">{((q.answer as string[]) || [])[i]}</span> : null}
              </label>
            );
          })}
        </div>
      ) : null}

      {(q.type === "short" || q.type === "essay") && interactive ? (
        <label className="free">
          <span className="sr-only">내 답</span>
          <textarea
            rows={3}
            value={typeof resp === "string" ? resp : ""}
            readOnly={reveal}
            placeholder="답을 적거나 머릿속으로 떠올린 뒤 정답을 확인하세요"
            onChange={(e) => setResp && setResp(e.target.value)}
          />
        </label>
      ) : null}
    </article>
  );
}

export function Explanation({ q, open = true }: { q: Question; open?: boolean }) {
  const [show, setShow] = useState(open);
  const ans = answerText(q);
  return (
    <section className="explain" aria-label="정답과 해설">
      {q.type !== "mcq" && ans ? (
        <div className="model-answer">
          <span className="label">정답</span>
          <Paragraphs text={ans} />
        </div>
      ) : null}
      {q.type === "mcq" ? (
        <div className="model-answer">
          <span className="label">정답</span>
          <p>{ans}</p>
        </div>
      ) : null}
      {q.note ? (
        <p className="src-note">
          <span className="label">검수 메모</span>
          {q.note}
        </p>
      ) : null}
      {q.explanation || q.explanation_images.length ? (
        <>
          <button type="button" className="link-btn" aria-expanded={show} onClick={() => setShow(!show)}>
            {show ? "해설 접기" : "해설 보기"}
          </button>
          {show ? (
            <div className="explain-body">
              <Paragraphs text={q.explanation} />
              {q.explanation_images.map((src) => (
                <figure key={src} className="figure">
                  <img src={src} alt="해설 그림" loading="lazy" />
                </figure>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function SelfGrade({ onGrade }: { onGrade: (ok: boolean) => void }) {
  return (
    <div className="self-grade" role="group" aria-label="스스로 채점">
      <span>정답과 비교해 보세요</span>
      <div className="row">
        <button type="button" className="btn ng" onClick={() => onGrade(false)}>틀렸어요</button>
        <button type="button" className="btn ok" onClick={() => onGrade(true)}>맞았어요</button>
      </div>
    </div>
  );
}

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.round(Math.abs(sec)));
  return `${sec < 0 ? "+" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
