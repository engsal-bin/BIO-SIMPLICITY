"""SIMPLICITY Mini PDF -> 문항 JSON 추출기.

사용법: python3 extract.py <out_dir> <book_id>=<pdf_path> [...]
  book_id 예: b2022, b2024, s2025

출력:
  <out_dir>/data/questions.json   책·회차·문항 전체
  <out_dir>/img/<question_id>-<n>.png  문항 그림
  <out_dir>/report.json           추출 통계와 규칙 검사 결과는 validate.py가 만든다
"""
import json
import re
import sys
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as raw

BOOK_META = {
    "b2022": {"title": "BIOLOGY 2022", "year": 2022},
    "b2024": {"title": "BIOLOGY 2024", "year": 2024},
    "s2025": {"title": "SIMPLICITY 2025", "year": 2025},
}

CIRCLED = "①②③④⑤"
HEADER_RE = re.compile(r"^(BIOLOGY|SIMPLICITY) \d{4} ©SIMPLICITY Mini \d+\s*$")
ROUND_RE = re.compile(r"^\s*(\d+)회\s*(정답과 해설|해설)?\s*(\(\s*\))?\s*$")
SCORE_RE = re.compile(r"^_+\s*/\s*\d+\s*$")
QNUM_RE = re.compile(r"^(\d{1,2})\.\s?(.*)$")
ANS_RE = re.compile(r"^(\d{1,2})\.\s*정답\s*[:：]?\s*(.*)$")
STATEMENT_RE = re.compile(r"^(가|나|다|라|마|바|ㄱ|ㄴ|ㄷ|ㄹ|ㅁ)\.\s*(.*)$")
ANSWER_BLANK_RE = re.compile(r"^답안\s*\d*\s*[:：]")
SOURCE_RE = re.compile(r"\((공무원|중앙대[^)]*|편입[^)]*)\)")

# 줄바꿈이 단어 경계일 가능성이 높은 끝 글자(휴리스틱, AI 구조화 단계에서 다시 다듬는다)
WORD_END = set("은는이가을를에의와과로도만고며서다면지한된인할및등요까라께며야죠") | set(",.?!:;)]」』>")


class SpacingModel:
    """줄 안의 띄어쓰기 통계로 줄바꿈 자리에 공백을 넣을지 정한다.
    - 줄 안에서 '가 나'(띄움)와 '가나'(붙임)가 몇 번 나오는지 센다.
    - 이어 붙인 단어가 줄 안에서 실제로 쓰인 단어면 붙인다."""

    def __init__(self):
        self.sp = {}
        self.nsp = {}
        self.words = {}

    def feed(self, text):
        t = text.strip()
        for i in range(len(t) - 1):
            a, b = t[i], t[i + 1]
            if a != " " and b != " ":
                self.nsp[(a, b)] = self.nsp.get((a, b), 0) + 1
            elif b == " " and i + 2 < len(t) and t[i + 2] != " " and a != " ":
                k = (a, t[i + 2])
                self.sp[k] = self.sp.get(k, 0) + 1
        for w in re.findall(r"[가-힣A-Za-z0-9]+", t):
            self.words[w] = self.words.get(w, 0) + 1

    def space(self, left, right):
        a, b = left[-1], right[0]
        if a.isascii() and a.isalnum() and b.isascii() and b.isalnum():
            return True
        if a in ",.?!:;" or b in "(":
            return a in ",.?!:;" or (a not in "(" and self.sp.get((a, b), 0) > self.nsp.get((a, b), 0))
        if a in "(-/" or b in ")-,./":
            return False
        wa = re.findall(r"[가-힣A-Za-z0-9]+$", left)
        wb = re.findall(r"^[가-힣A-Za-z0-9]+", right)
        if wa and wb:
            joined = wa[0] + wb[0]
            # 붙인 형태가 다른 곳에서 한 단어로 쓰였으면 붙인다
            if self.words.get(joined, 0) >= 1 and len(joined) >= 2:
                return False
            # 양쪽이 각각 독립된 단어로 쓰인 적이 있으면 띄운다 ('결합이' + '트랜스')
            if self.words.get(wa[0], 0) >= 2 and self.words.get(wb[0], 0) >= 2:
                return True
        s, n = self.sp.get((a, b), 0), self.nsp.get((a, b), 0)
        if s == n == 0:
            return a in WORD_END
        return s >= n


MODEL = None


def smart_join(lines):
    out = ""
    prev_trailing = False
    for ln in lines:
        s = ln.rstrip("\r\n")
        st = s.strip()
        if not st:
            continue
        if not out:
            out = st
        elif prev_trailing or s[:1] == " ":
            out = out + " " + st
        elif MODEL is not None:
            out += (" " if MODEL.space(out, st) else "") + st
        else:
            out += (" " if out[-1] in WORD_END else "") + st
        prev_trailing = s.endswith(" ")
    return re.sub(r"[ \t]+", " ", out).strip()


def page_lines(doc):
    """모든 페이지를 (page, x, y, text) 줄 목록으로. 머리말·점수칸은 버린다."""
    lines = []
    for pi in range(len(doc)):
        page = doc[pi]
        tp = page.get_textpage()
        n = tp.count_chars()
        cur, box = [], None
        for ci in range(n):
            ch = tp.get_text_range(ci, 1)
            if ch in ("\n", "\r"):
                if ch == "\n":
                    lines.append((pi + 1, box, "".join(cur)))
                    cur, box = [], None
                continue
            if box is None and ch.strip():
                try:
                    box = tp.get_charbox(ci)
                except Exception:
                    box = None
            cur.append(ch)
        if cur:
            lines.append((pi + 1, box, "".join(cur)))
    out = []
    for p, b, t in lines:
        if HEADER_RE.match(t.strip()) or SCORE_RE.match(t.strip()):
            continue
        if t.strip().startswith("=== p"):
            continue
        out.append({"page": p, "box": b, "text": t})
    return out


def split_sections(lines):
    """회차 제목 기준으로 [(kind, round, lines)] 나눔. kind = q | a"""
    sections, cur = [], None
    for ln in lines:
        m = ROUND_RE.match(ln["text"])
        if m:
            kind = "a" if m.group(2) else "q"
            cur = {"kind": kind, "round": int(m.group(1)), "lines": []}
            sections.append(cur)
            continue
        if cur is not None:
            cur["lines"].append(ln)
    return sections


def split_numbered(lines, rx):
    """1, 2, 3 … 순서대로만 자른다(본문 속 '1.'에 속지 않도록)."""
    items, cur, expect = [], None, 1
    for ln in lines:
        m = rx.match(ln["text"].strip())
        # 원본에서 번호가 하나 빠진 경우(2024 6회: 14 → 16)도 받아들인다. 검수에서 플래그한다.
        if m and int(m.group(1)) in (expect, expect + 1) and items is not None:
            num = int(m.group(1))
            if num == expect + 1 and not m.group(2).strip():
                pass
            else:
                cur = {"num": num, "first": m.group(2), "lines": [ln], "page": ln["page"], "box": ln["box"]}
                items.append(cur)
                expect = num + 1
                continue
        if cur is not None:
            cur["lines"].append(ln)
    return items


def parse_question(item):
    texts = [l["text"] for l in item["lines"]]
    texts[0] = item["first"]
    # 선택지 위치
    choice_idx = [i for i, t in enumerate(texts) if t.strip()[:1] in CIRCLED]
    body = texts[: choice_idx[0]] if choice_idx else texts
    choices = []
    if choice_idx:
        cur = None
        for t in texts[choice_idx[0]:]:
            s = t.strip()
            if s[:1] in CIRCLED:
                # 한 줄에 여러 선택지가 있는 경우(① a ② b)
                parts = re.split(r"(?=[①②③④⑤])", s)
                for part in [p for p in parts if p.strip()]:
                    if part[:1] in CIRCLED:
                        cur = [part[1:].strip()]
                        choices.append(cur)
                    elif cur is not None:
                        cur.append(part)
            elif ANSWER_BLANK_RE.match(s):
                continue
            elif cur is not None:
                cur.append(t)
        choices = [smart_join(c) for c in choices]

    # 문두(stem) 끝: '?' 또는 '시오.' 로 끝나는 첫 줄(출처 태그 포함)
    stem_end = 0
    for i, t in enumerate(body):
        s = t.strip()
        joined = smart_join(body[: i + 1])
        if re.search(r"(\?|시오\.?|하라\.?|쓰시오\.?)\s*(\([^)]*\))?\s*$", joined) or re.search(r"(\?|오\.)\s*\(공무\s*$", joined):
            stem_end = i
            # 출처 태그가 다음 줄로 넘어간 경우
            if i + 1 < len(body) and re.match(r"^\s*(원\)|\(공무원\)|\(중앙대[^)]*\))\s*$", body[i + 1]):
                stem_end = i + 1
            break
    else:
        stem_end = 0
    stem = smart_join(body[: stem_end + 1])
    rest = body[stem_end + 1:]

    statements, passage_lines, cur_st = [], [], None
    blanks_lines = []
    for t in rest:
        s = t.strip()
        if ANSWER_BLANK_RE.match(s):
            blanks_lines.append(s)
            continue
        m = STATEMENT_RE.match(s)
        # '있\n다.'처럼 줄 끝에서 넘어온 '다.'는 보기 지문이 아니다: 내용이 비었거나 순서가 안 맞으면 이어 붙인다
        order = "가나다라마바" if (not statements or statements[0]["label"] in "가나다라마바") else "ㄱㄴㄷㄹㅁ"
        expected = order[len(statements)] if len(statements) < len(order) else None
        if m and m.group(2).strip() and m.group(1) == expected:
            cur_st = {"label": m.group(1), "lines": [m.group(2)]}
            statements.append(cur_st)
            continue
        if cur_st is not None:
            cur_st["lines"].append(t)
        else:
            passage_lines.append(t)
    statements = [{"label": st["label"], "text": smart_join(st["lines"])} for st in statements]
    passage = smart_join(passage_lines) if passage_lines else ""

    source = None
    sm = SOURCE_RE.search(stem)
    if sm:
        source = "공무원" if sm.group(1).startswith("공무") else sm.group(1)
        stem = SOURCE_RE.sub("", stem).strip()

    labeled = set(re.findall(r"(\d)\)\s*_{3,}", passage))
    blank_count = len(labeled) or len(re.findall(r"_{3,}", passage)) or len(blanks_lines)
    if choices:
        qtype = "mcq"
    elif blank_count >= 1 and (re.search(r"빈칸|들어갈|채우", stem) or re.search(r"_{3,}", passage)):
        qtype = "blank"
    else:
        qtype = "short"
    return {
        "number": item["num"],
        "type": qtype,
        "stem": stem,
        "passage": passage,
        "statements": statements,
        "choices": choices,
        "blank_count": blank_count if qtype == "blank" else 0,
        "source": source,
        "page": item["page"],
        "box": item["box"],
        "lines_end_page": item["lines"][-1]["page"],
    }


def parse_answer(item):
    texts = [l["text"] for l in item["lines"]]
    head = item["first"].strip()
    body = texts[1:]
    parts = []
    # 2025 빈칸형: '정답:' 다음 줄들이 1) 2) 3)
    if not head:
        while body:
            ln = body[0]
            if re.match(r"^\s*\d\)\s*", ln):
                parts.append(re.sub(r"^\s*\d\)\s*", "", ln).strip())
            elif parts and parts[-1].count("(") > parts[-1].count(")"):
                parts[-1] = smart_join([parts[-1], ln])  # 괄호가 다음 줄로 넘어간 답
            else:
                break
            body = body[1:]
    explanation = smart_join(body)
    body_lines = body
    circled = [CIRCLED.index(c) for c in head if c in CIRCLED]
    return {
        "number": item["num"],
        "raw": head,
        "choice_indexes": circled,
        "parts": parts,
        "explanation": explanation,
        "essay": "주관식 문제" in head,
        "body_lines": body_lines,
    }


def split_top(text):
    """괄호 밖의 쉼표·줄바꿈으로만 나눈다."""
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch in "(（":
            depth += 1
        elif ch in ")）":
            depth = max(depth - 1, 0)
        if depth == 0 and ch in ",，\n":
            if cur.strip():
                out.append(cur.strip())
            cur = ""
            continue
        cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def complete_blank_answer(head, lines, need):
    """정답 줄이 다음 줄로 넘어간 경우 빈칸 수만큼 이어 붙인다. (답, 남은 해설 줄)"""
    text, i = head.strip(), 0
    while i < len(lines) and (len(split_top(text)) < need or text.count("(") > text.count(")")
                              or (len(split_top(text)) == need and lines[i].strip().startswith("("))):
        ln = lines[i].strip()
        text = text + ("\n" if text.endswith(")") else "") + ln
        i += 1
    return split_top(text), lines[i:]


def extract_images(doc, book_id, questions_by_page, img_dir):
    """그림 객체를 같은 페이지·같은 단에서 위쪽으로 가장 가까운 문항(또는 해설)에 붙인다.
    questions_by_page 값의 id가 '...#exp'면 해설 그림이다."""
    attached = {}
    pw0 = doc[0].get_width()
    # 읽는 순서(페이지 → 왼쪽 단 → 오른쪽 단 → 위에서 아래)로 정렬한 문항·해설 시작점
    order = []
    for p, items in questions_by_page.items():
        for q in items:
            if not q.get("box"):
                continue
            ql, qb, qr, qt = q["box"]
            order.append(((p, 0 if ql < pw0 / 2 else 1, -qt), q))
    order.sort(key=lambda x: x[0])
    for pi in range(2, len(doc)):
        page = doc[pi]
        pw = page.get_width()
        objs = list(page.get_objects(filter=[raw.FPDF_PAGEOBJ_IMAGE]))
        if not objs:
            continue
        for oi, obj in enumerate(objs):
            l, b, r, t = obj.get_bounds()
            if (r - l) < 30 or (t - b) < 20:
                continue
            key = (pi + 1, 0 if (l + r) / 2 < pw / 2 else 1, -t)
            before = [q for k, q in order if k <= (key[0], key[1], key[2] + 5)]
            if not before:
                continue
            q = before[-1]
            n = len(attached.setdefault(q["id"], [])) + 1
            name = f"{q['id'].replace('#exp', '-exp')}-{n}.png"
            scale = 2.5
            bitmap = page.render(scale=scale, crop=(max(l - 4, 0), max(b - 4, 0), max(pw - r - 4, 0), max(page.get_height() - t - 4, 0)))
            bitmap.to_pil().save(img_dir / name)
            attached[q["id"]].append(f"img/{name}")
    return attached


def extract_book(book_id, pdf_path, img_dir):
    doc = pdfium.PdfDocument(pdf_path)
    lines = page_lines(doc)
    sections = split_sections(lines)
    q_rounds, a_rounds = {}, {}
    for sec in sections:
        if sec["kind"] == "q":
            q_rounds.setdefault(sec["round"], []).extend(sec["lines"])
        else:
            a_rounds.setdefault(sec["round"], []).extend(sec["lines"])

    rounds, questions = [], []
    by_page = {}
    for rn in sorted(q_rounds):
        qitems = split_numbered(q_rounds[rn], QNUM_RE)
        alist = split_numbered(a_rounds.get(rn, []), ANS_RE)
        # 원본 번호가 건너뛴 경우(문항 16 ↔ 해설 15)가 있어, 개수가 같으면 순서로 짝짓는다
        if len(alist) == len(qitems):
            aitems = {qi["num"]: ai for qi, ai in zip(qitems, alist)}
        else:
            aitems = {a["num"]: a for a in alist}
        rid = f"{book_id}-r{rn:02d}"
        rounds.append({"id": rid, "book_id": book_id, "number": rn, "part": None, "time_limit_sec": 420, "question_count": len(qitems)})
        for pos, it in enumerate(qitems, start=1):
            q = parse_question(it)
            a = parse_answer(aitems[q["number"]]) if q["number"] in aitems else None
            printed = q["number"]
            q["number"] = pos  # 앱에서는 1..N 연속 번호, 원본 번호는 printed_number
            qid = f"{rid}-q{pos:02d}"
            rec = {
                "id": qid,
                "book_id": book_id,
                "round_id": rid,
                "number": q["number"],
                "printed_number": printed,
                "type": q["type"],
                "stem": q["stem"],
                "passage": q["passage"],
                "statements": q["statements"],
                "choices": q["choices"],
                "blank_count": q["blank_count"],
                "answer": None,
                "accepted_answers": [],
                "explanation": a["explanation"] if a else "",
                "source": q["source"],
                "images": [],
                "page": q["page"],
                "version": 1,
                "review": {"status": "pending", "flags": [], "auto_fixes": []},
                "_answer_raw": a["raw"] if a else None,
                "_box": q["box"],
            }
            if a:
                if q["type"] == "mcq":
                    rec["answer"] = a["choice_indexes"]
                elif a["essay"]:
                    rec["type"] = "essay"
                    rec["answer"] = None
                elif q["type"] == "blank":
                    if a["parts"]:
                        ans = a["parts"]
                    else:
                        ans, rest_lines = complete_blank_answer(a["raw"], a["body_lines"], q["blank_count"] or 1)
                        rec["explanation"] = smart_join(rest_lines)
                    if q["blank_count"] and len(ans) > q["blank_count"] and a["parts"]:
                        # 넘친 '1) …' 줄은 해설 본문이다
                        extra = ans[q["blank_count"]:]
                        ans = ans[: q["blank_count"]]
                        rec["explanation"] = smart_join(extra + [rec["explanation"]])
                    rec["answer"] = ans
                else:
                    if a["parts"]:
                        rec["answer"] = a["parts"]
                    else:
                        rec["answer"] = [a["raw"]] if a["raw"] else None
            questions.append(rec)
            by_page.setdefault(rec["page"], []).append({"id": qid, "box": rec["_box"]})
            if q["number"] in aitems:
                ai = aitems[q["number"]]
                by_page.setdefault(ai["page"], []).append({"id": qid + "#exp", "box": ai["box"]})

    imgs = extract_images(doc, book_id, by_page, img_dir)
    for q in questions:
        q["images"] = imgs.get(q["id"], [])
        q["explanation_images"] = imgs.get(q["id"] + "#exp", [])
        q.pop("_box", None)
        if q["source"]:
            q["source"] = re.sub(r"중앙대\s*(\d+)", r"중앙대 \1", q["source"])
    book = {"id": book_id, **BOOK_META.get(book_id, {"title": book_id, "year": None}), "round_count": len(rounds)}
    return book, rounds, questions


def main():
    out = Path(sys.argv[1])
    (out / "data").mkdir(parents=True, exist_ok=True)
    img_dir = out / "img"
    img_dir.mkdir(parents=True, exist_ok=True)
    global MODEL
    MODEL = SpacingModel()
    for arg in sys.argv[2:]:
        for ln in page_lines(pdfium.PdfDocument(arg.split("=", 1)[1])):
            MODEL.feed(ln["text"])
    books, rounds, questions = [], [], []
    for arg in sys.argv[2:]:
        bid, path = arg.split("=", 1)
        b, r, q = extract_book(bid, path, img_dir)
        books.append(b)
        rounds += r
        questions += q
        print(f"{bid}: 회차 {len(r)}, 문항 {len(q)}, 그림 {sum(len(x['images']) for x in q)}")
    (out / "data" / "questions.json").write_text(json.dumps({"books": books, "rounds": rounds, "questions": questions}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
