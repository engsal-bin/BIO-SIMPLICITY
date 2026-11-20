const fs=require("fs");
const derived=require("./charmap_derived.json");
const manual={};fs.readFileSync("charmap_manual.txt","utf8").split(/\s+/).filter(Boolean).forEach(t=>{const c=[...t][0];manual[c.normalize("NFC")]=[...t].slice(1).join("");});
const BON={};for(const [c,v] of Object.entries(derived)) BON[c]=v[0];
Object.assign(BON,manual);
const isHan=c=>/[㐀-鿿豈-﫿]/.test(c);
const JUNG_Y=[2,3,6,7,12,17,20]; // ㅑ ㅒ ㅕ ㅖ ㅛ ㅠ ㅣ
function dueum(s){const code=s.charCodeAt(0)-0xAC00;if(code<0||code>11171)return s;let cho=Math.floor(code/588),jung=Math.floor(code%588/28),jong=code%28;
 if(cho===5){cho=JUNG_Y.includes(jung)?11:2;} else if(cho===2&&JUNG_Y.includes(jung)){cho=11;} else return s;
 return String.fromCharCode(0xAC00+cho*588+jung*28+jong);}
const OVERRIDE={"相殺":"상쇄","茶調":"다조"};
function reading(term,all){
  term=term.normalize("NFC");let out="",run=[];
  const flush=()=>{if(!run.length)return;let s=run.map(c=>BON[c]||"?").join("");
    for(const [k,v] of Object.entries(OVERRIDE)){const i=run.join("").indexOf(k);if(i>=0)s=s.slice(0,i)+v+s.slice(i+v.length);}
    const arr=[...s];const starts=all?arr.map((_,i)=>i):(run.length===4?[0,2]:[0]);starts.forEach(i=>{if(arr[i])arr[i]=dueum(arr[i]);});
    out+=arr.join("");run=[];};
  for(const c of term){if(isHan(c))run.push(c);else{flush();out+=c;}}
  flush();return out;}
module.exports={reading,BON};
if(require.main===module){
  const u=JSON.parse(fs.readFileSync("cr_parsed.json","utf8"));
  const miss=new Set();
  const chk=s=>[...s.normalize("NFC")].forEach(c=>{if(isHan(c)&&!BON[c])miss.add(c)});
  u.forEach(x=>{chk(x.name);x.topics.forEach(t=>{chk(t.name);t.groups.forEach(g=>{chk(g.name);g.items.forEach(chk)})})});
  console.log("still missing:",[...miss].join(""));
  ["利水滲濕","淸熱凉血","黃連","凉血","相殺","生薑 殺 半夏","理氣法","肉胝䐢","六陳藥","鹿茸","川芎茶調散","人蔘 惡 萊菔子","其在皮者 汗而發之","令人癃","綠豆","硫黃","爐甘石","謹察陰陽所在而調之 以平爲期","燎去毛","冷"].forEach(w=>console.log(w,"→",reading(w),"|",reading(w,true)));
}
