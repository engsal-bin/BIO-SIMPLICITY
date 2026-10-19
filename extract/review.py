"""문항 자동 검수.

1단계(항상): 코드 규칙 검사 + 허용 답안 자동 생성
2단계(선택): ANTHROPIC_API_KEY가 있으면 Claude가 원본 PDF 페이지 이미지와 대조해
           원문 누락·오탈자·정답 일치를 검사한다.

사용법:
  python3 review.py <build_dir> [--ai] [--pdf b2024=path ...] [--limit N]

결과: questions.json의 각 문항 review 필드를 채우고, review_report.json을 쓴다.
  review.status = passed | auto_fixed | flagged
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

FIGURE_WORDS = re.compile(r"(그림은|그림과|그래프는|그래프와|다음 그림|아래 그림|그림에서|그림 \(|자료는|모식도)")
COMBO_CHOICE = re.compile(r"^[가나다라마ㄱㄴㄷㄹㅁ](\s*,\s*[가나다라마ㄱㄴㄷㄹㅁ])*$")
MERGED_NEXT = re.compile(r"\s\d{1,2}\.\s+\S.{20,}(\?|시오\.)")


def accepted_from(answer_text):
    """'막공격복합체(MAC, membrane attack complex)' → ['막공격복합체', 'MAC', 'membrane attack complex']"""
    out = []
    s = answer_text.strip()
    m = re.match(r"^(.*?)\s*\((.*)\)\s*$", s)
    if m:
        out += [p.strip() for p in m.group(1).split("=")]
        out += [p.strip() for p in re.split(r"[,/]", m.group(2)) if p.strip()]
    else:
        out.append(s)
    return [x for x in dict.fromkeys(out) if x]


def rule_check(q, round_numbers):
    flags, fixes = [], []
    t = q["type"]
    if t == "mcq":
        n = len(q["choices"])
        if n not in (4, 5):
            flags.append(f"선택지 수가 {n}개")
        if not q["answer"] or any(i >= n for i in q["answer"]):
            flags.append(f"정답 번호가 선택지 범위 밖 ({q.get('_answer_raw')})")
        if any(not c.strip() for c in q["choices"]):
            flags.append("빈 선택지")
        if any(len(c) > 220 or MERGED_NEXT.search(c) for c in q["choices"]):
            flags.append("선택지에 다음 문항이 섞였을 수 있음")
        combos = [c for c in q["choices"] if COMBO_CHOICE.match(c.replace(" ", "").replace(",", ", "))]
        if combos and len(combos) >= 3 and not q["images"]:
            used = set(re.findall(r"[가나다라마ㄱㄴㄷㄹㅁ]", " ".join(combos)))
            have = {s["label"] for s in q["statements"]}
            if not used <= have:
                flags.append(f"보기 지문 누락 ({', '.join(sorted(used - have))})")
    elif t == "blank":
        if not q["answer"]:
            flags.append("빈칸 정답 없음")
        elif q["blank_count"] and len(q["answer"]) != q["blank_count"]:
            flags.append(f"빈칸 {q['blank_count']}개 / 정답 {len(q['answer'])}개")
        elif not q.get("_acc_locked"):
            q["accepted_answers"] = [accepted_from(a) for a in q["answer"]]
            fixes.append("허용 답안 생성")
    elif t == "short":
        if not q["answer"]:
            flags.append("정답 없음")
        else:
            q["accepted_answers"] = [accepted_from(a) for a in q["answer"]]
    if not q["stem"] or len(q["stem"]) < 6:
        flags.append("문두가 비었거나 너무 짧음")
    if FIGURE_WORDS.search(q["stem"] + q["passage"]) and not q["images"]:
        flags.append("그림을 언급하지만 그림이 없음")
    if q["number"] > 1 and (q["number"] - 1) not in round_numbers and q["number"] - 1 > 0:
        flags.append(f"앞 번호({q['number'] - 1}번)가 원본에 없음")
    return flags, fixes


AI_PROMPT = """당신은 생물학 문제집 디지털화 검수자입니다. 첨부 이미지는 원본 PDF 페이지이고, JSON은 그 페이지에서 자동 추출한 문항 하나입니다.

다음을 검사하고 JSON 하나만 출력하세요.
1. 원문 대조: 문두·지문·보기(가나다)·선택지에 누락, 잘림, 다른 문항이 섞인 부분, 띄어쓰기 오류가 있는가.
2. 정답 검증: 문제를 직접 풀어 본 답과 추출된 정답(answer, 0부터 시작하는 선택지 번호 또는 단답)이 일치하는가. 해설이 정답과 모순되는가.
3. 해설에 원저자가 문제 자체의 문제점을 언급했다면 note에 적되 오류로 보지 마세요.

출력 형식:
{"verdict": "pass" | "fix" | "flag",
 "fixes": {"stem"?: str, "passage"?: str, "choices"?: [str], "statements"?: [{"label": str, "text": str}]},
 "my_answer": str,
 "issues": [str],
 "note": str}
- 띄어쓰기·오탈자·줄바꿈처럼 확실한 것만 fixes로 고치고 verdict=fix.
- 정답 불일치, 판단이 필요한 누락은 verdict=flag.
"""


def ai_check(q, page_png, model, key):
    body = {
        "model": model,
        "max_tokens": 1500,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(page_png).decode()}},
                {"type": "text", "text": AI_PROMPT + "\n\n추출된 문항:\n" + json.dumps({k: q[k] for k in ("number", "type", "stem", "passage", "statements", "choices", "answer", "explanation")}, ensure_ascii=False)},
            ],
        }],
    }
    base = os.environ.get("ANTHROPIC_API_URL", "https://api.anthropic.com")
    req = urllib.request.Request(base + "/v1/messages", data=json.dumps(body).encode(), headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.loads(r.read())
    text = "".join(c.get("text", "") for c in res["content"])
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {"verdict": "flag", "issues": ["AI 응답 해석 실패"]}


def render_pages(pdf_path, pages):
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(pdf_path)
    out = {}
    for p in pages:
        buf = io.BytesIO()
        doc[p - 1].render(scale=1.6).to_pil().save(buf, "PNG")
        out[p] = buf.getvalue()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build")
    ap.add_argument("--ai", action="store_true")
    ap.add_argument("--pdf", nargs="*", default=[])
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--model", default=os.environ.get("REVIEW_MODEL", "claude-sonnet-5-5"))
    a = ap.parse_args()

    path = Path(a.build) / "data" / "questions.json"
    data = json.loads(path.read_text())
    rounds_nums = defaultdict(set)
    for q in data["questions"]:
        rounds_nums[q["round_id"]].add(q["number"])

    # Claude 검수 결과(review/fixes.json) 적용: 오탈자·띄어쓰기 수정, 정답 정정, 메모
    fx_path = Path(__file__).resolve().parent.parent / "review" / "fixes.json"
    manual = json.loads(fx_path.read_text()) if fx_path.exists() else {"items": {}}
    TEXT_FIELDS = ("stem", "passage", "explanation")
    for q in data["questions"]:
        applied = []
        for pat, rep in manual.get("global_regex", []):
            for f in TEXT_FIELDS:
                new = re.sub(pat, rep, q[f])
                if new != q[f]:
                    q[f] = new
                    applied.append("기호 정리")
            q["choices"] = [re.sub(pat, rep, c) for c in q["choices"]]
        it = manual["items"].get(q["id"], {})
        for old, new in it.get("replace", []):
            hit = False
            for f in TEXT_FIELDS:
                if old in q[f]:
                    q[f] = q[f].replace(old, new); hit = True
            q["choices"] = [c.replace(old, new) if old in c else c for c in q["choices"]]
            for st in q["statements"]:
                if old in st["text"]:
                    st["text"] = st["text"].replace(old, new); hit = True
            if isinstance(q.get("answer"), list) and q["answer"] and isinstance(q["answer"][0], str):
                if any(old in a for a in q["answer"]):
                    q["answer"] = [a.replace(old, new) for a in q["answer"]]
                    hit = True
            hit = hit or any(new in c for c in q["choices"])
            applied.append(f"수정: {old[:20]} → {new[:20]}" if hit else f"적용 안 됨: {old[:20]}")
        for k in ("answer", "choices", "statements", "stem", "passage", "accepted_answers", "source", "type", "explanation"):
            if k in it:
                q[k] = it[k]
                applied.append(f"{k} 정정")
        if "accepted_answers" in it:
            q["_acc_locked"] = True
        q["note"] = it.get("note")
        q["_manual"] = {"applied": applied, "flag": it.get("flag"), "hide": it.get("hide", False)}

    for q in data["questions"]:
        flags, fixes = rule_check(q, rounds_nums[q["round_id"]])
        fixes = q["_manual"]["applied"] + fixes
        if q["_manual"]["flag"]:
            flags.append(q["_manual"]["flag"])
        q["review"] = {"status": "flagged" if flags else ("auto_fixed" if q["_manual"]["applied"] else "passed"),
                       "flags": flags, "auto_fixes": fixes, "stage": "claude" if q["id"] in manual["items"] or q["_manual"]["applied"] else "rules"}
        q.pop("_manual")
        q.pop("_acc_locked", None)

    if a.ai:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            sys.exit("ANTHROPIC_API_KEY가 없어 AI 검수를 건너뜁니다.")
        pdfs = dict(x.split("=", 1) for x in a.pdf)
        todo = [q for q in data["questions"] if q["review"].get("stage") != "ai"]
        if a.limit:
            todo = todo[: a.limit]
        by_book = defaultdict(list)
        for q in todo:
            by_book[q["book_id"]].append(q)
        for bid, qs in by_book.items():
            pages = render_pages(pdfs[bid], sorted({q["page"] for q in qs}))
            for q in qs:
                try:
                    res = ai_check(q, pages[q["page"]], a.model, key)
                except Exception as e:  # 네트워크 오류는 다음 실행 때 다시
                    print("AI 실패", q["id"], e)
                    continue
                fx = res.get("fixes") or {}
                for k, v in fx.items():
                    if k in ("stem", "passage", "choices", "statements") and v:
                        q[k] = v
                        q["review"]["auto_fixes"].append(f"AI 수정: {k}")
                if res.get("verdict") == "flag":
                    q["review"]["flags"] += res.get("issues") or ["AI 플래그"]
                q["review"]["ai"] = {"my_answer": res.get("my_answer"), "note": res.get("note"), "issues": res.get("issues")}
                q["review"]["stage"] = "ai"
                q["review"]["status"] = "flagged" if q["review"]["flags"] else ("auto_fixed" if fx else "passed")
                if fx:
                    q["version"] += 1

    path.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    st = Counter(q["review"]["status"] for q in data["questions"])
    fl = Counter(f.split(" (")[0] for q in data["questions"] for f in q["review"]["flags"])
    report = {"status": dict(st), "flags": dict(fl.most_common()),
              "flagged": [{"id": q["id"], "flags": q["review"]["flags"]} for q in data["questions"] if q["review"]["status"] == "flagged"]}
    (Path(a.build) / "review_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(json.dumps({"status": report["status"], "flags": report["flags"]}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
