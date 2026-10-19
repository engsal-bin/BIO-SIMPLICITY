"""검수용 요약 출력: python3 dump.py <start> <count>"""
import json, sys
d = json.load(open('/home/claude/bioquiz/build/data/questions.json'))
qs = d['questions'][int(sys.argv[1]):int(sys.argv[1]) + int(sys.argv[2])]
C = "①②③④⑤"
for q in qs:
    out = [f"## {q['id']} [{q['type']}]{' IMG' if q['images'] else ''}", f"Q: {q['stem']}"]
    if q['passage']: out.append(f"P: {q['passage']}")
    for s in q['statements']: out.append(f"  {s['label']}. {s['text']}")
    for i, c in enumerate(q['choices']): out.append(f"  {C[i]} {c}")
    a = q['answer']
    out.append("A: " + (", ".join(C[i] for i in a) if q['type'] == 'mcq' and a else str(a)))
    out.append(f"E: {q['explanation'][:150]}")
    print("\n".join(out))
