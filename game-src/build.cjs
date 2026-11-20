// 한 소스에서 세 가지를 만든다:
//  out/game_data.json        — Supabase hanui_content 'game' 행에 넣을 데이터
//  out/hanui/game.html, game.js — 앱(BIO-SIMPLICITY/hanui)에 넣을 코드 (데이터 없음)
//  out/shanghan113_game.html — 데이터까지 들어간 혼자 쓰는 파일
const fs = require("fs");
const path = require("path");
const { reading } = require("./readings.cjs");
const { execSync } = require("child_process");

execSync("python3 parse_cr.py", { stdio: "inherit" });
const src = fs.readFileSync("data_rx.js", "utf8") + "\n" + fs.readFileSync("data_bc.js", "utf8") +
    "\n;({ingredientDB,RX_RAW,BC_BIG,BC_GROUPS,BC_ALIASES,BC_ALIAS_READING,RX_TO_BC,RX_TO_BC_NOTE})";
const D = (0, eval)(src);
const N = s => String(s).normalize("NFC");

// 이미 확인된 독음 (본초 약물·異名, 상한론 약재·처방)
const KNOWN = {};
const KNOWN_KEYS = {};
D.BC_GROUPS.forEach(g => g[4].split(" ").forEach(t => { const [h, r] = t.split(":"); KNOWN[N(h)] = r; }));
Object.entries(D.BC_ALIAS_READING).forEach(([h, r]) => { KNOWN[N(h)] = KNOWN[N(h)] || r; });
Object.entries(D.BC_ALIASES).forEach(([h, al]) => { KNOWN_KEYS[N(h)] = al.map(N); al.forEach(a => { (KNOWN_KEYS[N(a)] ||= []).push(N(h)); }); });
D.ingredientDB.forEach(i => { KNOWN[N(i.hanja)] = KNOWN[N(i.hanja)] || i.reading; });
D.RX_RAW.forEach(r => { KNOWN[N(r[0])] = KNOWN[N(r[0])] || r[1]; if (r[4]) KNOWN_KEYS[N(r[0])] = [N(r[4])]; });

// 총론 항목 이름 → 본초 분류 약물 (이름이 다른 것만)
const CR_TO_BC = {
    "藿香": ["廣藿香"], "地龍": ["蚯蚓"], "川烏": ["川烏頭"], "烏頭": ["川烏頭"], "蘇葉": ["紫蘇葉"], "薄荷葉": ["薄荷"],
    "神曲": ["神麯"], "皂角": ["皂莢"], "扁豆": ["白扁豆"], "牽牛": ["牽牛子"], "鉤藤": ["釣鉤藤"], "杭菊": ["菊花"],
    "茜草": ["茜草根"], "貝母": ["川貝母", "浙貝母"], "芍藥": ["白芍藥", "赤芍藥"], "地黃": ["熟地黃", "鮮地黃"], "炙甘草": ["甘草"]
};

const units = JSON.parse(fs.readFileSync("cr_parsed.json", "utf8"));
const terms = {};
const termInfo = t => {
    t = N(t);
    if (terms[t]) return;
    const known = KNOWN[t];
    const r = known || reading(t);
    const k = new Set([r, reading(t, true)]);
    (KNOWN_KEYS[t] || []).forEach(a => { k.add(a); if (KNOWN[a]) k.add(KNOWN[a]); });
    (CR_TO_BC[t] || []).forEach(a => { k.add(a); if (KNOWN[a]) k.add(KNOWN[a]); });
    if (r.includes("?")) throw new Error("독음 없음: " + t);
    k.delete(r === t ? "" : "__");
    terms[t] = { r, k: [...k].filter(x => x && x !== t) };
};
const CR = { units: units.map(u => ({ no: u.no, name: u.name })), topics: [], terms, toBc: CR_TO_BC };
units.forEach(u => u.topics.forEach(t => {
    CR.topics.push({
        unit: u.no, name: N(t.name), reading: reading(t.name), memo: t.memo,
        groups: t.groups.map(g => ({ name: N(g.name), reading: KNOWN[N(g.name)] || reading(g.name), memo: g.memo, items: g.items.map(N) }))
    });
    t.groups.forEach(g => g.items.forEach(termInfo));
}));

// 덩달이(암기 문장): dd_rx.txt(처방), dd_bc.txt(본초 분류). 없으면 건너뜀
const DD = { rx: {}, bc: {} };
const ddLines = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")) : [];
const rxNames = new Set(D.RX_RAW.map(r => N(r[0])));
ddLines("dd_rx.txt").forEach(l => {
    const i = l.indexOf("|"), name = N(l.slice(0, i).trim()), t = l.slice(i + 1).trim();
    if (!rxNames.has(name)) throw new Error("덩달이: 상한론에 없는 처방 " + name);
    DD.rx[name] = t;
});
const ddWarn = [];
ddLines("dd_bc.txt").forEach(l => {
    const [code, t, list] = l.split("|").map(x => x.trim());
    const g = D.BC_GROUPS.find(x => String(x[0]) === code);
    if (!g) throw new Error("덩달이: 없는 본초 분류 " + code);
    const byR = {};
    g[4].split(" ").forEach(x => { const [h, r] = x.split(":"); byR[r] = N(h); });
    const order = (list || "").split(/\s+/).filter(Boolean).map(r => byR[r] || "?" + r);
    const miss = Object.values(byR).filter(h => !order.includes(h));
    order.filter(x => x[0] === "?").forEach(x => ddWarn.push(`${code} ${g[1]}: '${x.slice(1)}'는 이 분류에 없음`));
    miss.forEach(h => ddWarn.push(`${code} ${g[1]}: ${h}가 덩달이 목록에 없음`));
    DD.bc[code] = { t, h: order };
});
if (ddWarn.length) console.log("덩달이 확인:\n  " + ddWarn.join("\n  "));

const GAME_DATA = { v: 1, ...D, CR, DD };
const out = "out";
fs.mkdirSync(path.join(out, "hanui"), { recursive: true });
const json = JSON.stringify(GAME_DATA);
fs.writeFileSync(path.join(out, "game_data.json"), json);

const tpl = fs.readFileSync("template.html", "utf8");
const gameJs = fs.readFileSync("game.js", "utf8");
const loader = `<script>
/* 앱(index.html) 안에서 열리면: 앱에게 데이터와 기록을 받은 뒤 game.js를 불러온다. */
(function () {
  if (window.GAME_DATA) return;
  if (window.parent === window) {
    document.body.innerHTML = '<div class="standby">한의학 문제은행 앱의 <b>탕전 게임</b> 메뉴에서 열어 주세요.</div>';
    return;
  }
  window.addEventListener("message", function onMsg(e) {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    var m = e.data || {};
    if (m.type !== "hanui-game:init") return;
    window.removeEventListener("message", onMsg);
    window.GAME_DATA = m.data;
    window.GAME_HOST = { state: m.state || {}, theme: m.theme || "", post: function (x) { window.parent.postMessage(x, location.origin); } };
    var s = document.createElement("script");
    s.src = "game.js?v=" + (m.ver || "");
    document.body.appendChild(s);
  });
  window.parent.postMessage({ type: "hanui-game:ready" }, location.origin);
})();
</script>`;
fs.writeFileSync(path.join(out, "hanui", "game.html"), tpl.replace("<!--SCRIPTS-->", loader));
fs.writeFileSync(path.join(out, "hanui", "game.js"), gameJs);
const standalone = tpl.replace("<!--SCRIPTS-->",
    `<script>window.GAME_DATA = ${json.replace(/</g, "\\u003c")};</script>\n<script>\n${gameJs}\n</script>`);
fs.writeFileSync(path.join(out, "shanghan113_game.html"), standalone);

const nA = CR.topics.reduce((s, t) => s + t.groups.length, 0);
const nB = CR.topics.reduce((s, t) => s + new Set(t.groups.flatMap(g => g.items)).size, 0);
console.log(`덩달이: 처방 ${Object.keys(DD.rx).length} · 본초 분류 ${Object.keys(DD.bc).length}`);
console.log(`총론: 단원 ${CR.units.length} · 주제 ${CR.topics.length} · A ${nA} · B ${nB} · 항목 ${Object.keys(terms).length}`);
console.log(`game_data.json ${json.length} bytes · standalone ${standalone.length} bytes`);
