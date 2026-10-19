"""stdin의 JSON {id: {...}}을 fixes.json items에 병합 (replace는 이어 붙임)"""
import json, sys
p = '/home/claude/bioquiz/review/fixes.json'
fx = json.load(open(p))
new = json.loads(sys.stdin.read())
for k, v in new.items():
    cur = fx['items'].setdefault(k, {})
    for kk, vv in v.items():
        if kk == 'replace':
            cur.setdefault('replace', []).extend(vv)
        else:
            cur[kk] = vv
json.dump(fx, open(p, 'w'), ensure_ascii=False, indent=1)
print('items', len(fx['items']))
