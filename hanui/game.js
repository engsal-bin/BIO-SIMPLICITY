/* 탕전 학습 게임 — 상한론 113 · 본초 분류 · 본초 총론·치법
   데이터는 window.GAME_DATA, 앱 안에서 열리면 window.GAME_HOST(기록 저장·테마)를 쓴다. */

// =====================================================================
//  공통 유틸
// =====================================================================
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function choseong(str) {
    return [...String(str)].map(c => {
        const code = c.charCodeAt(0) - 0xAC00;
        return (code >= 0 && code < 11172) ? CHO[Math.floor(code / 588)] : c;
    }).join("");
}
// 한글 자판 한자 변환으로 입력한 '호환용 한자'(예: 連 U+F99A)도 표준 한자로 맞춰 비교
const nfc = s => String(s == null ? "" : s).normalize("NFC");
const norm = s => nfc(s).trim().toLowerCase().replace(/\s+/g, "");
const $ = id => document.getElementById(id);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
const uniq = a => [...new Set(a)];

const HOST = window.GAME_HOST || null;
if (HOST) document.body.classList.add("hosted");
function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
}
if (HOST) applyTheme(HOST.theme);

const GD = window.GAME_DATA;
if (!GD || !GD.RX_RAW) {
    document.body.innerHTML = '<div class="standby">게임 데이터를 아직 받지 못했어요.<br>' +
        (HOST ? "앱의 '기록 → 계정·데이터'에서 게임 데이터 묶음 파일을 올렸는지 확인해 주세요." : "한의학 문제은행 앱에서 열어 주세요.") + "</div>";
    throw new Error("GAME_DATA 없음");
}
const { ingredientDB, RX_RAW, BC_BIG, BC_GROUPS, BC_ALIASES, BC_ALIAS_READING, RX_TO_BC, RX_TO_BC_NOTE } = GD;
const CR = GD.CR || { units: [], topics: [], terms: {}, toBc: {} };

// =====================================================================
//  상한론 113 데이터 가공
// =====================================================================
// 자주 나오는 약재 조합 (검색해서 한 번에 넣기). 문제 처방과 구성이 같으면 그 문제 동안 숨김
const COMBOS = [
    { id: "gyeji",  name: "계지탕 조합",     abbr: "대생감작계",
      ings: ["大棗", "生薑", "甘草", "芍藥", "桂枝"],
      keys: ["계지탕", "桂枝湯", "계지탕조합", "대생감작계", "조합"] },
    { id: "sosiho", name: "소시호탕 조합",   abbr: "시반황대감인생",
      ings: ["柴胡", "半夏", "黃芩", "大棗", "甘草", "人蔘", "生薑"],
      keys: ["소시호탕", "小柴胡湯", "소시호탕조합", "시반황대감인생", "시호가반한황금대감인생", "조합"] },
    { id: "banha",  name: "반하사심탕 조합", abbr: "황반대감인건련",
      ings: ["黃芩", "半夏", "大棗", "甘草", "人蔘", "乾薑", "黃連"],
      keys: ["반하사심탕", "半夏瀉心湯", "반하사심탕조합", "황반대감인건련", "조합"] }
];

ingredientDB.forEach(i => {
    i.cho = choseong(i.reading);
    i.keys = [norm(i.hanja), i.reading];
    i.chos = [i.cho];
});
ingredientDB.sort((a, b) => a.reading.localeCompare(b.reading, "ko"));
const READING = Object.fromEntries(ingredientDB.map(i => [i.hanja, i.reading]));

const prescriptions = RX_RAW.map(([name, reading, ings, memo, alias], idx) => ({
    mode: "rx", no: idx + 1, name, label: name, reading, ings: ings.split(/\s+/), memo: memo || "", alias: alias || "",
    cho: choseong(reading), chapter: 0
}));
prescriptions.forEach(p => { p.keys = [norm(p.name), p.reading, norm(p.alias)].filter(Boolean); p.chos = [p.cho]; });
const RX_BY_NAME = Object.fromEntries(prescriptions.map(p => [p.name, p]));
const RX_BY_ALIAS = {};
prescriptions.forEach(p => { if (p.alias) RX_BY_ALIAS[nfc(p.alias)] = p; });

const compKey = p => [...p.ings].sort().join("|");
const compGroups = {};
prescriptions.forEach(p => { (compGroups[compKey(p)] ||= []).push(p.name); });

const ING_FREQ = {};
prescriptions.forEach(p => p.ings.forEach(h => { ING_FREQ[h] = (ING_FREQ[h] || 0) + 1; }));
const ING_BY_FREQ = [...ingredientDB].sort((a, b) =>
    (ING_FREQ[b.hanja] || 0) - (ING_FREQ[a.hanja] || 0) || a.reading.localeCompare(b.reading, "ko"));
COMBOS.forEach(c => {
    c.key = [...c.ings].sort().join("|");
    c.freq = prescriptions.filter(p => c.ings.every(h => p.ings.includes(h))).length;
    c.search = [...c.keys, c.abbr].map(norm);
    c.searchCho = c.search.map(choseong);
});
const COMBOS_BY_FREQ = [...COMBOS].sort((a, b) => b.freq - a.freq);

// =====================================================================
//  본초 분류 데이터 가공
// =====================================================================
const BC_TYPO = new Set(["茯笭", "猪笭", "土茯笭", "淫陽藿", "大服皮"]);   // 원문 표기: 검색만 되고 표시는 안 함
const BIG = BC_BIG.map(([no, name, reading, desc]) => ({ no, name: nfc(name), reading, desc, groups: [] }));
const BIG_BY_NO = Object.fromEntries(BIG.map(b => [b.no, b]));
const HERB = {};
const ALIAS_TO_HERB = {};
const BC_HERBS = [];

const bcGroups = BC_GROUPS.map(([code, name, reading, desc, list], idx) => {
    const chapter = Number(code.split(".")[0]);
    const big = BIG_BY_NO[chapter];
    const g = {
        mode: "bcA", no: idx + 1, code, name: nfc(name), label: nfc(name), reading, desc, memo: desc, big, chapter,
        alias: "", cho: choseong(reading), ings: []
    };
    list.split(/\s+/).forEach(tok => {
        const [raw, r] = tok.split(":");
        const h = nfc(raw);
        const aliases = (BC_ALIASES[h] || []).map(nfc);
        const aliasReadings = aliases.map(a => BC_ALIAS_READING[a] || "");
        const herb = {
            hanja: h, reading: r, aliases, group: g,
            showAliases: aliases.filter(a => !BC_TYPO.has(a)),
            cho: choseong(r)
        };
        herb.keys = [norm(h), r, ...aliases.map(norm), ...aliasReadings].filter(Boolean);
        herb.chos = [herb.cho, ...aliasReadings.filter(Boolean).map(choseong)];
        BC_HERBS.push(herb);
        HERB[h] = herb;
        aliases.forEach(a => { ALIAS_TO_HERB[a] = herb; });
        g.ings.push(h);
    });
    g.keys = [norm(g.name), g.reading, g.code, norm(big.name), big.reading];
    g.chos = [g.cho, choseong(big.reading)];
    big.groups.push(g);
    return g;
});
const BCG_BY_CODE = Object.fromEntries(bcGroups.map(g => [g.code, g]));
const BC_HERBS_KOR = [...BC_HERBS].sort((a, b) => a.reading.localeCompare(b.reading, "ko"));
const bcItemsB = BC_HERBS.map((h, i) => ({
    mode: "bcB", no: i + 1, name: h.hanja, label: h.hanja, reading: h.reading, alias: h.showAliases.join("·"),
    herb: h, group: h.group, answer: h.group.code, chapter: h.group.chapter,
    cho: h.cho, keys: [...h.keys, norm(h.group.name), h.group.reading], chos: h.chos
}));

// =====================================================================
//  본초 총론·치법 데이터 가공
// =====================================================================
const UNITS = CR.units.map(u => ({ no: u.no, name: u.name, reading: u.name, topics: [] }));
const UNIT_BY_NO = Object.fromEntries(UNITS.map(u => [u.no, u]));
const CR_TERM = {};             // 항목 → {hanja, reading, keys, chos}
function crTerm(t) {
    t = nfc(t);
    if (CR_TERM[t]) return CR_TERM[t];
    const info = CR.terms[t] || { r: "", k: [] };
    const o = { hanja: t, reading: info.r || "", cho: choseong(info.r || ""), kw: !/^[㐀-鿿豈-﫿]+$/.test(t) };
    const strip = k => k.replace(/[^\p{L}\p{N}]/gu, "");
    const base = [norm(t), norm(info.r || ""), ...(info.k || []).map(norm)];
    o.keys = uniq([...base, ...base.map(strip)]).filter(Boolean);
    o.chos = uniq(o.keys.map(choseong));
    o.showAliases = [];
    CR_TERM[t] = o;
    return o;
}
const crTopics = CR.topics.map((tp, ti) => {
    const unit = UNIT_BY_NO[tp.unit];
    const t = { idx: ti, unit, chapter: tp.unit, name: nfc(tp.name), reading: tp.reading || "", memo: tp.memo || "", groups: [] };
    tp.groups.forEach((g, gi) => {
        t.groups.push({ idx: gi, name: nfc(g.name), reading: g.reading || "", memo: g.memo || "", items: g.items.map(nfc) });
    });
    t.groups.forEach(g => g.items.forEach(crTerm));
    unit.topics.push(t);
    return t;
});
let crANo = 0, crBNo = 0;
const crItemsA = [], crItemsB = [];
crTopics.forEach(t => {
    t.groups.forEach(g => {
        crItemsA.push({
            mode: "crA", no: ++crANo, name: `${t.name} › ${g.name}`, label: g.name, topic: t, group: g, reading: g.reading,
            ings: g.items, memo: g.memo, chapter: t.chapter, alias: "", cho: choseong(g.reading),
            keys: [norm(g.name), g.reading, norm(t.name), t.reading].filter(Boolean),
            chos: [choseong(g.reading), choseong(t.reading)]
        });
    });
    const terms = uniq(t.groups.flatMap(g => g.items));
    terms.forEach(term => {
        const info = crTerm(term);
        crItemsB.push({
            mode: "crB", no: ++crBNo, name: `${t.name} › ${term}`, label: term, topic: t, term, reading: info.reading,
            answers: t.groups.filter(g => g.items.includes(term)).map(g => g.idx),
            chapter: t.chapter, alias: "", cho: info.cho,
            keys: [...info.keys, norm(t.name), t.reading].filter(Boolean), chos: [...info.chos, choseong(t.reading)]
        });
    });
});
const CR_A_BY_TG = {};
crItemsA.forEach(it => { CR_A_BY_TG[it.topic.idx + "/" + it.group.idx] = it; });
const CR_UNIT_SHELF = {};       // 단원 → 그 단원의 모든 항목 (가나다순)
UNITS.forEach(u => {
    const terms = uniq(u.topics.flatMap(t => t.groups.flatMap(g => g.items))).map(crTerm);
    CR_UNIT_SHELF[u.no] = terms.sort((a, b) => (a.reading || a.hanja).localeCompare(b.reading || b.hanja, "ko"));
});

// =====================================================================
//  과목 사이 연결 (상한론 ↔ 본초 ↔ 총론)
// =====================================================================
function bcLinksFor(word) {
    const h = nfc(word);
    if (RX_TO_BC[h]) return RX_TO_BC[h].map(x => HERB[nfc(x)]).filter(Boolean);
    if (CR.toBc && CR.toBc[h]) return CR.toBc[h].map(x => HERB[nfc(x)]).filter(Boolean);
    if (HERB[h]) return [HERB[h]];
    if (ALIAS_TO_HERB[h]) return [ALIAS_TO_HERB[h]];
    return [];
}
const HERB_TO_RX = {};
prescriptions.forEach(p => p.ings.forEach(h => bcLinksFor(h).forEach(herb => {
    const arr = HERB_TO_RX[herb.hanja] ||= [];
    if (!arr.some(x => x.rx === p.name)) arr.push({ rx: p.name, as: h });
})));
function rxFor(word) { const w = nfc(word); return RX_BY_NAME[w] || RX_BY_ALIAS[w] || null; }
function bcTagText(word) {
    const links = bcLinksFor(word);
    if (!links.length) return "";
    return links.map(herb => (herb.hanja !== nfc(word) ? herb.hanja + " " : "") + herb.group.name).join(" / ") +
        (RX_TO_BC_NOTE[word] ? ` (${RX_TO_BC_NOTE[word]})` : "");
}
function bcTagHtml(word) {
    const links = bcLinksFor(word);
    if (links.length) {
        const txt = links.map(herb => (herb.hanja !== nfc(word) ? herb.hanja + " " : "") + herb.group.name).join(" / ");
        return ` <span class="cls" title="본초 분류${RX_TO_BC_NOTE[word] ? " · " + esc(RX_TO_BC_NOTE[word]) : ""}">${esc(txt)}</span>`;
    }
    const rx = rxFor(word);
    if (rx) return ` <span class="cls" title="상한론 113">상한론 ${rx.no}</span>`;
    return "";
}

// =====================================================================
//  과목 · 모드
// =====================================================================
const SUBJECTS = {
    rx: { id: "rx", title: "🌿 상한론 113처방 탕전 학습 게임", gameTab: "🎯 탕전 게임" },
    bc: { id: "bc", title: "📗 본초 분류 학습 게임", gameTab: "🎯 본초 게임", A: "bcA", B: "bcB", mix: "bcMix",
          chapters: BIG, chapterWord: "대분류", labelA: "📦 A 분류→약물", labelB: "🔎 B 약물→분류", settingsKey: "boncho_settings_v1" },
    cr: { id: "cr", title: "📘 본초 총론·치법 학습 게임", gameTab: "🎯 총론 게임", A: "crA", B: "crB", mix: "crMix",
          chapters: UNITS, chapterWord: "단원", labelA: "📦 A 묶음→항목", labelB: "🔎 B 항목→묶음", settingsKey: "cr_settings_v1" }
};
const MODES = {
    rx:    { id: "rx",    subject: "rx", kind: "pot",    items: prescriptions, unit: "처방", storeKey: "shanghan113_state_v2" },
    bcA:   { id: "bcA",   subject: "bc", kind: "pot",    items: bcGroups,      unit: "분류", storeKey: "boncho_A_v1" },
    bcB:   { id: "bcB",   subject: "bc", kind: "choice", items: bcItemsB,      unit: "약물", storeKey: "boncho_B_v1" },
    bcMix: { id: "bcMix", subject: "bc", kind: "mix",    items: [],            unit: "문제" },
    crA:   { id: "crA",   subject: "cr", kind: "pot",    items: crItemsA,      unit: "묶음", storeKey: "cr_A_v1" },
    crB:   { id: "crB",   subject: "cr", kind: "choice", items: crItemsB,      unit: "항목", storeKey: "cr_B_v1" },
    crMix: { id: "crMix", subject: "cr", kind: "mix",    items: [],            unit: "문제" }
};
Object.values(MODES).forEach(m => { m.byName = Object.fromEntries(m.items.map(i => [i.name, i])); });
const RECORD_MODES = ["rx", "bcA", "bcB", "crA", "crB"];
const subjOf = m => MODES[m].subject;
const isMixMode = m => MODES[m].kind === "mix";
const recModes = m => isMixMode(m) ? [SUBJECTS[subjOf(m)].A, SUBJECTS[subjOf(m)].B] : [m];
const recMode = m => recModes(m)[0];

// ---------- 데이터 검증 ----------
function validateData() {
    const problems = [];
    if (prescriptions.length !== 113) problems.push(`처방 수가 ${prescriptions.length}개입니다 (113개여야 함).`);
    const seen = new Set();
    prescriptions.forEach(p => {
        if (seen.has(p.name)) problems.push(`중복 처방명: ${p.name}`);
        seen.add(p.name);
        const s = new Set();
        p.ings.forEach(h => {
            if (!READING[h]) problems.push(`${p.name}: 약재 선반에 없는 '${h}' (정답 불가)`);
            if (s.has(h)) problems.push(`${p.name}: '${h}' 중복 기재`);
            s.add(h);
        });
    });
    COMBOS.forEach(c => c.ings.forEach(h => { if (!READING[h]) problems.push(`${c.name}: 약재 선반에 없는 '${h}'`); }));
    if (BC_HERBS.length !== new Set(BC_HERBS.map(h => h.hanja)).size) problems.push("본초: 중복 약물이 있습니다.");
    if (bcGroups.length !== 42) problems.push(`본초 분류 수가 ${bcGroups.length}개입니다 (42개여야 함).`);
    Object.keys(BC_ALIASES).forEach(k => { if (!HERB[nfc(k)]) problems.push(`본초 異名: '${k}' 약물이 없습니다.`); });
    Object.values(RX_TO_BC).flat().forEach(k => { if (!HERB[nfc(k)]) problems.push(`상한론 연결: '${k}' 약물이 없습니다.`); });
    Object.values(CR.toBc || {}).flat().forEach(k => { if (!HERB[nfc(k)]) problems.push(`총론 연결: '${k}' 약물이 없습니다.`); });
    ["crA", "crB"].forEach(m => {
        if (MODES[m].items.length !== Object.keys(MODES[m].byName).length) problems.push(`총론 ${m}: 같은 이름의 문제가 있습니다.`);
    });
    crItemsB.forEach(it => { if (!it.reading) problems.push(`총론: '${it.term}' 독음이 없습니다.`); });
    if (problems.length) {
        console.error(problems);
        const el = $("dataWarning");
        el.style.display = "block";
        el.innerHTML = "⚠️ 데이터 오류<br>" + problems.map(esc).join("<br>");
    }
}

// =====================================================================
//  저장 (앱 안: 앱 기록과 함께 계정에 저장 / 따로 열면: 이 브라우저 localStorage)
// =====================================================================
const OLD_WRONG_KEY = "shanghan113_wrong";
const APP_KEY = "app_settings_v1";
const RANGE_LABEL = {
    all: "전체", noMemorized: "암기 완료 제외", noMastered: "맞힌 것 제외",
    noExcluded: "지정 제외", onlyMemorized: "암기 완료만", onlyStarred: "별표만"
};
const TIME_A = [["p5", "항목당 5초"], ["p8", "항목당 8초"], ["p12", "항목당 12초"], [60, "60초"], [120, "120초"], [180, "180초"], [0, "시간 제한 없음"]];
const TIME_B = [[10, "10초"], [15, "15초"], [20, "20초"], [30, "30초"], [0, "시간 제한 없음"]];
const TIME_OPTIONS = {
    rx: [[30, "30초"], [60, "60초"], [90, "90초"], [120, "120초"], [0, "시간 제한 없음"]],
    bcA: TIME_A, bcB: TIME_B, crA: TIME_A, crB: TIME_B
};
const validTime = (m, v) => TIME_OPTIONS[m].some(([x]) => x === v);

const HSTATE = HOST ? Object.assign({}, HOST.state || {}) : null;   // 키 → {u: 고친 시각, v: 값}
const lastSent = {};
if (HSTATE) for (const [k, e] of Object.entries(HSTATE)) lastSent[k] = JSON.stringify(e && e.v);

function loadJSON(key) {
    if (HSTATE) { const e = HSTATE[key]; return e && e.v !== undefined ? JSON.parse(JSON.stringify(e.v)) : null; }
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
}
function timeMap(v, byName) {
    const out = {};
    if (Array.isArray(v)) v.forEach(n => { if (byName[n]) out[n] = 0; });
    else if (v && typeof v === "object") {
        for (const [n, t] of Object.entries(v)) if (byName[n]) out[n] = Number(t) || 0;
    }
    return out;
}
function parseRecords(s, m) {
    s = (s && typeof s === "object") ? s : {};
    const byName = MODES[m].byName;
    const clean = arr => Array.isArray(arr) ? arr.filter(n => byName[n]) : [];
    const wrong = {};
    if (s.wrong && typeof s.wrong === "object") {
        for (const [n, v] of Object.entries(s.wrong)) {
            if (byName[n]) wrong[n] = { count: Number(v && v.count) || 1, last: Number(v && v.last) || 0 };
        }
    }
    const rec = {
        wrong,
        memorized: timeMap(s.memorized, byName),
        starred: timeMap(s.starred, byName),
        mastered: new Set(clean(s.mastered)),
        excluded: new Set(clean(s.excluded))
    };
    if (m === "rx") {
        rec.rangeMode = RANGE_LABEL[s.rangeMode] ? s.rangeMode : "all";
        rec.timeLimit = validTime("rx", s.timeLimit) ? s.timeLimit : 60;
        rec.indexSort = s.indexSort === "freq" ? "freq" : "kor";
    }
    return rec;
}
function parseSubjSettings(s, subj) {
    s = (s && typeof s === "object") ? s : {};
    const S = SUBJECTS[subj];
    const nos = S.chapters.map(c => c.no);
    return {
        rangeMode: RANGE_LABEL[s.rangeMode] ? s.rangeMode : "all",
        chapters: Array.isArray(s.chapters) ? s.chapters.filter(n => nos.includes(n)) : nos,
        timeA: validTime(S.A, s.timeA) ? s.timeA : "p8",
        timeB: validTime(S.B, s.timeB) ? s.timeB : 20,
        easy: !!s.easy,
        chain: !!s.chain,
        play: [S.A, S.B, S.mix].includes(s.play) ? s.play : S.A,
        view: [S.A, S.B].includes(s.view) ? s.view : S.A
    };
}
function parseAPP(s) {
    s = (s && typeof s === "object") ? s : {};
    return { subject: SUBJECTS[s.subject] ? s.subject : "rx" };
}

const STORES = {};
const SS = {};
let APP;
function loadAll() {
    RECORD_MODES.forEach(m => { STORES[m] = parseRecords(loadJSON(MODES[m].storeKey), m); });
    ["bc", "cr"].forEach(sj => { SS[sj] = parseSubjSettings(loadJSON(SUBJECTS[sj].settingsKey), sj); });
    APP = parseAPP(loadJSON(APP_KEY));
}
loadAll();
let BCS = SS.bc;   // (이전 버전 호환용 이름)
if (!HSTATE) {
    try {   // 처음 버전 오답 노트 이전
        const old = JSON.parse(localStorage.getItem(OLD_WRONG_KEY) || "null");
        if (Array.isArray(old)) {
            old.forEach(n => { if (RX_BY_NAME[n] && !STORES.rx.wrong[n]) STORES.rx.wrong[n] = { count: 1, last: 0 }; });
            localStorage.removeItem(OLD_WRONG_KEY);
        }
    } catch (e) {}
}

function serializeRecords(m) {
    const st = STORES[m];
    const o = {
        wrong: st.wrong, memorized: st.memorized, starred: st.starred,
        mastered: [...st.mastered], excluded: [...st.excluded]
    };
    if (m === "rx") Object.assign(o, { rangeMode: st.rangeMode, timeLimit: st.timeLimit, indexSort: st.indexSort });
    return o;
}
function allValues() {
    const out = {};
    RECORD_MODES.forEach(m => { out[MODES[m].storeKey] = serializeRecords(m); });
    ["bc", "cr"].forEach(sj => { out[SUBJECTS[sj].settingsKey] = SS[sj]; });
    out[APP_KEY] = APP;
    return out;
}
function saveStore() {
    const vals = allValues();
    if (HSTATE) {
        const changes = {};
        const now = Date.now();
        for (const [k, v] of Object.entries(vals)) {
            const j = JSON.stringify(v);
            if (lastSent[k] === j) continue;
            lastSent[k] = j;
            HSTATE[k] = { u: now, v: JSON.parse(j) };
            changes[k] = HSTATE[k];
        }
        if (Object.keys(changes).length) { try { HOST.post({ type: "hanui-game:save", changes }); } catch (e) {} }
        return;
    }
    try { for (const [k, v] of Object.entries(vals)) localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
}

// ---------- 설정 접근 ----------
let playMode = APP.subject === "rx" ? "rx" : SS[APP.subject].play;
let store = STORES[recMode(playMode)];
const SSof = m => SS[subjOf(m)];
const rangeOf = m => subjOf(m) === "rx" ? STORES.rx.rangeMode : SSof(m).rangeMode;
function setRangeValue(m, v) { if (subjOf(m) === "rx") STORES.rx.rangeMode = v; else SSof(m).rangeMode = v; }
const isA = m => m === "bcA" || m === "crA";
const timeOf = m => m === "rx" ? STORES.rx.timeLimit : isA(m) ? SSof(m).timeA : SSof(m).timeB;
function setTimeValue(m, v) { if (m === "rx") STORES.rx.timeLimit = v; else if (isA(m)) SSof(m).timeA = v; else SSof(m).timeB = v; }
function limitFor(item) {
    const t = timeOf(item.mode);
    return typeof t === "string" ? Number(t.slice(1)) * item.ings.length : t;
}
const viewMode = () => APP.subject === "rx" ? "rx" : SS[APP.subject].view;
const defaultRec = () => current ? current.mode : recMode(playMode);
const isMemorized = (name, m = defaultRec()) => hasOwn(STORES[m].memorized, name);
const isStarred = (name, m = defaultRec()) => hasOwn(STORES[m].starred, name);
const wrongCount = (m = viewMode()) => Object.keys(STORES[m].wrong).length;
const memoCount = (m = viewMode()) => Object.keys(STORES[m].memorized).length;
const starCount = (m = viewMode()) => Object.keys(STORES[m].starred).length;
const reviewCount = () => recModes(playMode).reduce((s, m) => s + wrongCount(m), 0);

// =====================================================================
//  출제 범위
// =====================================================================
// '전체'는 모두, '암기 완료만'은 암기 완료만, 나머지는 암기 완료를 항상 뺌. 본초·총론은 대분류/단원 범위도 적용
function inRange(item, range = rangeOf(item.mode)) {
    const st = STORES[item.mode];
    const sj = subjOf(item.mode);
    if (sj !== "rx" && !SS[sj].chapters.includes(item.chapter)) return false;
    if (range === "all") return true;
    const memo = hasOwn(st.memorized, item.name);
    if (range === "onlyMemorized") return memo;
    if (memo) return false;
    if (range === "onlyStarred") return hasOwn(st.starred, item.name);
    if (range === "noMastered") return !st.mastered.has(item.name);
    if (range === "noExcluded") return !st.excluded.has(item.name);
    return true;
}
function getPool(range, m = playMode) {
    if (isMixMode(m)) return recModes(m).flatMap(x => getPool(range, x));
    if (range === undefined) range = rangeOf(m);
    return MODES[m].items.filter(it => inRange(it, range));
}

// =====================================================================
//  상태
// =====================================================================
const PAGES = ["game", "range", "wrong", "memo", "star"];
const SESS = {};
function S(m = playMode) {
    return SESS[m] ||= { deck: [], pos: 0, deckA: [], posA: 0, deckB: [], posB: 0, score: 0, total: 0 };
}
let current = null;
let currentFromDeck = false;
let lastDeckSrc = null;
let forcedNext = null;
let chainNext = null;
let isChainQ = false;
let selectedInPot = [];
let answered = false;
let isReviewMode = false;
let timeLeft = 0, curLimit = 0;
let timerInterval = null, advanceTimeout = null;
let currentPage = "game";
const dirty = new Set();
let shelfItems = [], activeIdx = -1;
let pendingEnter = false;
let bStep = "big", bBig = 0, bOptions = [], bPicked = null, bSel = [];
const isNarrow = () => window.matchMedia("(max-width: 820px)").matches;

const kindOf = item => MODES[item.mode].kind;
const curKind = () => current ? kindOf(current) : (MODES[playMode].kind === "choice" ? "choice" : "pot");
const msgEl = () => curKind() === "choice" ? $("bResult") : $("resultMessage");
function focusSearch() {
    if (currentPage !== "game" || curKind() !== "pot") return;
    if (isNarrow() && document.activeElement !== $("searchInput")) return;   // 폰: 자판이 갑자기 올라오지 않게
    $("searchInput").focus();
}

// =====================================================================
//  선반 (약탕기 문제)
// =====================================================================
const searchKw = () => norm($("searchInput").value);
const potSubj = () => current ? subjOf(current.mode) : APP.subject;
const comboHidden = c => !!current && current.mode === "rx" && compKey(current) === c.key;
function readingOf(h) {
    const sj = potSubj();
    if (sj === "rx") return READING[h] || "";
    if (sj === "bc") return HERB[h] ? HERB[h].reading : "";
    return CR_TERM[h] ? CR_TERM[h].reading : "";
}
function ingMatches(i, kw) { return i.keys.some(k => k.includes(kw)) || i.chos.some(c => c.includes(kw)); }
function comboMatches(c, kw) { return c.search.some(k => k.includes(kw)) || c.searchCho.some(k => k.includes(kw)); }

function shelfBase() {
    const sj = potSubj();
    if (sj === "bc") return BC_HERBS_KOR;
    if (sj === "cr") return current ? (CR_UNIT_SHELF[current.chapter] || []) : [];
    return STORES.rx.indexSort === "freq" ? ING_BY_FREQ : ingredientDB;
}
function getShelfItems(kw) {
    const base = shelfBase();
    if (potSubj() !== "rx") {
        const list = kw ? base.filter(i => ingMatches(i, kw)) : base;
        return list.map(d => ({ type: "ing", d }));
    }
    const freqMode = STORES.rx.indexSort === "freq";
    let combos = (freqMode ? COMBOS_BY_FREQ : COMBOS).filter(c => !comboHidden(c));
    let ings = base;
    if (kw) {
        combos = combos.filter(c => comboMatches(c, kw));
        ings = ings.filter(i => ingMatches(i, kw));
    } else if (!freqMode) {
        combos = [];
    }
    return [...combos.map(c => ({ type: "combo", d: c })), ...ings.map(i => ({ type: "ing", d: i }))];
}
function defaultActive(kw) {
    if (!kw || !shelfItems.length) return -1;
    const exact = shelfItems.findIndex(it => it.type === "ing" ? it.d.keys.includes(kw) : it.d.search.includes(kw));
    return exact >= 0 ? exact : 0;
}

function renderIngredients() {
    const kw = searchKw();
    shelfItems = getShelfItems(kw);
    activeIdx = defaultActive(kw);
    const sj = potSubj();
    const freqMode = sj === "rx" && STORES.rx.indexSort === "freq";
    const listEl = $("ingredientList");
    listEl.innerHTML = "";
    if (!shelfItems.length) {
        listEl.innerHTML = '<div class="empty-search">검색 결과가 없습니다.</div>';
        return;
    }
    let comboDone = false;
    const frag = document.createDocumentFragment();
    shelfItems.forEach((it, idx) => {
        if (it.type === "ing" && !comboDone && idx > 0) {
            const hr = document.createElement("div");
            hr.className = "shelf-divider";
            frag.appendChild(hr);
        }
        if (it.type === "ing") comboDone = true;
        const card = document.createElement("div");
        card.dataset.idx = idx;
        if (it.type === "combo") {
            const c = it.d;
            const allIn = c.ings.every(h => selectedInPot.includes(h));
            card.className = "combo-card" + (allIn ? " in-pot" : "");
            card.innerHTML =
                `<div class="cb-title">🧩 ${c.name} <span class="freq">${c.freq}처방에 포함</span></div>` +
                `<div class="cb-abbr">${c.abbr}</div><div class="cb-ings">${c.ings.join(" ")}</div>`;
            card.draggable = true;
            card.ondragstart = e => e.dataTransfer.setData("text/plain", "combo:" + c.id);
        } else {
            const i = it.d;
            card.className = "ingredient-card" + (i.kw ? " kw" : "") + (selectedInPot.includes(i.hanja) ? " in-pot" : "");
            const sub = sj === "rx"
                ? `${i.reading}${freqMode ? ` <span class="freq">${ING_FREQ[i.hanja] || 0}</span>` : ""}`
                : `${esc(i.reading && i.reading !== i.hanja ? i.reading : "")}${i.showAliases && i.showAliases.length ? ` <span class="alias">=${i.showAliases.join("·")}</span>` : ""}`;
            card.innerHTML = `${esc(i.hanja)}${sub ? `<small>${sub}</small>` : ""}`;
            if (sj === "rx") { const t = bcTagText(i.hanja); if (t) card.title = "본초 분류: " + t; }
            card.draggable = true;
            card.ondragstart = e => e.dataTransfer.setData("text/plain", i.hanja);
        }
        if (idx === activeIdx) card.classList.add("active");
        card.onclick = () => selectItem(it, false);
        frag.appendChild(card);
    });
    listEl.appendChild(frag);
    const act = listEl.querySelector(".active");
    if (act && kw) act.scrollIntoView({ block: "nearest" });
}

function setActive(i) {
    activeIdx = i;
    $("ingredientList").querySelectorAll("[data-idx]").forEach(el => el.classList.toggle("active", Number(el.dataset.idx) === i));
    const act = $("ingredientList").querySelector(".active");
    if (act) act.scrollIntoView({ block: "nearest" });
}

// 클릭: 넣기/빼기 토글 · 키보드(Enter): 넣기만
function selectItem(it, viaKeyboard) {
    if (answered || !current || curKind() !== "pot") { focusSearch(); return; }
    if (it.type === "ing") {
        const h = it.d.hanja;
        if (selectedInPot.includes(h)) { if (!viaKeyboard) selectedInPot = selectedInPot.filter(x => x !== h); }
        else selectedInPot.push(h);
    } else {
        const missing = it.d.ings.filter(h => !selectedInPot.includes(h));
        if (missing.length) selectedInPot.push(...missing);
        else if (!viaKeyboard) selectedInPot = selectedInPot.filter(h => !it.d.ings.includes(h));
    }
    const hadKw = !!$("searchInput").value;
    $("searchInput").value = "";
    renderPot();
    if (hadKw && isNarrow()) $("ingredientList").scrollTop = 0;
    focusSearch();
}
function commitSearch() {
    if (answered || !current) return;
    if (!searchKw() || !shelfItems.length) return;
    selectItem(shelfItems[activeIdx >= 0 ? activeIdx : 0], true);
}

// ---------- 약탕기 ----------
function addToPot(hanja) {
    hanja = nfc(hanja);
    if (answered || !current || curKind() !== "pot" || selectedInPot.includes(hanja)) return;
    if (!shelfBase().some(i => i.hanja === hanja)) return;
    selectedInPot.push(hanja);
    renderPot();
}
function removeFromPot(hanja) {
    if (answered) return;
    selectedInPot = selectedInPot.filter(h => h !== hanja);
    renderPot();
}
function resetPot() {
    if (answered) return;
    selectedInPot = [];
    renderPot();
}
function renderPot() {
    const box = $("selectedIngredients");
    box.innerHTML = "";
    selectedInPot.forEach(h => {
        const tag = document.createElement("div");
        tag.className = "selected-card";
        const r = readingOf(h);
        tag.textContent = r && r !== h ? `${h} ${r}` : h;
        tag.onclick = () => { removeFromPot(h); focusSearch(); };
        box.appendChild(tag);
    });
    $("potCount").textContent = `(${selectedInPot.length})`;
    box.scrollTop = box.scrollHeight;
    box.scrollLeft = box.scrollWidth;
    renderIngredients();
}

// =====================================================================
//  타이머 (다른 페이지로 가면 일시정지)
// =====================================================================
function renderTimer() {
    $("timer").textContent = !current ? "-" : (curLimit ? Math.max(timeLeft, 0) : "∞");
    $("timerBadge").classList.toggle("urgent", !!curLimit && timerInterval !== null && timeLeft <= 10);
}
function pauseTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    renderTimer();
}
function runTimer() {
    pauseTimer();
    if (!curLimit || answered || !current) return;
    timerInterval = setInterval(() => {
        timeLeft--;
        renderTimer();
        if (timeLeft <= 0) { pauseTimer(); finishQuestion(true, "⏰ 시간 초과!"); }
    }, 1000);
    renderTimer();
}
function renderTimerSelect() {
    const sel = $("timerSelect");
    const m = current ? current.mode : recMode(playMode);
    const prefix = isMixMode(playMode) ? (isA(m) ? "A · " : "B · ") : "";
    if (sel.dataset.mode !== m || sel.dataset.prefix !== prefix) {
        sel.innerHTML = TIME_OPTIONS[m].map(([v, l]) => `<option value="${v}">${prefix}${l}</option>`).join("");
        sel.dataset.mode = m;
        sel.dataset.prefix = prefix;
    }
    sel.value = String(timeOf(m));
}

// =====================================================================
//  문제 진행
// =====================================================================
function buildDeck(m = playMode) {
    const s = S(m);
    if (isMixMode(m)) {
        const [a, b] = recModes(m);
        s.deckA = shuffle(getPool(undefined, a)); s.posA = 0;
        s.deckB = shuffle(getPool(undefined, b)); s.posB = 0;
    } else {
        s.deck = shuffle(getPool(undefined, m)); s.pos = 0;
    }
}
function returnCurrentToDeck() {
    if (answered || !currentFromDeck || !current) return;
    const s = S();
    if (isMixMode(playMode)) {
        if (lastDeckSrc === "A" && s.posA > 0) s.posA--;
        if (lastDeckSrc === "B" && s.posB > 0) s.posB--;
    } else if (s.pos > 0) s.pos--;
    currentFromDeck = false;
}
function drawDeck(s, dk, pk, m) {
    while (s[pk] < s[dk].length && !inRange(s[dk][s[pk]])) s[pk]++;
    let wrapped = false;
    if (s[pk] >= s[dk].length) {
        const pool = getPool(undefined, m);
        if (!pool.length) return { item: null, wrapped: false };
        wrapped = s[dk].length > 0;
        const d = shuffle(pool);
        if (d.length > 1 && current && d[0].name === current.name && d[0].mode === current.mode) [d[0], d[1]] = [d[1], d[0]];
        s[dk] = d;
        s[pk] = 0;
    }
    return { item: s[dk][s[pk]++], wrapped };
}

function nextQuestion(extraNotice = "") {
    clearTimeout(advanceTimeout);
    pauseTimer();
    let notice = extraNotice;
    const addNotice = t => { notice = notice ? notice + " " + t : t; };
    let next = null;
    isChainQ = false;

    if (forcedNext) {
        next = forcedNext; forcedNext = null; chainNext = null; currentFromDeck = false;
    }
    if (!next && chainNext) {
        next = chainNext; chainNext = null; isChainQ = true; currentFromDeck = false;
    }
    if (!next && isReviewMode) {
        const pool = recModes(playMode).flatMap(m => Object.keys(STORES[m].wrong).map(n => MODES[m].byName[n])).filter(Boolean);
        if (!pool.length) {
            isReviewMode = false;
            addNotice("🎊 오답 노트를 모두 정복했습니다! 일반 모드로 돌아갑니다.");
            if (dirty.has(playMode)) { dirty.delete(playMode); buildDeck(); }
        } else {
            let cand = pool.filter(it => !current || it !== current);
            if (!cand.length) cand = pool;
            next = cand[Math.floor(Math.random() * cand.length)];
            currentFromDeck = false;
        }
    }
    if (!next) {
        const s = S();
        if (isMixMode(playMode)) {
            const [ma, mb] = recModes(playMode);
            const hasA = getPool(undefined, ma).length > 0, hasB = getPool(undefined, mb).length > 0;
            if (!hasA && !hasB) { showEmptyRange(notice); return; }
            const src = !hasA ? "B" : !hasB ? "A" : (Math.random() < 0.5 ? "A" : "B");
            const r = src === "A" ? drawDeck(s, "deckA", "posA", ma) : drawDeck(s, "deckB", "posB", mb);
            if (r.wrapped) addNotice(`🏁 ${src} 문제 한 바퀴 완료! 다시 섞습니다.`);
            next = r.item;
            lastDeckSrc = src;
        } else {
            const r = drawDeck(s, "deck", "pos", playMode);
            if (!r.item) { showEmptyRange(notice); return; }
            if (r.wrapped) {
                addNotice(`🏁 '${RANGE_LABEL[rangeOf(playMode)]}' 범위 한 바퀴 완료! (누적 ${s.score}/${s.total}) ` +
                          `범위 안 ${getPool().length}개를 다시 섞습니다.`);
            }
            next = r.item;
        }
        currentFromDeck = true;
    }

    current = next;
    answered = false;
    selectedInPot = [];
    bStep = "big"; bBig = 0; bPicked = null; bSel = [];
    bOptions = (current.mode === "bcB" && SS.bc.easy) ? makeOptions(current) : [];
    $("searchInput").value = "";
    renderLayout();
    renderQuestion();
    if (curKind() === "pot") { renderPot(); $("ingredientList").scrollTop = 0; } else renderChoice();
    setControls();
    updateStatus();
    ["resultMessage", "bResult"].forEach(id => { $(id).className = "result-message notice"; $(id).textContent = ""; });
    ["feedback", "bFeedback"].forEach(id => { $(id).innerHTML = ""; });
    msgEl().textContent = notice;
    curLimit = limitFor(current);
    timeLeft = curLimit;
    renderTimerSelect();
    renderTimer();
    if (currentPage === "game") {
        runTimer();
        focusSearch();
    }
}

function showEmptyRange(notice) {
    current = null;
    answered = true;
    selectedInPot = [];
    pauseTimer();
    renderLayout();
    const unit = MODES[playMode].unit;
    const range = rangeOf(playMode);
    const choice = MODES[playMode].kind === "choice";
    $(choice ? "bNo" : "targetNo").textContent = `범위: ${RANGE_LABEL[range]}`;
    const t = $(choice ? "bTarget" : "targetPrescription");
    t.textContent = `출제할 ${unit} 없음`;
    t.classList.remove("long", "xlong");
    $(choice ? "bReading" : "targetReading").textContent = "";
    if (choice) $("bAlias").textContent = "";
    ["hintBtn", "bHintBtn", "hintText", "bHintText"].forEach(id => $(id).classList.add("hidden"));
    renderStarBtn();
    renderPot();
    $("choiceBox").innerHTML = "";
    setControls();
    updateStatus();
    renderTimerSelect();
    const emptyMsg = {
        all: "범위 안에 출제할 문제가 없습니다.",
        noMemorized: `🎉 범위 안의 ${unit}을 모두 암기 완료했습니다! '전체'나 '암기 완료만' 범위로 점검해 보세요.`,
        noMastered: `🎉 이 범위의 ${unit}을 모두 맞혔거나 암기 완료했습니다!`,
        noExcluded: `모든 ${unit}이 제외되었거나 암기 완료되어 출제할 문제가 없습니다.`,
        onlyMemorized: `아직 암기 완료한 ${unit}이 없습니다. 게임 중 🧠 암기 버튼으로 옮겨 보세요.`,
        onlyStarred: `별표한 ${unit}이 없습니다. (암기 완료한 것은 이 범위에서 빠집니다) 게임 중 ☆를 눌러 추가해 보세요.`
    };
    let text = emptyMsg[range] || "출제할 문제가 없습니다.";
    const sj = subjOf(playMode);
    if (sj !== "rx" && !SS[sj].chapters.length) text = `${SUBJECTS[sj].chapterWord} 범위가 모두 해제되어 있습니다. 출제 범위에서 골라주세요.`;
    const el = $(choice ? "bResult" : "resultMessage");
    el.className = "result-message notice";
    el.textContent = (notice ? notice + " " : "") + text;
    $(choice ? "bFeedback" : "feedback").innerHTML =
        '<div style="text-align:center;margin-top:10px"><button class="small-btn primary" id="goRangeBtn">⚙️ 출제 범위로 이동</button></div>';
    $("goRangeBtn").onclick = () => { location.hash = "#range"; };
}

function questionTags() {
    const tags = [];
    if (isReviewMode) tags.push("오답 복습");
    if (!currentFromDeck && !isReviewMode && !isChainQ) tags.push("다시 풀기");
    if (isChainQ) tags.push("🔗 꼬리물기");
    if (isMemorized(current.name, current.mode)) tags.push("🧠 암기 완료");
    return tags.length ? " · " + tags.join(" · ") : "";
}
function sizeClass(el, text) {
    const n = [...text].length;
    el.classList.toggle("long", n > 9 && n <= 16);
    el.classList.toggle("xlong", n > 16);
}

function renderQuestion() {
    const mixTag = isMixMode(playMode) ? (isA(current.mode) ? "🔀 A · " : "🔀 B · ") : "";
    if (kindOf(current) === "pot") {
        const t = $("targetPrescription");
        t.textContent = current.label;
        sizeClass(t, current.label);
        if (current.mode === "rx") {
            $("targetNo").textContent = `No. ${current.no}` + questionTags();
            $("targetReading").textContent = current.reading + (current.alias ? ` · 이명: ${current.alias}` : "");
        } else if (current.mode === "bcA") {
            $("targetNo").textContent = `${mixTag}${current.big.name} ${current.big.reading} · ${current.code}` + questionTags();
            $("targetReading").textContent = current.reading;
        } else {
            $("targetNo").textContent = `${mixTag}${current.topic.unit.no}. ${current.topic.unit.name} · ${current.topic.name}` + questionTags();
            $("targetReading").textContent = current.reading && current.reading !== current.label ? current.reading : "";
        }
        $("hintText").classList.add("hidden");
        $("hintText").textContent = "";
        $("hintBtn").classList.remove("hidden");
    } else {
        const t = $("bTarget");
        t.textContent = current.label;
        t.classList.toggle("herb", current.mode === "bcB" || [...current.label].length <= 6);
        sizeClass(t, current.label);
        if (current.mode === "bcB") {
            $("choiceTitle").textContent = "🎯 이 약물은 어느 분류일까요?";
            $("bNo").textContent = `${mixTag}No. ${current.no}` + questionTags();
            $("bReading").textContent = current.reading;
            $("bAlias").textContent = current.herb.showAliases.length ? `異名: ${current.herb.showAliases.join(" · ")}` : "";
        } else {
            $("choiceTitle").textContent = `🎯 ${current.topic.name} — 어디에 해당할까요?`;
            $("bNo").textContent = `${mixTag}${current.topic.unit.no}. ${current.topic.unit.name}` + questionTags();
            $("bReading").textContent = current.reading && current.reading !== current.label ? current.reading : "";
            const tag = bcTagText(current.term) || (rxFor(current.term) ? `상한론 ${rxFor(current.term).no}번 처방` : "");
            $("bAlias").textContent = tag ? `🔗 ${tag}` : "";
        }
        $("bHintText").classList.add("hidden");
        $("bHintText").textContent = "";
        $("bHintBtn").classList.remove("hidden");
    }
    renderStarBtn();
}

function showHint() {
    if (!current) return;
    if (kindOf(current) === "pot") {
        let txt;
        if (current.mode === "rx") txt = `약재 ${current.ings.length}가지` + (current.memo ? ` · 암기법: ${current.memo}` : "");
        else if (current.mode === "bcA") txt = `약물 ${current.ings.length}가지 · ${current.desc}`;
        else txt = `${current.ings.length}개` + (current.memo ? ` · ${current.memo}` : "") + (current.topic.memo ? ` · ${current.topic.memo}` : "");
        $("hintText").textContent = txt;
        $("hintText").classList.remove("hidden");
        $("hintBtn").classList.add("hidden");
    } else {
        $("bHintText").textContent = current.mode === "bcB"
            ? `대분류: ${current.group.big.name} (${current.group.big.reading})`
            : (current.topic.memo || `정답 ${current.answers.length}개`);
        $("bHintText").classList.remove("hidden");
        $("bHintBtn").classList.add("hidden");
    }
}

function setControls() {
    const locked = answered || !current;
    const memoOff = !current || isMemorized(current.name, current.mode);
    const showNext = !!(answered && current);
    ["submitBtn", "resetBtn", "giveUpBtn", "bGiveUpBtn"].forEach(id => { $(id).disabled = locked; });
    $("memoBtn").disabled = memoOff;
    $("bMemoBtn").disabled = memoOff;
    $("nextBtn").classList.toggle("hidden", !showNext);
    $("bNextBtn").classList.toggle("hidden", !showNext);
    // 폰에서는 채점 뒤 '다음'만 크게
    ["submitBtn", "resetBtn", "giveUpBtn"].forEach(id => $(id).classList.toggle("hidden", showNext && isNarrow()));
}

function checkAnswer() {
    if (answered || !current || curKind() !== "pot") return;
    if (selectedInPot.length === 0) {
        const msg = $("resultMessage");
        msg.className = "result-message wrong";
        msg.textContent = "하나 이상 넣어주세요!";
        return;
    }
    finishQuestion(false);
}

function finishQuestion(forcedWrong, label, picked = null) {
    if (answered || !current) return;
    answered = true;
    pauseTimer();
    const s = S();
    s.total++;
    const st = STORES[current.mode];
    const pot = kindOf(current) === "pot";

    let isCorrect, hit = 0;
    const userSet = new Set(selectedInPot);
    if (pot) {
        const correctSet = new Set(current.ings);
        hit = current.ings.filter(h => userSet.has(h)).length;
        isCorrect = !forcedWrong && hit === correctSet.size && userSet.size === correctSet.size;
    } else if (current.mode === "bcB") {
        isCorrect = !forcedWrong && picked === current.answer;
    } else {
        const p = new Set(picked || []);
        isCorrect = !forcedWrong && p.size === current.answers.length && current.answers.every(i => p.has(i));
    }

    if (isCorrect) {
        s.score++;
        st.mastered.add(current.name);
        delete st.wrong[current.name];
    } else {
        st.mastered.delete(current.name);
        const prev = st.wrong[current.name];
        st.wrong[current.name] = { count: (prev ? prev.count : 0) + 1, last: Date.now() };
    }
    saveStore();
    updateStatus();
    setControls();

    if (pot) renderPotFeedback(isCorrect, label, hit, userSet);
    else if (current.mode === "bcB") renderChoiceFeedback(isCorrect, label, picked);
    else renderMultiFeedback(isCorrect, label, picked || []);

    // 꼬리물기: 섞어풀기에서 B 문제를 풀면 그 묶음의 A 문제로 이어짐
    if (isMixMode(playMode) && SSof(playMode).chain && !isReviewMode) {
        if (current.mode === "bcB") chainNext = current.group;
        else if (current.mode === "crB") chainNext = CR_A_BY_TG[current.topic.idx + "/" + current.answers[0]] || null;
    }

    if (!pot) $("bNextBtn").focus({ preventScroll: true });
    else focusSearch();
    if (isCorrect) advanceTimeout = setTimeout(nextQuestion, pot ? 1800 : 1300);
}

function chipHtml(h, cls) {
    let extra = "";
    const sj = subjOf(current.mode);
    if (sj === "rx" || sj === "cr") extra = bcTagHtml(h);
    if (sj === "bc" && HERB[h] && HERB[h].showAliases.length) extra = ` <span class="alias">=${HERB[h].showAliases.join("·")}</span>`;
    const r = readingOf(h);
    return `<span class="chip ${cls}">${esc(h)}${r && r !== h ? ` <em>${esc(r)}</em>` : ""}${extra}${cls === "ok" ? " ✓" : ""}</span>`;
}
function unmemoHtml(isCorrect) {
    return (!isCorrect && isMemorized(current.name, current.mode))
        ? '<div style="text-align:center;margin-top:10px"><button class="small-btn danger" id="unmemoBtn">🔄 암기 완료에서 되돌리기 (다시 외우기)</button></div>'
        : "";
}
function bindUnmemo() {
    const b = $("unmemoBtn");
    if (!b) return;
    b.onclick = () => {
        setMemorized(current.name, false, current.mode);
        b.replaceWith(Object.assign(document.createElement("span"), { className: "legend", textContent: "되돌렸습니다. 다시 출제 대상이 됩니다." }));
        focusSearch();
    };
}

function renderPotFeedback(isCorrect, label, hit, userSet) {
    const correctSet = new Set(current.ings);
    const msg = $("resultMessage");
    if (isCorrect) {
        msg.className = "result-message correct";
        msg.textContent = "🎉 정답입니다! 완벽해요.";
    } else {
        msg.className = "result-message wrong";
        msg.textContent = `${label || "❌ 오답입니다."} (${correctSet.size}개 중 ${hit}개 맞힘` +
            (userSet.size - hit > 0 ? `, 불필요 ${userSet.size - hit}개)` : ")");
    }
    let html = '<div class="answer-chips">';
    current.ings.forEach(h => { html += chipHtml(h, userSet.has(h) ? "ok" : "miss"); });
    selectedInPot.filter(h => !correctSet.has(h)).forEach(h => { html += chipHtml(h, "extra"); });
    html += "</div>";
    if (!isCorrect) html += '<div class="legend">초록: 맞힘 · 빨간 점선: 빠뜨림 · 회색 취소선: 불필요</div>';
    if (current.mode === "rx") {
        html += '<div class="legend">파란 꼬리표: 본초 분류</div>';
        if (current.memo) html += `<div class="memo-box">💡 암기법: ${esc(current.memo)}</div>`;
        const same = compGroups[compKey(current)].filter(n => n !== current.name);
        if (same.length) html += `<div class="same-box">🔁 구성 약재가 같은 처방 (용량·법제 차이): ${same.join(", ")}</div>`;
    } else if (current.mode === "bcA") {
        html += `<div class="memo-box">📝 ${current.big.name} › ${current.name}: ${esc(current.desc)}</div>`;
    } else {
        const memo = [current.memo, current.topic.memo].filter(Boolean).join(" · ");
        if (memo) html += `<div class="memo-box">💡 ${esc(memo)}</div>`;
    }
    html += unmemoHtml(isCorrect);
    $("feedback").innerHTML = html;
    bindUnmemo();
    renderIngredients();
}

// =====================================================================
//  B 문제: 고르기 (본초는 2단계·4지선다, 총론은 해당하는 것 모두 고르기)
// =====================================================================
function makeOptions(item) {
    const ans = item.group;
    const siblings = shuffle(ans.big.groups.filter(g => g !== ans)).slice(0, 2);
    const others = shuffle(bcGroups.filter(g => g.big !== ans.big)).slice(0, 3 - siblings.length);
    return shuffle([ans, ...siblings, ...others]).map(g => g.code);
}
function choiceBtn(main, sub, key, onClick, cls = "", disabled = false) {
    const b = document.createElement("button");
    b.className = "choice-btn " + cls;
    b.innerHTML = `<span class="cb-main">${main}</span>` + (sub ? `<span class="cb-sub">${sub}</span>` : "") + (key ? `<span class="key">${key}</span>` : "");
    b.disabled = disabled;
    if (onClick) b.onclick = onClick;
    return b;
}
function head(text, html) {
    const h = document.createElement("div");
    h.className = "sub-head";
    const span = document.createElement("span");
    if (html) span.innerHTML = text; else span.textContent = text;
    h.appendChild(span);
    return h;
}

function renderChoice() {
    const box = $("choiceBox");
    box.innerHTML = "";
    if (!current || kindOf(current) !== "choice") return;
    if (current.mode === "crB") return renderMulti(box);
    const ansG = current.group;
    const pickedG = bPicked ? BCG_BY_CODE[bPicked] : null;

    if (SS.bc.easy) {
        box.appendChild(head(answered ? "정답 확인" : "보기에서 고르세요 (쉬움 모드)"));
        const grid = document.createElement("div");
        grid.className = "easy-grid";
        bOptions.forEach((code, i) => {
            const g = BCG_BY_CODE[code];
            let cls = "";
            if (answered && code === ansG.code) cls = "correct";
            else if (answered && pickedG && code === pickedG.code) cls = "picked-wrong";
            grid.appendChild(choiceBtn(g.name, `${g.reading} · ${g.big.name}`, String(i + 1), () => pickB(code), cls, answered));
        });
        box.appendChild(grid);
        return;
    }
    if (answered) {
        box.appendChild(head("대분류"));
        const grid = document.createElement("div");
        grid.className = "big-grid";
        BIG.forEach(big => {
            let cls = "";
            if (big === ansG.big) cls = "correct";
            else if (pickedG && big === pickedG.big) cls = "picked-wrong";
            grid.appendChild(choiceBtn(`${big.no}. ${big.name}`, big.reading, "", null, cls, true));
        });
        box.appendChild(grid);
        if (ansG.big.groups.length > 1) {
            const h2 = head(`${ansG.big.name}의 소분류`);
            h2.style.marginTop = "12px";
            box.appendChild(h2);
            const sg = document.createElement("div");
            sg.className = "sub-grid";
            ansG.big.groups.forEach(g => {
                const cls = g === ansG ? "correct" : (pickedG === g ? "picked-wrong" : "");
                sg.appendChild(choiceBtn(g.name, g.reading, "", null, cls, true));
            });
            box.appendChild(sg);
        }
        return;
    }
    if (bStep === "big") {
        box.appendChild(head("1단계: 대분류를 고르세요"));
        const grid = document.createElement("div");
        grid.className = "big-grid";
        BIG.forEach(big => {
            const sub = `${big.reading}` + (big.groups.length > 1 ? ` · <span class="subcnt">소분류 ${big.groups.length}</span>` : "");
            grid.appendChild(choiceBtn(`${big.no}. ${big.name}`, sub, "", () => chooseBig(big.no)));
        });
        box.appendChild(grid);
    } else {
        const big = BIG_BY_NO[bBig];
        const h = head(`2단계: <span style="color:var(--celadon-ink)">${big.name}</span> 의 소분류`, true);
        const back = document.createElement("button");
        back.className = "small-btn";
        back.textContent = "← 대분류 다시 고르기";
        back.onclick = backToBig;
        h.appendChild(back);
        box.appendChild(h);
        const grid = document.createElement("div");
        grid.className = "sub-grid";
        big.groups.forEach((g, i) => grid.appendChild(choiceBtn(g.name, g.reading, String(i + 1), () => pickB(g.code))));
        box.appendChild(grid);
    }
}

function renderMulti(box) {
    const t = current.topic;
    const ans = new Set(current.answers);
    const n = current.answers.length;
    box.appendChild(head(answered ? "정답 확인" : (n > 1
        ? `해당하는 것을 <span class="cnt">모두</span> 고르세요 · 정답 <span class="cnt">${n}개</span>`
        : "하나를 고르세요"), true));
    const grid = document.createElement("div");
    grid.className = t.groups.length <= 4 ? "easy-grid" : "sub-grid";
    t.groups.forEach((g, i) => {
        let cls = "";
        if (answered) {
            const picked = (bPicked || []).includes(i);
            if (ans.has(i)) cls = picked ? "correct" : "missed";
            else if (picked) cls = "picked-wrong";
        } else if (bSel.includes(i)) cls = "sel";
        const sub = g.reading && g.reading !== g.name ? g.reading : "";
        grid.appendChild(choiceBtn(esc(g.name), esc(sub), i < 9 ? String(i + 1) : "", () => toggleMulti(i), cls, answered));
    });
    box.appendChild(grid);
    if (!answered && n > 1) {
        const w = document.createElement("div");
        w.className = "multi-submit";
        const b = document.createElement("button");
        b.className = "action-btn";
        b.id = "multiSubmit";
        b.textContent = `제출 (${bSel.length}/${n})`;
        b.disabled = !bSel.length;
        b.onclick = submitMulti;
        w.appendChild(b);
        box.appendChild(w);
    }
}
function toggleMulti(i) {
    if (answered || !current || current.mode !== "crB") return;
    if (current.answers.length === 1) { bSel = [i]; submitMulti(); return; }
    bSel = bSel.includes(i) ? bSel.filter(x => x !== i) : [...bSel, i];
    renderChoice();
}
function submitMulti() {
    if (answered || !current || current.mode !== "crB" || !bSel.length) return;
    bPicked = [...bSel];
    finishQuestion(false, null, bPicked);
}

function chooseBig(no) {
    if (answered || !current) return;
    const big = BIG_BY_NO[no];
    if (big.groups.length === 1) { pickB(big.groups[0].code); return; }
    bStep = "sub";
    bBig = no;
    renderChoice();
}
function backToBig() {
    if (answered || bStep !== "sub") return;
    bStep = "big";
    renderChoice();
}
function pickB(code) {
    if (answered || !current || current.mode !== "bcB") return;
    bPicked = code;
    finishQuestion(false, null, code);
}

function renderChoiceFeedback(isCorrect, label, picked) {
    const g = current.group;
    const pg = picked ? BCG_BY_CODE[picked] : null;
    const near = !isCorrect && pg && pg.big === g.big;
    const msg = $("bResult");
    if (isCorrect) { msg.className = "result-message correct"; msg.textContent = `🎉 정답! ${g.name}`; }
    else { msg.className = "result-message wrong"; msg.textContent = (label || "❌ 오답입니다.") + (near ? " (대분류는 맞았어요)" : ""); }
    let html = `<div class="path-box">${g.big.name} ${g.big.reading} › <b>${g.name}</b> ${g.reading}` +
        (!isCorrect && pg ? `<span class="mine">내 답: ${pg.big.name} › ${pg.name}</span>` : "") + `</div>`;
    html += `<div class="memo-box">📝 ${esc(g.desc)}</div>`;
    html += '<div class="answer-chips">' + g.ings.map(h => {
        const herb = HERB[h];
        return `<span class="chip ${h === current.name ? "hl" : ""}">${h} <em>${herb.reading}</em>` +
               (herb.showAliases.length ? ` <span class="alias">=${herb.showAliases.join("·")}</span>` : "") + `</span>`;
    }).join("") + "</div>";
    html += `<div class="legend">${g.name}의 약물 ${g.ings.length}가지 · 노란색이 이번 문제</div>`;
    const rx = HERB_TO_RX[current.name];
    if (rx && rx.length) {
        const shown = rx.slice(0, 6).map(x => x.rx + (x.as !== current.name ? `(${x.as})` : "")).join(", ");
        html += `<div class="same-box">📜 상한론 113 중 ${rx.length}처방에 쓰임: ${shown}${rx.length > 6 ? ` 외 ${rx.length - 6}` : ""}</div>`;
    }
    html += unmemoHtml(isCorrect);
    $("bFeedback").innerHTML = html;
    bindUnmemo();
    renderChoice();
}

function renderMultiFeedback(isCorrect, label, picked) {
    const t = current.topic;
    const ans = current.answers.map(i => t.groups[i]);
    const msg = $("bResult");
    if (isCorrect) { msg.className = "result-message correct"; msg.textContent = `🎉 정답! ${ans.map(g => g.name).join(" · ")}`; }
    else {
        const hit = picked.filter(i => current.answers.includes(i)).length;
        msg.className = "result-message wrong";
        msg.textContent = (label || "❌ 오답입니다.") + (ans.length > 1 ? ` (${ans.length}개 중 ${hit}개 맞힘${picked.length - hit ? `, 틀린 선택 ${picked.length - hit}개` : ""})` : "");
    }
    let html = `<div class="path-box">${esc(t.name)} › <b>${ans.map(g => esc(g.name)).join(" · ")}</b>` +
        (!isCorrect && picked.length ? `<span class="mine">내 답: ${picked.map(i => esc(t.groups[i].name)).join(" · ")}</span>` : "") + `</div>`;
    ans.forEach(g => {
        html += '<div class="answer-chips">' + g.items.map(h => {
            const r = crTerm(h).reading;
            return `<span class="chip ${h === current.term ? "hl" : ""}">${esc(h)}${r && r !== h ? ` <em>${esc(r)}</em>` : ""}${bcTagHtml(h)}</span>`;
        }).join("") + "</div>";
        html += `<div class="legend">${esc(g.name)}${g.memo ? " — " + esc(g.memo) : ""} · 노란색이 이번 문제</div>`;
    });
    if (t.memo) html += `<div class="memo-box">💡 ${esc(t.memo)}</div>`;
    const rx = HERB_TO_RX[(bcLinksFor(current.term)[0] || {}).hanja];
    if (rx && rx.length) {
        html += `<div class="same-box">📜 상한론 113 중 ${rx.length}처방에 쓰임: ${rx.slice(0, 6).map(x => x.rx).join(", ")}${rx.length > 6 ? ` 외 ${rx.length - 6}` : ""}</div>`;
    }
    html += unmemoHtml(isCorrect);
    $("bFeedback").innerHTML = html;
    bindUnmemo();
    renderChoice();
}

// =====================================================================
//  별표 · 암기 완료
// =====================================================================
function renderStarBtn() {
    ["starBtn", "bStarBtn"].forEach(id => {
        const b = $(id);
        b.classList.toggle("hidden", !current);
        if (!current) return;
        const on = isStarred(current.name, current.mode);
        b.textContent = on ? "★" : "☆";
        b.classList.toggle("off", !on);
        b.title = on ? "별표 해제 (Alt+S)" : "별표 (Alt+S)";
    });
}
function toggleStar(name, m = defaultRec()) {
    const st = STORES[m];
    if (!MODES[m].byName[name]) return;
    if (hasOwn(st.starred, name)) delete st.starred[name];
    else st.starred[name] = Date.now();
    saveStore();
    updateStatus();
    if (current && current.name === name && current.mode === m) renderStarBtn();
    if (rangeOf(m) === "onlyStarred" && currentPage !== "game") markDirty(subjOf(m));
}
function setMemorized(name, flag, m = defaultRec()) {
    const st = STORES[m];
    if (flag) { st.memorized[name] = Date.now(); delete st.wrong[name]; }
    else delete st.memorized[name];
    saveStore();
    updateStatus();
}
function memorizeCurrent() {
    if (!current || isMemorized(current.name, current.mode)) return;
    const name = current.label;
    setMemorized(current.name, true, current.mode);
    nextQuestion(`🧠 ${name}을(를) 암기 완료로 옮겼습니다.` +
        (rangeOf(current.mode) === "all" ? " (범위가 '전체'라서 나중에 다시 나올 수 있어요)" : ""));
}
function setMemorizedFromPage(name, flag, m) {
    setMemorized(name, flag, m);
    if (rangeOf(m) !== "all") markRangeChanged(subjOf(m));
}

// =====================================================================
//  상태 표시 · 모드 전환
// =====================================================================
function updateStatus() {
    const s = S();
    $("score").textContent = s.score;
    $("total").textContent = s.total;
    $("rate").textContent = s.total ? `(${Math.round(s.score / s.total * 100)}%)` : "";
    $("progress").textContent = isReviewMode
        ? `오답 복습 · 남은 ${reviewCount()}`
        : isMixMode(playMode)
            ? `A ${Math.min(s.posA, s.deckA.length)}/${s.deckA.length} · B ${Math.min(s.posB, s.deckB.length)}/${s.deckB.length}`
            : `진행 ${Math.min(s.pos, s.deck.length)}/${s.deck.length}`;
    const sel = $("rangeSelectGame");
    sel.value = rangeOf(playMode);
    sel.disabled = isReviewMode;
    const btn = $("modeToggleBtn");
    btn.classList.toggle("review", isReviewMode);
    btn.textContent = isReviewMode ? "📚 일반 모드로" : `🔁 오답 복습 (${reviewCount()})`;
    const vm = viewMode();
    $("wrongTabCount").textContent = wrongCount(vm);
    $("memoTabCount").textContent = memoCount(vm);
    $("starTabCount").textContent = starCount(vm);
    document.querySelectorAll("#sortSeg button").forEach(b => b.classList.toggle("on", b.dataset.sort === STORES.rx.indexSort));
}

function renderLayout() {
    const subj = APP.subject;
    const SJ = SUBJECTS[subj];
    document.body.className = `subj-${subj} play-${playMode}` + (current ? ` cur-${current.mode}` : "") + (HOST ? " hosted" : "");
    document.querySelectorAll(".subject-btn").forEach(b => b.classList.toggle("on", b.dataset.subject === subj));
    $("appTitle").textContent = SJ.title;
    $("gameTab").textContent = SJ.gameTab;

    const kind = curKind();
    $("potGame").classList.toggle("hidden", kind !== "pot");
    $("choiceGame").classList.toggle("hidden", kind !== "choice");
    const ps = potSubj();
    if (ps === "rx") {
        $("shelfTitle").textContent = "📦 약재 인덱스 & 검색";
        $("potTitle").textContent = "🎯 달여야 할 처방";
        $("searchInput").placeholder = isNarrow() ? "🔍 약재·조합 (치자, ㅊㅈ, 대생감작계)" : "🔍 약재·조합 검색 (치자, 梔子, ㅊㅈ, 대생감작계)";
        $("submitBtn").textContent = isNarrow() ? "달이기" : "약 달이기 (정답 제출)";
    } else if (ps === "bc") {
        $("shelfTitle").textContent = "📦 약물 인덱스 & 검색 (가나다순)";
        $("potTitle").textContent = "🎯 이 분류의 약물을 모두 넣으세요";
        $("searchInput").placeholder = "🔍 약물 검색 (마황, 麻黃, ㅁㅎ, 瓜蔞根)";
        $("submitBtn").textContent = "제출";
    } else {
        const u = current ? `${current.chapter}. ${UNIT_BY_NO[current.chapter].name}` : "";
        $("shelfTitle").textContent = `📦 ${u} 항목 검색`;
        $("potTitle").textContent = "🎯 이 묶음에 해당하는 것을 모두 넣으세요";
        $("searchInput").placeholder = "🔍 항목 검색 (한자, 독음, 초성)";
        $("submitBtn").textContent = "제출";
    }
    if (SJ.A) {
        $("modeSegA").textContent = SJ.labelA;
        $("modeSegB").textContent = SJ.labelB;
        $("viewSegA").textContent = SJ.labelA.replace("📦 A ", "📦 ") + " (A)";
        $("viewSegB").textContent = SJ.labelB.replace("🔎 B ", "🔎 ") + " (B)";
        document.querySelectorAll("#modeSeg button").forEach(b => b.classList.toggle("on", SJ[b.dataset.mode] === playMode));
        document.querySelectorAll("#viewSeg button").forEach(b => b.classList.toggle("on", SJ[b.dataset.view] === SS[subj].view));
        $("chainToggle").checked = SS[subj].chain;
        $("chainWrap").classList.toggle("hidden", !isMixMode(playMode));
    }
    $("easyToggle").checked = SS.bc.easy;
    $("easyWrap").classList.toggle("hidden", !(subj === "bc" && playMode !== "bcA"));
    $("viewSegBar").classList.toggle("hidden", !(subj !== "rx" && currentPage !== "game"));
    const vm = MODES[viewMode()];
    document.querySelectorAll(".u").forEach(e => { e.textContent = vm.unit; });
    document.querySelectorAll(".uTotal").forEach(e => { e.textContent = vm.items.length; });
}

function setPlay(m) {
    clearTimeout(advanceTimeout);
    returnCurrentToDeck();
    pauseTimer();
    playMode = m;
    APP.subject = subjOf(m);
    if (APP.subject !== "rx") {
        SS[APP.subject].play = m;
        if (!isMixMode(m)) SS[APP.subject].view = m;
    }
    store = STORES[recMode(m)];
    isReviewMode = false;
    chainNext = null;
    current = null;
    answered = false;
    currentFromDeck = false;
    const s = S(m);
    if (dirty.has(m) || (!s.deck.length && !s.deckA.length && !s.deckB.length)) { dirty.delete(m); buildDeck(m); }
    saveStore();
}
function switchSubject(sub) {
    if (APP.subject === sub || !SUBJECTS[sub]) return;
    setPlay(sub === "rx" ? "rx" : SS[sub].play);
    nextQuestion();
    showPage(currentPage);
}
function toggleMode() {
    if (!isReviewMode && !reviewCount()) { alert("아직 틀린 문제가 없습니다! 문제를 더 풀어보세요."); return; }
    if (!isReviewMode) returnCurrentToDeck();
    isReviewMode = !isReviewMode;
    chainNext = null;
    if (!isReviewMode && dirty.has(playMode)) { dirty.delete(playMode); buildDeck(); }
    nextQuestion();
}
function startReview(m = viewMode()) {
    if (!wrongCount(m)) return;
    if (playMode !== m) setPlay(m); else returnCurrentToDeck();
    isReviewMode = true;
    nextQuestion();
    location.hash = "#game";
}
function askSpecific(name, m = viewMode()) {
    const item = MODES[m].byName[name];
    if (!item) return;
    const sameMix = isMixMode(playMode) && recModes(playMode).includes(m);
    if (playMode !== m && !sameMix) setPlay(m);
    else {
        if (dirty.has(playMode) && !isReviewMode) { dirty.delete(playMode); buildDeck(); }
        else returnCurrentToDeck();
    }
    forcedNext = item;
    nextQuestion();
    location.hash = "#game";
}
function markDirty(subject) {
    const modes = subject === "rx" ? ["rx"] : [SUBJECTS[subject].A, SUBJECTS[subject].B, SUBJECTS[subject].mix];
    modes.forEach(m => dirty.add(m));
}
function markRangeChanged(subject) {
    markDirty(subject);
    if (currentPage === "game" && !isReviewMode && subjOf(playMode) === subject) {
        dirty.delete(playMode);
        buildDeck();
        nextQuestion();
    }
    updateStatus();
    if (currentPage === "range") renderRangeCounts();
}
function setRangeMode(range, m = viewMode()) {
    if (!RANGE_LABEL[range] || range === rangeOf(m)) return;
    setRangeValue(m, range);
    saveStore();
    markRangeChanged(subjOf(m));
}

// =====================================================================
//  페이지 전환
// =====================================================================
function showPage(page) {
    if (!PAGES.includes(page)) page = "game";
    const prev = currentPage;
    currentPage = page;
    document.querySelectorAll(".page").forEach(s => s.classList.toggle("hidden", s.id !== "page-" + page));
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.page === page));
    renderLayout();
    updateStatus();
    if (page === "game") {
        if (dirty.has(playMode) && !isReviewMode) { dirty.delete(playMode); buildDeck(); nextQuestion(); }
        else if (!current && !answered) nextQuestion();
        else {
            if (current) setControls();
            if (!answered && current && timerInterval === null) runTimer();
        }
        focusSearch();
    } else {
        if (prev === "game") pauseTimer();
        if (page === "range") renderRangePage();
        if (page === "wrong") renderWrongPage();
        if (page === "memo") renderMemoPage();
        if (page === "star") renderStarPage();
    }
    window.scrollTo(0, 0);
}

// =====================================================================
//  출제 범위 페이지
// =====================================================================
function renderRangePage() {
    if (APP.subject !== "rx") renderChapters();
    renderRangeCounts();
    renderRxGrid();
}
function chapterStats(sj, ch) {
    if (sj === "bc") {
        const herbs = ch.groups.reduce((s, g) => s + g.ings.length, 0);
        return `${ch.reading} · 분류 ${ch.groups.length} · 약물 ${herbs}`;
    }
    const a = crItemsA.filter(i => i.chapter === ch.no).length, b = crItemsB.filter(i => i.chapter === ch.no).length;
    return `주제 ${ch.topics.length} · A ${a} · B ${b}`;
}
function renderChapters() {
    const sj = APP.subject;
    const SJ = SUBJECTS[sj];
    const grid = $("chapterGrid");
    grid.innerHTML = "";
    $("chapterWord").textContent = SJ.chapterWord;
    SJ.chapters.forEach(ch => {
        const on = SS[sj].chapters.includes(ch.no);
        const el = document.createElement("label");
        el.className = "chapter-item" + (on ? "" : " off");
        el.innerHTML = `<input type="checkbox"${on ? " checked" : ""}><span>${ch.no}. ${esc(ch.name)}<br><small>${chapterStats(sj, ch)}</small></span>`;
        el.querySelector("input").addEventListener("change", e => {
            setChapters(e.target.checked ? [...SS[sj].chapters, ch.no] : SS[sj].chapters.filter(n => n !== ch.no));
        });
        grid.appendChild(el);
    });
    $("chapterCount").textContent = SS[sj].chapters.length;
    $("chapterTotal").textContent = SJ.chapters.length;
}
function setChapters(list) {
    const sj = APP.subject;
    SS[sj].chapters = uniq(list).sort((a, b) => a - b);
    saveStore();
    markRangeChanged(sj);
    renderChapters();
    renderRxGrid();
}
function renderRangeCounts() {
    const m = viewMode();
    const st = STORES[m];
    Object.keys(RANGE_LABEL).forEach(r => {
        $("cnt-" + r).textContent = getPool(r, m).length;
        const card = document.querySelector(`.mode-card[data-mode="${r}"]`);
        card.classList.toggle("selected", r === rangeOf(m));
        card.querySelector("input").checked = r === rangeOf(m);
    });
    $("masteredCount").textContent = st.mastered.size;
    $("excludedCount").textContent = st.excluded.size;
    $("memoCountRange").textContent = memoCount(m);
    $("excludeHint").classList.toggle("hidden", !(st.excluded.size && rangeOf(m) !== "noExcluded"));
    const n = MODES[m].items.length;
    $("numFrom").max = n;
    $("numTo").max = n;
    if (Number($("numTo").value) > n || $("numTo").dataset.mode !== m) { $("numTo").value = n; $("numTo").dataset.mode = m; }
}
function rxMatches(item, kw) {
    return !kw || item.keys.some(k => k.includes(kw)) || (item.chos || [item.cho]).some(c => c.includes(kw)) || String(item.no) === kw;
}
function visibleRx() {
    const kw = norm($("rxSearch").value);
    return MODES[viewMode()].items.filter(p => rxMatches(p, kw));
}
function itemSubline(item) {
    if (item.mode === "rx") return `${item.reading}${item.alias ? " · " + item.alias : ""}`;
    if (item.mode === "bcA") return `${item.reading} · ${item.big.name}`;
    if (item.mode === "bcB") return `${item.reading}${item.alias ? " · " + item.alias : ""} · ${item.group.name}`;
    if (item.mode === "crA") return `${item.topic.name} · ${item.ings.length}개`;
    return `${item.topic.name} → ${item.answers.map(i => item.topic.groups[i].name).join(" · ")}`;
}
function renderRxGrid() {
    const m = viewMode();
    const st = STORES[m];
    const sj = subjOf(m);
    const grid = $("rxGrid");
    grid.innerHTML = "";
    const list = visibleRx();
    if (!list.length) { grid.innerHTML = '<div class="empty-state">검색 결과가 없습니다.</div>'; return; }
    const frag = document.createDocumentFragment();
    list.forEach(p => {
        const ex = st.excluded.has(p.name);
        const outChapter = sj !== "rx" && !SS[sj].chapters.includes(p.chapter);
        const el = document.createElement("label");
        el.className = "rx-item" + (ex ? " excluded" : "");
        if (outChapter) { el.style.opacity = ".45"; el.title = "범위 밖"; }
        const starOn = hasOwn(st.starred, p.name);
        const tags = `<span class="rx-star${starOn ? " on" : ""}" title="별표">${starOn ? "★" : "☆"}</span>` +
                     (hasOwn(st.memorized, p.name) ? '<span class="tag memo">암기</span>' : "") +
                     (st.mastered.has(p.name) ? '<span class="tag ok">맞힘</span>' : "") +
                     (st.wrong[p.name] ? '<span class="tag bad">오답</span>' : "");
        el.innerHTML = `<input type="checkbox"${ex ? " checked" : ""}><span class="rx-no">${p.no}</span>` +
            `<span class="rx-text"><span class="rx-name">${esc(p.label)}</span><span class="rx-reading">${esc(itemSubline(p))}</span></span>${tags}`;
        el.querySelector("input").addEventListener("change", e => {
            el.classList.toggle("excluded", e.target.checked);
            setExcluded([p.name], e.target.checked, m);
        });
        const star = el.querySelector(".rx-star");
        star.addEventListener("click", e => {
            e.preventDefault(); e.stopPropagation();
            toggleStar(p.name, m);
            const on = hasOwn(st.starred, p.name);
            star.classList.toggle("on", on);
            star.textContent = on ? "★" : "☆";
            renderRangeCounts();
        });
        frag.appendChild(el);
    });
    grid.appendChild(frag);
}
function setExcluded(names, flag, m = viewMode()) {
    const st = STORES[m];
    names.forEach(n => flag ? st.excluded.add(n) : st.excluded.delete(n));
    saveStore();
    if (rangeOf(m) === "noExcluded") markRangeChanged(subjOf(m));
    else if (currentPage === "range") renderRangeCounts();
}
function bulkByNumber(flag) {
    const items = MODES[viewMode()].items;
    let a = parseInt($("numFrom").value, 10), b = parseInt($("numTo").value, 10);
    if (isNaN(a) || isNaN(b)) { alert("번호를 입력해주세요."); return; }
    if (a > b) [a, b] = [b, a];
    a = Math.max(1, a); b = Math.min(items.length, b);
    setExcluded(items.filter(p => p.no >= a && p.no <= b).map(p => p.name), flag);
    renderRxGrid();
}
function resetMastered() {
    const m = viewMode();
    const st = STORES[m];
    if (!st.mastered.size) return;
    if (!confirm(`맞힌 기록 ${st.mastered.size}개를 초기화할까요?\n('맞힌 것 제외' 범위에 다시 포함됩니다)`)) return;
    st.mastered.clear();
    saveStore();
    if (rangeOf(m) === "noMastered") markRangeChanged(subjOf(m)); else renderRangeCounts();
    renderRxGrid();
}

// =====================================================================
//  오답 노트 · 암기 완료 · 별표 공통 카드
// =====================================================================
function fmtDate(t) {
    if (!t) return "이전 기록";
    return new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function buildRxCard(p, { extraClass = "", meta = "", actions = [], onStar = null }) {
    const m = p.mode;
    const card = document.createElement("div");
    card.className = "wrong-card " + extraClass;
    const st = isStarred(p.name, m);
    let sub, chips, memo = "", icon = "💡";
    const chipOf = (h, r) => `<span class="chip">${esc(h)}${r && r !== h ? ` <em>${esc(r)}</em>` : ""}</span>`;
    if (m === "rx") {
        sub = `${p.reading}${p.alias ? " · 이명 " + p.alias : ""} · 약재 ${p.ings.length}가지`;
        chips = p.ings.map(h => chipOf(h, READING[h])).join("");
        memo = p.memo;
    } else if (m === "bcA") {
        sub = `${p.reading} · ${p.big.name} · 약물 ${p.ings.length}가지`;
        chips = p.ings.map(h => chipOf(h, HERB[h].reading)).join("");
        memo = p.desc; icon = "📝";
    } else if (m === "bcB") {
        sub = `${p.reading}${p.alias ? " · 異名 " + p.alias : ""}`;
        chips = `<span class="chip">${p.group.big.name} › ${p.group.name} <em>${p.group.reading}</em></span>`;
    } else if (m === "crA") {
        sub = `${p.topic.unit.no}. ${p.topic.unit.name} · ${p.topic.name} · ${p.ings.length}개`;
        chips = p.ings.map(h => chipOf(h, crTerm(h).reading)).join("");
        memo = p.memo;
    } else {
        sub = `${p.reading && p.reading !== p.label ? p.reading + " · " : ""}${p.topic.name}`;
        chips = p.answers.map(i => chipOf(p.topic.groups[i].name, p.topic.groups[i].reading)).join("");
        memo = p.topic.memo;
    }
    card.innerHTML =
        `<div class="wc-head"><div><div class="wc-name"><button class="star-btn small${st ? "" : " off"}" title="별표">${st ? "★" : "☆"}</button>${p.no}. ${esc(p.label)}</div>` +
        `<div class="wc-reading">${esc(sub)}</div></div><div class="wc-meta">${meta}</div></div>` +
        `<div class="wc-chips">${chips}</div><div class="wc-reveal-hint">👆 눌러서 정답 보기</div>` +
        (memo ? `<div class="wc-memo">${icon} ${esc(memo)}</div>` : "") + `<div class="wc-actions"></div>`;
    const reveal = () => card.classList.add("revealed");
    card.querySelectorAll(".wc-chips, .wc-reveal-hint, .wc-memo").forEach(el => el.addEventListener("click", reveal));
    const starBtn = card.querySelector(".wc-name .star-btn");
    starBtn.onclick = () => {
        toggleStar(p.name, m);
        if (onStar) onStar();
        else { const on = isStarred(p.name, m); starBtn.textContent = on ? "★" : "☆"; starBtn.classList.toggle("off", !on); }
    };
    const box = card.querySelector(".wc-actions");
    actions.forEach(a => {
        const b = document.createElement("button");
        b.className = "small-btn " + (a.cls || "");
        b.textContent = a.label;
        b.onclick = a.fn;
        box.appendChild(b);
    });
    return card;
}

function renderWrongPage() {
    const m = viewMode();
    const st = STORES[m];
    const byName = MODES[m].byName;
    const names = Object.keys(st.wrong);
    const listEl = $("wrongList");
    listEl.classList.toggle("hide-ings", $("hideIngs").checked);
    $("startReviewBtn").disabled = !names.length;
    $("clearWrongBtn").disabled = !names.length;
    if (!names.length) {
        $("wrongSummary").textContent = "";
        listEl.innerHTML = '<div class="empty-state">🎉 오답 노트가 비어 있습니다.<br>틀린 문제가 생기면 여기에 모두 모입니다.</div>';
        return;
    }
    const totalWrong = names.reduce((s, n) => s + st.wrong[n].count, 0);
    $("wrongSummary").textContent = `틀린 ${MODES[m].unit} ${names.length}개 · 누적 오답 ${totalWrong}회 · 다시 맞히면 자동으로 빠집니다`;
    const sort = $("wrongSort").value;
    names.sort((a, b) => {
        const A = st.wrong[a], B = st.wrong[b];
        if (sort === "count" && B.count !== A.count) return B.count - A.count;
        if (sort === "recent" && B.last !== A.last) return B.last - A.last;
        return byName[a].no - byName[b].no;
    });
    listEl.innerHTML = "";
    names.forEach(n => {
        const w = st.wrong[n];
        listEl.appendChild(buildRxCard(byName[n], {
            meta: `❌ ${w.count}회<br>${fmtDate(w.last)}`,
            actions: [
                { label: "다시 풀기", cls: "primary", fn: () => askSpecific(n, m) },
                { label: "🧠 암기 완료", fn: () => { setMemorizedFromPage(n, true, m); renderWrongPage(); } },
                { label: "삭제", cls: "danger", fn: () => { delete st.wrong[n]; saveStore(); updateStatus(); renderWrongPage(); } }
            ]
        }));
    });
}
function clearWrong() {
    const m = viewMode();
    const st = STORES[m];
    const n = Object.keys(st.wrong).length;
    if (!n) return;
    if (!confirm(`오답 노트 ${n}개를 모두 지울까요?`)) return;
    st.wrong = {};
    saveStore();
    if (isReviewMode && !reviewCount()) {
        isReviewMode = false;
        if (dirty.has(playMode)) { dirty.delete(playMode); buildDeck(); }
        current = null; answered = false;
    }
    updateStatus();
    if (currentPage === "wrong") renderWrongPage();
}

function renderMemoPage() {
    const m = viewMode();
    const st = STORES[m];
    const byName = MODES[m].byName;
    const unit = MODES[m].unit;
    const all = Object.keys(st.memorized);
    const listEl = $("memoList");
    listEl.classList.toggle("hide-ings", $("memoHide").checked);
    $("clearMemoBtn").disabled = !all.length;
    $("playMemoBtn").disabled = !all.length;
    const range = rangeOf(m);
    const rangeNote = { all: " (전체 범위라서 암기 완료도 출제 중)", onlyMemorized: " (암기 완료만 출제 중)" }[range] || " (출제 안 됨)";
    $("memoSummary").textContent = all.length ? `암기 완료 ${all.length}개 / ${MODES[m].items.length} · 현재 범위 '${RANGE_LABEL[range]}'${rangeNote}` : "";
    if (!all.length) {
        listEl.innerHTML = `<div class="empty-state">아직 암기 완료한 ${unit}이 없습니다.<br>게임 중 <b>🧠 암기</b> 버튼을 누르면 여기에 저장됩니다.</div>`;
        return;
    }
    const kw = norm($("memoSearch").value);
    const names = all.filter(n => rxMatches(byName[n], kw));
    const sort = $("memoSort").value;
    names.sort((a, b) => (sort === "recent" && st.memorized[b] !== st.memorized[a]) ? st.memorized[b] - st.memorized[a] : byName[a].no - byName[b].no);
    listEl.innerHTML = "";
    if (!names.length) { listEl.innerHTML = '<div class="empty-state">검색 결과가 없습니다.</div>'; return; }
    names.forEach(n => {
        listEl.appendChild(buildRxCard(byName[n], {
            extraClass: "memorized",
            meta: `🧠 등록<br>${fmtDate(st.memorized[n])}`,
            actions: [
                { label: "확인 삼아 풀기", cls: "primary", fn: () => askSpecific(n, m) },
                { label: "되돌리기", cls: "danger", fn: () => { setMemorizedFromPage(n, false, m); renderMemoPage(); } }
            ]
        }));
    });
}
function clearMemo() {
    const m = viewMode();
    const n = memoCount(m);
    if (!n) return;
    if (!confirm(`암기 완료 ${n}개를 모두 되돌릴까요?\n(다시 출제 대상이 됩니다)`)) return;
    STORES[m].memorized = {};
    saveStore();
    updateStatus();
    if (rangeOf(m) !== "all") markRangeChanged(subjOf(m));
    renderMemoPage();
}
function playWithRange(range) {
    const m = viewMode();
    if (!getPool(range, m).length) {
        alert(range === "onlyStarred" ? "출제할 별표 문제가 없습니다. (암기 완료한 것은 '별표만' 범위에서 빠집니다)" : "출제할 문제가 없습니다.");
        return;
    }
    setRangeValue(m, range);
    saveStore();
    markDirty(subjOf(m));
    if (playMode !== m) setPlay(m); else { returnCurrentToDeck(); isReviewMode = false; }
    current = null; answered = false;
    if (location.hash === "#game") showPage("game"); else location.hash = "#game";
}
const playMemorized = () => playWithRange("onlyMemorized");
const playStarred = () => playWithRange("onlyStarred");

function renderStarPage() {
    const m = viewMode();
    const st = STORES[m];
    const byName = MODES[m].byName;
    const unit = MODES[m].unit;
    const all = Object.keys(st.starred);
    const listEl = $("starList");
    listEl.classList.toggle("hide-ings", $("starHide").checked);
    $("clearStarBtn").disabled = !all.length;
    $("playStarBtn").disabled = !getPool("onlyStarred", m).length;
    const memoStarred = all.filter(n => hasOwn(st.memorized, n)).length;
    $("starSummary").textContent = all.length ? `별표 ${all.length}개` + (memoStarred ? ` · 그중 암기 완료 ${memoStarred}개는 '별표만' 범위에서 빠짐` : "") : "";
    if (!all.length) {
        listEl.innerHTML = `<div class="empty-state">아직 별표한 ${unit}이 없습니다.<br>게임 중 이름 옆 <b>☆</b>를 누르면 여기에 모입니다.</div>`;
        return;
    }
    const kw = norm($("starSearch").value);
    const names = all.filter(n => rxMatches(byName[n], kw));
    const sort = $("starSort").value;
    names.sort((a, b) => (sort === "recent" && st.starred[b] !== st.starred[a]) ? st.starred[b] - st.starred[a] : byName[a].no - byName[b].no);
    listEl.innerHTML = "";
    if (!names.length) { listEl.innerHTML = '<div class="empty-state">검색 결과가 없습니다.</div>'; return; }
    names.forEach(n => {
        const status = [hasOwn(st.memorized, n) ? "🧠 암기 완료" : "", st.wrong[n] ? `❌ 오답 ${st.wrong[n].count}회` : "", st.mastered.has(n) ? "✅ 맞힘" : ""].filter(Boolean).join("<br>");
        listEl.appendChild(buildRxCard(byName[n], {
            extraClass: "starred-card",
            meta: `⭐ ${fmtDate(st.starred[n])}` + (status ? "<br>" + status : ""),
            onStar: renderStarPage,
            actions: [{ label: "풀기", cls: "primary", fn: () => askSpecific(n, m) }]
        }));
    });
}
function clearStars() {
    const m = viewMode();
    const n = starCount(m);
    if (!n) return;
    if (!confirm(`별표 ${n}개를 모두 해제할까요?`)) return;
    STORES[m].starred = {};
    saveStore();
    updateStatus();
    if (rangeOf(m) === "onlyStarred") markDirty(subjOf(m));
    renderStarPage();
}

// =====================================================================
//  백업 / 불러오기 (따로 열었을 때만. 앱 안에서는 앱 기록에 함께 저장됨)
// =====================================================================
function exportData() {
    const data = { app: "shanghan113", version: 5, exportedAt: new Date().toISOString(), values: allValues() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `한의학습_게임기록_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
        let data;
        try { data = JSON.parse(reader.result); } catch (e) { alert("백업 파일을 읽을 수 없습니다."); return; }
        if (!data || data.app !== "shanghan113") { alert("이 게임의 백업 파일이 아닙니다."); return; }
        let vals;
        if (data.values) vals = data.values;
        else if (Number(data.version) >= 4) vals = { [MODES.rx.storeKey]: data.rx, [MODES.bcA.storeKey]: data.bcA, [MODES.bcB.storeKey]: data.bcB, boncho_settings_v1: data.bcSettings, [APP_KEY]: data.appSettings };
        else vals = { [MODES.rx.storeKey]: data };
        if (!confirm("백업을 불러오면 지금 게임 기록을 덮어씁니다. 계속할까요?")) return;
        if (HSTATE) {
            const changes = {};
            const now = Date.now();
            for (const [k, v] of Object.entries(vals)) if (v) { HSTATE[k] = { u: now, v }; lastSent[k] = JSON.stringify(v); changes[k] = HSTATE[k]; }
            try { HOST.post({ type: "hanui-game:save", changes }); } catch (e) {}
            setTimeout(() => location.reload(), 300);
            return;
        }
        try { for (const [k, v] of Object.entries(vals)) if (v) localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
        location.reload();
    };
    reader.readAsText(file);
}

// ---------- 앱이 보낸 새 기록 (다른 기기에서 푼 것) ----------
function applyHostState(state) {
    if (!HSTATE || !state) return;
    let changed = false;
    for (const [k, e] of Object.entries(state)) {
        if (!e || typeof e.u !== "number") continue;
        if (!HSTATE[k] || e.u > HSTATE[k].u) { HSTATE[k] = e; lastSent[k] = JSON.stringify(e.v); changed = true; }
    }
    if (!changed) return;
    const keepSubject = APP.subject, keepPlay = playMode;
    loadAll();
    BCS = SS.bc;
    APP.subject = keepSubject;
    if (keepSubject !== "rx") SS[keepSubject].play = keepPlay;
    store = STORES[recMode(playMode)];
    ["rx", "bc", "cr"].forEach(markDirty);
    dirty.delete(playMode);
    updateStatus();
    if (currentPage !== "game") showPage(currentPage);
    else if (current) { renderStarBtn(); setControls(); }
}

// =====================================================================
//  이벤트
// =====================================================================
function init() {
    validateData();
    if (HOST) $("backupText").textContent = "💾 게임 기록은 앱 계정에 함께 저장됩니다. 예전 게임 파일(html)에서 '백업 파일 저장'으로 받은 기록을 옮기려면:";

    const pot = $("pot");
    pot.addEventListener("dragover", e => { e.preventDefault(); pot.classList.add("drag-over"); });
    pot.addEventListener("dragleave", () => pot.classList.remove("drag-over"));
    pot.addEventListener("drop", e => {
        e.preventDefault();
        pot.classList.remove("drag-over");
        const data = e.dataTransfer.getData("text/plain");
        if (data.startsWith("combo:")) {
            const c = COMBOS.find(x => x.id === data.slice(6));
            if (c && potSubj() === "rx" && !comboHidden(c)) selectItem({ type: "combo", d: c }, true);
        } else addToPot(data);
        focusSearch();
    });

    const s = $("searchInput");
    s.addEventListener("input", renderIngredients);
    s.addEventListener("focus", () => {
        // 폰: 자판이 올라와도 문제·넣은 것·검색창·결과가 한 화면에 보이도록 문제를 화면 맨 위로
        if (!isNarrow()) return;
        document.body.classList.add("typing");
        setTimeout(() => $("potTarget").scrollIntoView({ block: "start", behavior: "smooth" }), 250);
    });
    s.addEventListener("blur", () => {
        setTimeout(() => { if (document.activeElement !== s) document.body.classList.remove("typing"); }, 200);
    });
    s.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            if (e.ctrlKey || e.metaKey) return;
            if (e.isComposing) { pendingEnter = true; return; }
            if (answered) return;
            e.preventDefault();
            e.stopPropagation();
            commitSearch();
            return;
        }
        if (e.isComposing) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!shelfItems.length) return;
            e.preventDefault();
            const n = shelfItems.length;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive(activeIdx < 0 ? (step > 0 ? 0 : n - 1) : (activeIdx + step + n) % n);
        } else if (e.key === "Escape") {
            e.preventDefault();
            s.value = "";
            renderIngredients();
        } else if (e.key === "Backspace" && s.value === "" && selectedInPot.length && !answered) {
            e.preventDefault();
            removeFromPot(selectedInPot[selectedInPot.length - 1]);
        }
    });
    s.addEventListener("compositionend", () => {
        if (!pendingEnter) return;
        pendingEnter = false;
        setTimeout(() => {
            if (answered) { if (current) nextQuestion(); return; }
            renderIngredients();
            commitSearch();
        }, 0);
    });

    document.addEventListener("keydown", e => {
        if (currentPage !== "game") return;
        const t = e.target;
        const typing = t.tagName === "TEXTAREA" || t.tagName === "SELECT" ||
            (t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(t.type));
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyS") {
            e.preventDefault();
            if (current) toggleStar(current.name, current.mode);
            return;
        }
        if (curKind() === "choice") {
            if (e.key === "Enter" && !e.isComposing) {
                if (answered && current) { e.preventDefault(); nextQuestion(); }
                else if (current && current.mode === "crB" && bSel.length) { e.preventDefault(); submitMulti(); }
                return;
            }
            if (typing || e.ctrlKey || e.metaKey || e.altKey || answered || !current) return;
            if (/^[1-9]$/.test(e.key)) {
                const i = Number(e.key) - 1;
                if (current.mode === "crB") { if (current.topic.groups[i]) { e.preventDefault(); toggleMulti(i); } }
                else if (SS.bc.easy) { if (bOptions[i]) { e.preventDefault(); pickB(bOptions[i]); } }
                else if (bStep === "sub") { const g = BIG_BY_NO[bBig].groups[i]; if (g) { e.preventDefault(); pickB(g.code); } }
            } else if ((e.key === "Escape" || e.key === "Backspace") && bStep === "sub" && current.mode === "bcB") {
                e.preventDefault();
                backToBig();
            }
            return;
        }
        if (e.key === "Enter") {
            if (e.isComposing) return;
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (answered) { if (current) nextQuestion(); } else checkAnswer();
                return;
            }
            if (answered && current && !(t.tagName === "BUTTON")) { e.preventDefault(); nextQuestion(); }
            return;
        }
        if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key.length === 1 || e.key === "Process" || e.key === "Backspace" || e.key === "ArrowDown" || e.key === "ArrowUp") s.focus();
    });

    const withFocus = fn => () => { fn(); focusSearch(); };
    const giveUp = () => finishQuestion(true, "🤔 정답을 확인해 보세요.");
    $("submitBtn").onclick = withFocus(checkAnswer);
    $("resetBtn").onclick = withFocus(resetPot);
    $("giveUpBtn").onclick = withFocus(giveUp);
    $("bGiveUpBtn").onclick = giveUp;
    $("nextBtn").onclick = () => nextQuestion();
    $("bNextBtn").onclick = () => nextQuestion();
    $("hintBtn").onclick = withFocus(showHint);
    $("bHintBtn").onclick = showHint;
    $("memoBtn").onclick = withFocus(memorizeCurrent);
    $("bMemoBtn").onclick = memorizeCurrent;
    $("modeToggleBtn").onclick = withFocus(toggleMode);
    $("starBtn").onclick = () => { if (current) toggleStar(current.name, current.mode); focusSearch(); };
    $("bStarBtn").onclick = () => { if (current) toggleStar(current.name, current.mode); };
    $("rangeSelectGame").onchange = e => { setRangeMode(e.target.value, recMode(playMode)); focusSearch(); };
    $("timerSelect").onchange = e => {
        const m = e.target.dataset.mode;
        const v = e.target.value;
        setTimeValue(m, v.startsWith("p") ? v : Number(v));
        saveStore();
        if (!answered && current && current.mode === m) {
            curLimit = limitFor(current);
            timeLeft = curLimit;
            if (currentPage === "game") runTimer(); else renderTimer();
        }
        focusSearch();
    };
    document.querySelectorAll("#sortSeg button").forEach(b => {
        b.onclick = () => { STORES.rx.indexSort = b.dataset.sort; saveStore(); updateStatus(); renderIngredients(); focusSearch(); };
    });

    document.querySelectorAll(".subject-btn").forEach(b => { b.onclick = () => switchSubject(b.dataset.subject); });
    document.querySelectorAll("#modeSeg button").forEach(b => {
        b.onclick = () => {
            const m = SUBJECTS[APP.subject][b.dataset.mode];
            if (!m || m === playMode) return;
            setPlay(m);
            nextQuestion();
        };
    });
    $("easyToggle").onchange = e => {
        SS.bc.easy = e.target.checked;
        saveStore();
        if (current && current.mode === "bcB" && !answered) { bOptions = SS.bc.easy ? makeOptions(current) : []; bStep = "big"; renderChoice(); }
    };
    $("chainToggle").onchange = e => {
        if (APP.subject === "rx") return;
        SS[APP.subject].chain = e.target.checked;
        if (!e.target.checked) chainNext = null;
        saveStore();
    };
    document.querySelectorAll("#viewSeg button").forEach(b => {
        b.onclick = () => {
            if (APP.subject === "rx") return;
            SS[APP.subject].view = SUBJECTS[APP.subject][b.dataset.view];
            saveStore();
            showPage(currentPage);
        };
    });

    document.querySelectorAll('input[name="rangeMode"]').forEach(r => r.addEventListener("change", e => setRangeMode(e.target.value)));
    $("chapAllBtn").onclick = () => setChapters(SUBJECTS[APP.subject].chapters.map(c => c.no));
    $("chapNoneBtn").onclick = () => setChapters([]);
    $("rxSearch").addEventListener("input", renderRxGrid);
    $("excludeVisibleBtn").onclick = () => { setExcluded(visibleRx().map(p => p.name), true); renderRxGrid(); };
    $("includeVisibleBtn").onclick = () => { setExcluded(visibleRx().map(p => p.name), false); renderRxGrid(); };
    $("excludeRangeBtn").onclick = () => bulkByNumber(true);
    $("includeRangeBtn").onclick = () => bulkByNumber(false);
    $("excludeMasteredBtn").onclick = () => {
        const st = STORES[viewMode()];
        if (!st.mastered.size) { alert("아직 맞힌 문제가 없습니다."); return; }
        setExcluded([...st.mastered], true);
        renderRxGrid();
    };
    $("resetMasteredBtn").onclick = resetMastered;
    $("startFromRangeBtn").onclick = () => {
        const m = viewMode();
        if (subjOf(m) !== "rx" && playMode !== m && !isMixMode(playMode)) setPlay(m);
        location.hash = "#game";
    };

    $("wrongSort").onchange = renderWrongPage;
    $("hideIngs").onchange = renderWrongPage;
    $("startReviewBtn").onclick = () => startReview();
    $("clearWrongBtn").onclick = clearWrong;
    $("memoSearch").addEventListener("input", renderMemoPage);
    $("memoSort").onchange = renderMemoPage;
    $("memoHide").onchange = renderMemoPage;
    $("clearMemoBtn").onclick = clearMemo;
    $("playMemoBtn").onclick = playMemorized;
    $("exportBtn").onclick = exportData;
    $("importBtn").onclick = () => $("importFile").click();
    $("importFile").onchange = e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; };
    $("starSearch").addEventListener("input", renderStarPage);
    $("starSort").onchange = renderStarPage;
    $("starHide").onchange = renderStarPage;
    $("playStarBtn").onclick = playStarred;
    $("clearStarBtn").onclick = clearStars;

    document.querySelectorAll(".tab").forEach(t => {
        t.onclick = () => {
            if (location.hash === "#" + t.dataset.page) showPage(t.dataset.page);
            else location.hash = "#" + t.dataset.page;
        };
    });
    window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));
    window.addEventListener("resize", () => { if (current) setControls(); });

    if (HOST) {
        window.addEventListener("message", e => {
            if (e.origin !== location.origin || e.source !== window.parent) return;
            const m = e.data || {};
            if (m.type === "hanui-game:state") applyHostState(m.state);
            else if (m.type === "hanui-game:theme") applyTheme(m.theme);
        });
    }

    const initial = location.hash.slice(1);
    currentPage = PAGES.includes(initial) ? initial : "game";
    buildDeck();
    nextQuestion();
    showPage(currentPage);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
