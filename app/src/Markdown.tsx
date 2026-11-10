import React from "react";

/** 해설·지문용 가벼운 마크다운 렌더러.
    표(|…|), 인용(>), 제목(#), 목록(-, 1.), 구분선(---), **굵게**, ==강조==, *기울임*, `코드`, 그림(![](#img0))을 다룬다.
    그 밖의 줄은 예전처럼 한 줄 = 한 문단으로 보여 준다. */

type Imgs = string[] | undefined;

const INLINE = /(\*\*[^*]+?\*\*|==[^=]+?==|`[^`]+?`|!\[[^\]]*\]\([^)]*\)|(?<![*\w])\*[^*\s][^*]*?\*(?!\*))/g;

function inline(text: string, imgs: Imgs, key = ""): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const s = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${i++}`;
    if (s.startsWith("**")) out.push(<strong key={k}>{inline(s.slice(2, -2), imgs, k)}</strong>);
    else if (s.startsWith("==")) out.push(<mark key={k}>{inline(s.slice(2, -2).replace(/^\s*[🟢🟡🔴🔵🟣🟠⚪⚫]\s*/u, ""), imgs, k)}</mark>);
    else if (s.startsWith("`")) out.push(<code key={k}>{s.slice(1, -1)}</code>);
    else if (s.startsWith("![")) {
      const mm = s.match(/^!\[([^\]]*)\]\(([^)]*)\)$/)!;
      const src = resolveImg(mm[2], imgs);
      out.push(src ? <img key={k} className="md-img" src={src} alt={mm[1] || "그림"} loading="lazy" /> : null);
    } else out.push(<em key={k}>{inline(s.slice(1, -1), imgs, k)}</em>);
    last = at + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function resolveImg(ref: string, imgs: Imgs): string | null {
  const m = ref.match(/^#img(\d+)$/);
  if (m) return imgs?.[+m[1]] || null;
  if (/^(data:|https?:)/.test(ref)) return ref;
  return null;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(l);

function cells(l: string): string[] {
  const t = l.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function Table({ rows, imgs, k }: { rows: string[]; imgs: Imgs; k: string }) {
  const hasHead = rows.length > 1 && isSep(rows[1]);
  const head = hasHead ? cells(rows[0]) : null;
  const aligns = hasHead
    ? cells(rows[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : undefined))
    : [];
  const body = (hasHead ? rows.slice(2) : rows).filter((r) => !isSep(r)).map(cells);
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        {head ? (
          <thead>
            <tr>{head.map((c, i) => <th key={i} style={{ textAlign: aligns[i] as any }}>{inline(c, imgs, `${k}h${i}`)}</th>)}</tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>{r.map((c, i) => <td key={i} style={{ textAlign: aligns[i] as any }}>{inline(c, imgs, `${k}r${ri}c${i}`)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function blocks(text: string, imgs: Imgs, key = "b"): React.ReactNode[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const l = lines[i];
    const k = `${key}${n++}`;
    if (!l.trim()) { i++; continue; }
    if (/^\s*>/.test(l)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      let cls = "md-quote";
      const c = buf[0]?.match(/^\[!(\w+)\]\s*(.*)$/);
      if (c) {
        cls += ` md-callout md-${c[1].toLowerCase()}`;
        buf[0] = c[2] ? `**${c[2]}**` : "";
      }
      out.push(<blockquote key={k} className={cls}>{blocks(buf.join("\n"), imgs, k)}</blockquote>);
      continue;
    }
    if (isTableRow(l)) {
      const buf: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) buf.push(lines[i++]);
      out.push(<Table key={k} rows={buf} imgs={imgs} k={k} />);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(6, h[1].length + 2);
      out.push(React.createElement(`h${lvl}`, { key: k, className: "md-h" }, inline(h[2], imgs, k)));
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push(<hr key={k} className="md-hr" />); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l) && !/^\s*\d+\)\s*_{3,}/.test(l)) {
      const ordered = /^\s*\d+[.)]\s/.test(l);
      const items: { depth: number; text: string; num?: number }[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/)!;
        const num = /^\d/.test(m[2]) ? parseInt(m[2], 10) : undefined;
        items.push({ depth: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)), text: m[3], num });
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={k} className="md-list">
          {items.map((it, j) => <li key={j} value={it.num} className={it.depth ? `d${it.depth}` : undefined}>{inline(it.text, imgs, `${k}-${j}`)}</li>)}
        </Tag>
      );
      continue;
    }
    out.push(<p key={k}>{inline(l, imgs, k)}</p>);
    i++;
  }
  return out;
}

export function Markdown({ text, imgs, className }: { text: string; imgs?: string[]; className?: string }) {
  return <div className={className ? `md ${className}` : "md"}>{blocks(text, imgs)}</div>;
}

/** 본문에 #imgN으로 이미 끼워 넣은 그림 번호 */
export function usedImgs(text: string): Set<number> {
  return new Set([...text.matchAll(/\(#img(\d+)\)/g)].map((m) => +m[1]));
}

/** 마크다운 문법이 들어 있는지(표·인용·목록·굵게 등) */
export function looksMarkdown(text: string): boolean {
  return /^\s*(\|.*\||>|#{1,6}\s|[-*]\s)/m.test(text) || /\*\*[^*]+\*\*|==[^=]+==/.test(text);
}
