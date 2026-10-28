/* 덱 편집기: 옵시디언처럼 보이는 그대로 고친다.
   - 덱 이름·묶음 이름은 제목 모양 입력칸, 카드는 표의 칸을 눌러 바로 고친다
   - 굵게/기울임은 도구 막대나 Ctrl+B / Ctrl+I, 저장은 마크다운(| 항목 | 내용 |)으로
   - Enter: 항목 → 내용 → 다음 카드, 빈 줄에서 Backspace: 그 줄 지우기
   - 마크다운 표를 칸에 붙여 넣으면 여러 카드로 들어간다. '마크다운' 보기에서 원문도 고칠 수 있다 */
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { store } from "./lib";
import { EditModel, EditRow, EditSection, fromEditModel, newKey, parseCheatSheet, toEditModel } from "./deckdata";

/* ───────── 마크다운 ↔ 칸 안의 HTML ───────── */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function mdToHtml(md: string): string {
  return esc(md)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?=[^\w]|$)/g, "$1<em>$2</em>");
}

function htmlToMd(root: Node): string {
  let out = "";
  root.childNodes.forEach((n, i) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n.textContent || "").replace(/ /g, " ");
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    const tag = el.tagName;
    const inner = htmlToMd(el);
    const weight = el.style?.fontWeight;
    if (tag === "BR") out += " ";
    else if (tag === "STRONG" || tag === "B" || weight === "bold" || Number(weight) >= 600) out += inner.trim() ? `**${inner}**` : inner;
    else if (tag === "EM" || tag === "I" || el.style?.fontStyle === "italic") out += inner.trim() ? `_${inner}_` : inner;
    else if (tag === "DIV" || tag === "P") out += (i > 0 && out && !out.endsWith(" ") ? " " : "") + inner;
    else out += inner;
  });
  return out.replace(/\*\*\*\*/g, "").replace(/__/g, "");
}

function placeCaretAtEnd(el: HTMLElement) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

const looksLikeTable = (t: string) => t.split(/\r?\n/).filter((l) => /^\s*\|.*\|/.test(l)).length >= 1 && /\n/.test(t.trim());

type CellProps = {
  id: string;
  value: string;
  label: string;
  placeholder: string;
  className?: string;
  onChange: (md: string) => void;
  onEnter: () => void;
  onBackspaceEmpty?: () => void;
  onPasteTable: (text: string) => void;
};

function RichCell({ id, value, label, placeholder, className = "", onChange, onEnter, onBackspaceEmpty, onPasteTable }: CellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (ref.current && value !== last.current) {
      ref.current.innerHTML = mdToHtml(value);
      last.current = value;
    }
  }, [value]);
  return (
    <div
      ref={ref}
      className={`ed-cell ${className}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline={false}
      data-cell={id}
      data-ph={placeholder}
      spellCheck={false}
      onInput={() => {
        const el = ref.current!;
        if (!el.textContent) el.innerHTML = "";
        const md = htmlToMd(el);
        last.current = md;
        onChange(md);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        if (looksLikeTable(text)) onPasteTable(text);
        else document.execCommand("insertText", false, text.replace(/\s*\r?\n\s*/g, " "));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        } else if (e.key === "Backspace" && !ref.current?.textContent && onBackspaceEmpty) {
          e.preventDefault();
          onBackspaceEmpty();
        }
      }}
    />
  );
}

/* ───────── 편집기 ───────── */

type Props = { initial?: { id: string; title: string; md: string; builtIn?: boolean; overridden?: boolean }; onDone: () => void };

export function DeckEditor({ initial, onDone }: Props) {
  const [mode, setMode] = useState<"visual" | "markdown">("visual");
  const [model, setModel] = useState<EditModel>(() => {
    const m = toEditModel(initial?.md || "", initial?.title || "");
    if (initial?.title) m.title = initial.title;
    return m;
  });
  const [md, setMd] = useState(() => fromEditModel(model));
  const [dirty, setDirty] = useState(false);
  const [armCancel, setArmCancel] = useState(false);
  const [armRevert, setArmRevert] = useState(false);
  const [armSec, setArmSec] = useState<string | null>(null);
  const focusNext = useRef<{ cell: string } | null>(null);

  useLayoutEffect(() => {
    if (!focusNext.current) return;
    const el = document.querySelector(`[data-cell="${focusNext.current.cell}"]`) as HTMLElement | null;
    focusNext.current = null;
    if (el) placeCaretAtEnd(el);
  });

  const currentMd = mode === "visual" ? fromEditModel(model) : md;
  const parsed = useMemo(() => parseCheatSheet("preview", currentMd, model.title || "컨닝페이퍼"), [currentMd]);
  const n = parsed.sections.reduce((x, s) => x + s.cards.length, 0);

  function update(f: (m: EditModel) => EditModel) {
    setModel((m) => f(m));
    setDirty(true);
  }
  const mapSec = (key: string, f: (s: EditSection) => EditSection) => update((m) => ({ ...m, sections: m.sections.map((s) => (s.key === key ? f(s) : s)) }));
  const setRow = (sk: string, rk: string, p: Partial<EditRow>) => mapSec(sk, (s) => ({ ...s, rows: s.rows.map((r) => (r.key === rk ? { ...r, ...p } : r)) }));
  function addRow(sk: string, afterKey?: string, rows?: EditRow[]) {
    const fresh = rows || [{ key: newKey(), front: "", back: "" }];
    mapSec(sk, (s) => {
      const i = afterKey ? s.rows.findIndex((r) => r.key === afterKey) + 1 : s.rows.length;
      return { ...s, rows: [...s.rows.slice(0, i), ...fresh, ...s.rows.slice(i)] };
    });
    focusNext.current = { cell: `${fresh[fresh.length - 1].key}-${rows ? "b" : "f"}` };
  }
  function removeRow(sk: string, rk: string, focusPrev: boolean) {
    const s = model.sections.find((x) => x.key === sk);
    const i = s ? s.rows.findIndex((r) => r.key === rk) : -1;
    if (focusPrev && s && i > 0) focusNext.current = { cell: `${s.rows[i - 1].key}-b` };
    mapSec(sk, (x) => ({ ...x, rows: x.rows.filter((r) => r.key !== rk) }));
  }
  function pasteTable(sk: string, afterKey: string, text: string) {
    const m = toEditModel(text);
    const rows = m.sections.flatMap((s) => s.rows).filter((r) => r.front || r.back);
    if (!rows.length) return;
    // 지금 줄이 비어 있으면 그 자리를 채운다
    const s = model.sections.find((x) => x.key === sk);
    const cur = s?.rows.find((r) => r.key === afterKey);
    if (cur && !cur.front && !cur.back) {
      mapSec(sk, (x) => {
        const i = x.rows.findIndex((r) => r.key === afterKey);
        return { ...x, rows: [...x.rows.slice(0, i), ...rows, ...x.rows.slice(i + 1)] };
      });
      focusNext.current = { cell: `${rows[rows.length - 1].key}-b` };
    } else addRow(sk, afterKey, rows);
  }
  function moveSec(key: string, d: -1 | 1) {
    update((m) => {
      const i = m.sections.findIndex((s) => s.key === key);
      const j = i + d;
      if (j < 0 || j >= m.sections.length) return m;
      const arr = m.sections.slice();
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...m, sections: arr };
    });
  }
  function addSection() {
    const s: EditSection = { key: newKey(), title: "", rows: [{ key: newKey(), front: "", back: "" }] };
    update((m) => ({ ...m, sections: [...m.sections, s] }));
    focusNext.current = { cell: `${s.key}-h` };
  }

  function switchMode(next: "visual" | "markdown") {
    if (next === mode) return;
    if (next === "markdown") setMd(fromEditModel(model));
    else {
      const m = toEditModel(md, model.title);
      setModel(m);
    }
    setMode(next);
  }

  function save() {
    const text = currentMd;
    const title = (mode === "visual" ? model.title : toEditModel(text, model.title).title).trim() || parsed.title;
    store.saveDeck({ id: initial?.id, title, md: text });
    onDone();
  }

  const fmt = (cmd: "bold" | "italic") => (e: React.MouseEvent) => {
    e.preventDefault();
    document.execCommand(cmd);
  };

  return (
    <div className="deck-editor ed">
      <div className="ed-bar">
        <div className="seg" role="tablist" aria-label="편집 방식">
          <button type="button" role="tab" aria-selected={mode === "visual"} className={mode === "visual" ? "on" : ""} onClick={() => switchMode("visual")}>편집</button>
          <button type="button" role="tab" aria-selected={mode === "markdown"} className={mode === "markdown" ? "on" : ""} onClick={() => switchMode("markdown")}>마크다운</button>
        </div>
        <span className="spacer" />
        {mode === "visual" ? (
          <>
            <button type="button" className="ed-tool" onMouseDown={fmt("bold")} aria-label="굵게 (Ctrl+B)" title="굵게 (Ctrl+B)"><b>B</b></button>
            <button type="button" className="ed-tool" onMouseDown={fmt("italic")} aria-label="기울임 (Ctrl+I)" title="기울임 (Ctrl+I)"><i>I</i></button>
          </>
        ) : null}
      </div>

      {mode === "visual" ? (
        <>
          <input
            className="ed-title"
            value={model.title}
            placeholder="덱 이름"
            aria-label="덱 이름"
            onChange={(e) => update((m) => ({ ...m, title: e.target.value }))}
          />
          {model.sections.map((s, si) => (
            <section key={s.key} className="ed-sec">
              <div className="ed-sec-head">
                <input
                  className="ed-h2"
                  data-cell={`${s.key}-h`}
                  value={s.title}
                  placeholder="묶음 이름 (예: 식물)"
                  aria-label={`${si + 1}번째 묶음 이름`}
                  onChange={(e) => mapSec(s.key, (x) => ({ ...x, title: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const first = s.rows[0];
                      if (first) focusNext.current = { cell: `${first.key}-f` }, setModel((m) => ({ ...m }));
                      else addRow(s.key);
                    }
                  }}
                />
                <span className="ed-sec-tools">
                  <button type="button" className="icon-btn sm" disabled={si === 0} onClick={() => moveSec(s.key, -1)} aria-label="묶음 위로">↑</button>
                  <button type="button" className="icon-btn sm" disabled={si === model.sections.length - 1} onClick={() => moveSec(s.key, 1)} aria-label="묶음 아래로">↓</button>
                  {armSec === s.key ? (
                    <button type="button" className="btn ng sm" onClick={() => { update((m) => ({ ...m, sections: m.sections.filter((x) => x.key !== s.key) })); setArmSec(null); }}>
                      묶음 지우기
                    </button>
                  ) : (
                    <button type="button" className="icon-btn sm" onClick={() => setArmSec(s.key)} aria-label="묶음 지우기">✕</button>
                  )}
                </span>
              </div>
              <div className="ed-table" role="table" aria-label={`${s.title || "묶음"} 카드`}>
                <div className="ed-row ed-headrow" role="row">
                  <span role="columnheader">항목</span>
                  <span role="columnheader">내용</span>
                  <span />
                </div>
                {s.rows.map((r, ri) => (
                  <div key={r.key} className="ed-row" role="row">
                    <RichCell
                      id={`${r.key}-f`}
                      className="ed-front"
                      value={r.front}
                      label={`${ri + 1}번 카드 항목`}
                      placeholder="항목"
                      onChange={(v) => setRow(s.key, r.key, { front: v })}
                      onEnter={() => {
                        focusNext.current = { cell: `${r.key}-b` };
                        setModel((m) => ({ ...m }));
                      }}
                      onBackspaceEmpty={!r.back && s.rows.length > 1 ? () => removeRow(s.key, r.key, true) : undefined}
                      onPasteTable={(t) => pasteTable(s.key, r.key, t)}
                    />
                    <RichCell
                      id={`${r.key}-b`}
                      className="ed-back"
                      value={r.back}
                      label={`${ri + 1}번 카드 내용`}
                      placeholder="내용"
                      onChange={(v) => setRow(s.key, r.key, { back: v })}
                      onEnter={() => addRow(s.key, r.key)}
                      onBackspaceEmpty={() => {
                        focusNext.current = { cell: `${r.key}-f` };
                        setModel((m) => ({ ...m }));
                      }}
                      onPasteTable={(t) => pasteTable(s.key, r.key, t)}
                    />
                    <button type="button" className="icon-btn sm ed-del" onClick={() => removeRow(s.key, r.key, false)} aria-label={`${ri + 1}번 카드 지우기`}>✕</button>
                  </div>
                ))}
              </div>
              <button type="button" className="ed-add" onClick={() => addRow(s.key)}>+ 카드</button>
            </section>
          ))}
          <button type="button" className="btn ghost" onClick={addSection}>+ 묶음 추가</button>
          <p className="meta ed-help">
            Enter로 항목 → 내용 → 다음 카드로 넘어가요. 빈 카드에서 Backspace를 누르면 지워져요. 다른 곳의 표(| 항목 | 내용 |)를 칸에 붙여 넣으면 여러 장이 한꺼번에 들어가요.
          </p>
        </>
      ) : (
        <div className="field">
          <label htmlFor="dk-md">마크다운 원문</label>
          <textarea
            id="dk-md"
            rows={14}
            value={md}
            onChange={(e) => {
              setMd(e.target.value);
              setDirty(true);
            }}
            placeholder={"# 덱 이름\n\n## 순환\n| 항목 | 내용 |\n| --- | --- |\n| **QRS파** | 심실 탈분극 |"}
          />
        </div>
      )}

      <p className="meta" role="status">
        {n ? `${parsed.sections.length}묶음, 카드 ${n}장` : "아직 카드가 없어요. 항목과 내용을 채워 주세요."}
      </p>
      <div className="row ed-actions">
        {armCancel ? (
          <>
            <span className="meta">고친 내용을 버릴까요?</span>
            <button type="button" className="btn ghost" onClick={() => setArmCancel(false)}>계속 고치기</button>
            <button type="button" className="btn ng" onClick={onDone}>버리기</button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={() => (dirty ? setArmCancel(true) : onDone())}>취소</button>
            <button type="button" className="btn primary" disabled={!n} onClick={save}>{initial ? "저장" : "덱 만들기"}</button>
          </>
        )}
      </div>
      {initial?.builtIn && initial.overridden ? (
        <div className="row">
          {armRevert ? (
            <>
              <span className="meta">처음 받은 내용으로 되돌릴까요?</span>
              <button type="button" className="btn ghost" onClick={() => setArmRevert(false)}>취소</button>
              <button type="button" className="btn ng" onClick={() => { store.deleteDeck(initial.id); onDone(); }}>되돌리기</button>
            </>
          ) : (
            <button type="button" className="link-btn" onClick={() => setArmRevert(true)}>원래 내용으로 되돌리기</button>
          )}
        </div>
      ) : null}
    </div>
  );
}
