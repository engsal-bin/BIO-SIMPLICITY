// game_data.json(= hanui_content 'game' 행, 프로젝트 claude/hanui-content.json의 game 행)에서
// 빌드에 필요한 상한론·본초 데이터 파일(data_rx.js, data_bc.js)과 총론 원본(cr_source.txt가 없을 때)을 꺼낸다.
// 사용: node extract_base.cjs <game_data.json 또는 hanui-content 묶음 파일>
const fs = require("fs");
let j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (j.format === "hanui-content") j = JSON.parse(j.rows.find(r => r.id === "game").data);
const dump = (name, keys) => fs.writeFileSync(name,
    "// ============================ DATA START ============================\n" +
    keys.map(k => `const ${k} = ${JSON.stringify(j[k], null, 1)};`).join("\n") +
    "\n// ============================ DATA END ============================\n");
dump("data_rx.js", ["ingredientDB", "RX_RAW"]);
dump("data_bc.js", ["BC_BIG", "BC_GROUPS", "BC_ALIASES", "BC_ALIAS_READING", "RX_TO_BC", "RX_TO_BC_NOTE"]);
if (!fs.existsSync("cr_source.txt")) {
    const lines = ["# 본초 총론·치법 원본 데이터 (game_data.json에서 되살림)", ""];
    j.CR.units.forEach(u => {
        lines.push(`@ ${u.no} | ${u.name}`, "");
        j.CR.topics.filter(t => t.unit === u.no).forEach(t => {
            lines.push(`# ${t.name}${t.memo ? " | " + t.memo : ""}`);
            t.groups.forEach(g => lines.push(`## ${g.name}${g.memo ? " | " + g.memo : ""} : ${g.items.join(", ")}`));
            lines.push("");
        });
    });
    fs.writeFileSync("cr_source.txt", lines.join("\n"));
}
console.log("data_rx.js, data_bc.js" + (fs.existsSync("cr_source.txt") ? ", cr_source.txt" : "") + " 준비됨");
