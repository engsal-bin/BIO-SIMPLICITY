const fs=require("fs");
const src=fs.readFileSync("data_rx.js","utf8")+"\n"+fs.readFileSync("data_bc.js","utf8")+"\n;({ingredientDB,RX_RAW,BC_BIG,BC_GROUPS,BC_ALIAS_READING})";
const D=(0,eval)(src);
const pairs=[];
D.ingredientDB.forEach(i=>pairs.push([i.hanja,i.reading]));
D.RX_RAW.forEach(r=>pairs.push([r[0],r[1]]));
D.BC_BIG.forEach(b=>pairs.push([b[1],b[2]]));
D.BC_GROUPS.forEach(g=>{pairs.push([g[1],g[2]]); g[4].split(" ").forEach(t=>{const [h,r]=t.split(":");pairs.push([h,r]);});});
Object.entries(D.BC_ALIAS_READING).forEach(([h,r])=>pairs.push([h,r]));
const map={};let bad=[];
for(const [h0,r] of pairs){const h=[...h0.normalize("NFC")].filter(c=>c!=="·");const rr=[...r].filter(c=>c!=="·");if(h.length!==rr.length){bad.push(h0);continue;}
 h.forEach((c,i)=>{(map[c]||={});map[c][rr[i]]=(map[c][rr[i]]||0)+1;});}
const cm={};for(const [c,o] of Object.entries(map)){cm[c]=Object.entries(o).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);}
fs.writeFileSync("charmap_derived.json",JSON.stringify(cm));
console.log("pairs",pairs.length,"misaligned",bad.length,bad.slice(0,5).join(" "),"chars",Object.keys(cm).length);
console.log("multi:",Object.entries(cm).filter(([c,v])=>v.length>1).map(([c,v])=>c+"="+v.join("/")).join(" "));
const u=JSON.parse(fs.readFileSync("cr_parsed.json","utf8"));
const chars=new Set();const add=s=>[...s.normalize("NFC")].forEach(c=>{if(/[㐀-鿿豈-﫿]/.test(c))chars.add(c)});
u.forEach(x=>{add(x.name);x.topics.forEach(t=>{add(t.name);t.groups.forEach(g=>{add(g.name);g.items.forEach(add)})})});
const miss=[...chars].filter(c=>!cm[c]);
console.log("cr hanja chars",chars.size,"missing",miss.length);console.log(miss.join(""));
