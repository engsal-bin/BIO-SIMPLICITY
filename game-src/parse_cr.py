import re, json, sys
def parse(path):
    units=[]; cur=None; topic=None
    for raw in open(path,encoding="utf8"):
        line=raw.rstrip("\n")
        if not line.strip() or (line.startswith("#") and not line.startswith("# ") and not line.startswith("## ")): continue
        if line.startswith("# ") and cur is None: continue
        if line.startswith("@ "):
            no,name=[x.strip() for x in line[2:].split("|",1)]; cur={"no":int(no),"name":name,"topics":[]}; units.append(cur); continue
        if line.startswith("## "):
            head,items=line[3:].split(" : ",1)
            parts=[x.strip() for x in head.split("|",1)]
            g={"name":parts[0],"memo":parts[1] if len(parts)>1 else "","items":[x.strip() for x in items.split(", ") if x.strip()]}
            topic["groups"].append(g); continue
        if line.startswith("# "):
            parts=[x.strip() for x in line[2:].split("|",1)]
            topic={"name":parts[0],"memo":parts[1] if len(parts)>1 else "","groups":[]}; cur["topics"].append(topic); continue
        raise SystemExit("bad line: "+line)
    return units
if __name__=="__main__":
    u=parse("cr_source.txt"); json.dump(u,open("cr_parsed.json","w"),ensure_ascii=False,indent=0)
    nt=sum(len(x["topics"]) for x in u); ng=sum(len(t["groups"]) for x in u for t in x["topics"])
    ni=sum(len(g["items"]) for x in u for t in x["topics"] for g in t["groups"])
    print("units",len(u),"topics",nt,"groups",ng,"memberships",ni)
    for x in u:
        for t in x["topics"]:
            seen=set()
            for g in t["groups"]:
                if len(set(g["items"]))!=len(g["items"]): print("dup in group",t["name"],g["name"])
            names=[g["name"] for g in t["groups"]]
            if len(set(names))!=len(names): print("dup group name",t["name"])
