# 탕전 학습 게임 소스 (hanui의 '탕전 게임' 메뉴)

상한론 113 · 본초 분류 · 본초 총론·치법 게임. **저장소에는 코드만** 있고, 게임 데이터는
Supabase `hanui_content`의 `game` 행(= 프로젝트 `claude/hanui-content.json`의 `game` 행)에만 둔다.

- `template.html` 화면·스타일, `game.js` 게임 본체 → 빌드하면 `../hanui/game.html`, `../hanui/game.js`
- 앱(app.js)이 `game.html`을 iframe으로 띄우고 `hanui-game:init`으로 데이터·기록을 넘긴다.
  게임은 `hanui-game:save`로 바뀐 기록을 돌려주고, 앱은 그것을 `S.game[키] = {u, v}`로 계정에 저장한다.

## 데이터 고치기
1. 프로젝트의 `claude/hanui-content.json`을 받아 `node extract_base.cjs hanui-content.json`
   → `data_rx.js`(상한론), `data_bc.js`(본초), `cr_source.txt`(총론 원본, 프로젝트 `claude/탕전게임_총론_원본.md`와 같음)
2. 원하는 파일을 고친다. 덩달이: `dd_rx.txt`(처방 | 문장), `dd_bc.txt`(분류코드 | 문장 | 덩달이 순서 약물), 원본 = 프로젝트 `claude/탕전게임_덩달이_원본.md`. 총론 형식: `@ 단원 | 이름` / `# 주제 | 메모` / `## 묶음 | 메모 : 항목, 항목`
3. `python3 parse_cr.py && node derive_map.cjs && node build.cjs` → `out/game_data.json`, `out/hanui/*`, `out/shanghan113_game.html`(혼자 쓰는 파일)
   독음이 없는 한자가 있으면 build가 멈춘다 → `charmap_manual.txt`에 `글자음` 형식으로 추가
4. 시험: `python3 tests/test_standalone.py`, `python3 tests/test_dd.py` (혼자 쓰는 파일), `python3 tests/test_app.py` (앱 안, Supabase 흉내)
5. 반영: `out/game_data.json`을 `{format:"hanui-content", rows:[{id:"game", data}]}` 묶음으로 만들어
   앱 '기록 → 계정·데이터 → 기록·문항 가져오기'로 올린다. 코드가 바뀌었으면 `out/hanui/game.*`를 `../hanui/`에 복사해 main에 푸시.
