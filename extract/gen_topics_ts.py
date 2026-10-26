"""review/topics.json(문항 id → 단원)을 앱이 쓰는 app/src/topics.ts로 바꾼다.

사용법: python3 gen_topics_ts.py review/topics.json app/public/data/questions.json app/src/topics.ts
단원 이름·순서는 TOPICS에서 정한다. 회차마다 문항 순서대로 한 글자(A, B, …)로 적는다.
"""
import json
import sys

TOPICS = [
    ("생명의 화학·생체분자·효소", "생체분자"),
    ("세포 구조·막 수송·조직", "세포 구조"),
    ("에너지 대사(세포호흡·광합성)", "에너지 대사"),
    ("세포 신호전달·세포 죽음", "신호전달"),
    ("세포주기·분열·암", "세포주기·암"),
    ("유전(멘델·염색체·유전병)", "유전"),
    ("분자생물학(복제·발현)", "분자생물학"),
    ("생명공학·실험기법", "생명공학"),
    ("진화·계통·분류", "진화"),
    ("생물 다양성(미생물·동물)", "다양성"),
    ("식물 구조·생리·생식", "식물"),
    ("소화·순환·호흡·배설", "소화·순환·호흡"),
    ("신경·근육·감각·행동", "신경·감각"),
    ("내분비·항상성", "내분비"),
    ("면역", "면역"),
    ("생식·발생", "생식·발생"),
    ("생태", "생태"),
]


def main():
    tmap = json.load(open(sys.argv[1]))
    data = json.load(open(sys.argv[2]))
    idx = {name: chr(65 + i) for i, (name, _) in enumerate(TOPICS)}
    rounds = {}
    for q in sorted(data["questions"], key=lambda q: (q["round_id"], q["number"])):
        rounds.setdefault(q["round_id"], []).append(idx.get(tmap.get(q["id"], ""), "."))
    lines = [
        "// 자동 생성: extract/gen_topics_ts.py. 직접 고치지 말고 review/topics.json을 고친 뒤 다시 만든다.",
        "// 문항 내용은 없고 '문항 번호 → 단원'만 있다.",
        "export const TOPICS: { name: string; short: string }[] = [",
    ]
    lines += [f'  {{ name: "{n}", short: "{s}" }},' for n, s in TOPICS]
    lines += ["];", "", "/** 회차 id → 문항 순서대로 단원 글자(A=TOPICS[0], '.'=미분류) */", "export const TOPIC_CODES: Record<string, string> = {"]
    lines += [f'  "{r}": "{"".join(c)}",' for r, c in rounds.items()]
    lines += ["};", ""]
    open(sys.argv[3], "w").write("\n".join(lines))
    print(sum(len(c) for c in rounds.values()), "문항,", sum(c.count(".") for c in rounds.values()), "미분류")


if __name__ == "__main__":
    main()
