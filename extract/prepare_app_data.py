"""검수 끝난 questions.json을 앱이 쓰는 가벼운 형태로 복사한다.

사용법: python3 prepare_app_data.py <build_dir> <app_public_dir>
- 검수 상태가 flagged인 문항은 status만 남겨 앱에서 숨긴다.
- 그림은 줄여서(가로 900px 이하, 128색) public/img로 복사한다.
"""
import json
import shutil
import sys
from pathlib import Path

KEEP = ("id", "book_id", "round_id", "number", "printed_number", "type", "stem", "passage", "statements",
        "choices", "answer", "accepted_answers", "explanation", "explanation_images", "source", "images", "version", "note", "topic")


def compress(src: Path, dst: Path, max_w: int = 900):
    from PIL import Image
    im = Image.open(src).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    im.quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(dst, optimize=True)


def main():
    build, pub = Path(sys.argv[1]), Path(sys.argv[2])
    data = json.loads((build / "data" / "questions.json").read_text())
    # 단원: review/topics.json(검수한 것) → 없으면 키워드로 추정
    tpath = Path(__file__).resolve().parent.parent / "review" / "topics.json"
    topics = json.loads(tpath.read_text()) if tpath.exists() else {}
    guessed = 0
    for q in data["questions"]:
        if q["id"] in topics:
            q["topic"] = topics[q["id"]]
        else:
            from topic_classify import classify
            q["topic"] = classify(q)[0]
            guessed += 1
    if guessed:
        print(f"단원을 추정한 문항 {guessed}개: review/topics.json에 확인해서 넣을 것")
    qs = []
    for q in data["questions"]:
        slim = {k: q[k] for k in KEEP if k in q}
        slim["hidden"] = q["review"]["status"] == "flagged"
        qs.append(slim)
    out = {"books": data["books"], "rounds": data["rounds"], "questions": qs}
    (pub / "data").mkdir(parents=True, exist_ok=True)
    (pub / "data" / "questions.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    if (pub / "img").exists():
        shutil.rmtree(pub / "img")
    for src in sorted((build / "img").rglob("*.png")):
        dst = pub / "img" / src.relative_to(build / "img")
        dst.parent.mkdir(parents=True, exist_ok=True)
        compress(src, dst)
    print(f"문항 {len(qs)}개 (숨김 {sum(q['hidden'] for q in qs)}개)")


if __name__ == "__main__":
    main()
