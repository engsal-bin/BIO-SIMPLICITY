"""앱 데이터(public/data + public/img)를 클라우드 업로드용 묶음 파일 하나로 만든다.

사용법: python3 make_bundle.py <app_public_dir> <out.json>

묶음 구조
  {"format": "bioquiz-content", "version": <만든 시각 ms>,
   "rows": [{"id": "meta", "data": {"books": [...], "rounds": [...]}},
            {"id": "book:<book_id>", "data": {"questions": [...], "images": {"img/..png": "data:image/png;base64,..."}}}]}
앱의 '문항 데이터 올리기'로 이 파일을 고르면 Supabase content 표에 행 단위로 올라간다.
책 단위로 나눠 두어서 나중에 책을 더 넣어도 바뀐 행만 다시 받는다.
"""
import base64
import json
import sys
import time
from pathlib import Path


def main():
    pub, out = Path(sys.argv[1]), Path(sys.argv[2])
    data = json.loads((pub / "data" / "questions.json").read_text())
    rows = [{"id": "meta", "data": {"books": data["books"], "rounds": data["rounds"]}}]
    for b in data["books"]:
        qs = [q for q in data["questions"] if q["book_id"] == b["id"]]
        images = {}
        for q in qs:
            for path in q.get("images", []) + q.get("explanation_images", []):
                if path not in images:
                    raw = (pub / path).read_bytes()
                    images[path] = "data:image/png;base64," + base64.b64encode(raw).decode()
        rows.append({"id": f"book:{b['id']}", "data": {"questions": qs, "images": images}})
    bundle = {"format": "bioquiz-content", "version": int(time.time() * 1000), "rows": rows}
    out.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")))
    for r in rows:
        n = len(json.dumps(r["data"], ensure_ascii=False).encode())
        print(f"{r['id']:<12} {n / 1024:8.0f} KB")
    print(f"→ {out} ({out.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
