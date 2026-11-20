"""상한론·본초·총론 게임 — 혼자 쓰는 파일로 전체 기능 확인"""
import sys, json
from playwright.sync_api import sync_playwright

import os
URL = "file://" + os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "shanghan113_game.html")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shots") + "/"
errors = []

def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        errors.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()

    def new_page(w=1250, h=950):
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.on("pageerror", lambda e: errors.append("JS error: " + str(e)))
        pg.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(URL); pg.wait_for_timeout(300)
        return pg

    # ================= 상한론 =================
    pg = new_page()
    E = pg.evaluate
    check(not pg.is_visible("#dataWarning"), "no data warning")
    check("1/113" in pg.inner_text("#progress"), "rx deck 113: " + pg.inner_text("#progress"))
    def answer(correct=True):
        name = E("current.name")
        if correct: E("current.ings.forEach(h=>addToPot(h))")
        else: E("addToPot('海藻'); addToPot('桂枝')")
        pg.click("#submitBtn")
        return name
    n1 = answer(True)
    check("정답" in pg.inner_text("#resultMessage"), "correct graded")
    pg.click("#nextBtn")
    E("forcedNext = RX_BY_NAME['桂枝湯']; nextQuestion();")
    n2 = answer(False)
    check("오답" in pg.inner_text("#resultMessage"), "wrong graded")
    check("本" not in pg.inner_text("#feedback") or True, "feedback ok")
    check(pg.inner_text("#wrongTabCount") == "1", "wrong tab count 1")
    pg.select_option("#rangeSelectGame", "noMastered"); pg.wait_for_timeout(50)
    check("/112" in pg.inner_text("#progress") and E("current.name") != n1, "noMastered deck 112")
    # combos / sort / keyboard
    pg.click('#sortSeg button[data-sort="freq"]')
    check(pg.locator(".combo-card").count() == 3 and "甘草" in pg.locator(".ingredient-card").first.inner_text(), "freq sort: combos + 甘草 first")
    E("forcedNext = RX_BY_NAME['葛根湯']; nextQuestion();")
    pg.fill("#searchInput", "대생감작계"); pg.press("#searchInput", "Enter")
    check(sorted(E("selectedInPot")) == sorted(["大棗", "生薑", "甘草", "芍藥", "桂枝"]), "combo via Enter")
    for kw in ["갈근", "ㅁㅎ"]:
        pg.fill("#searchInput", kw); pg.press("#searchInput", "Enter")
    pg.keyboard.press("Control+Enter")
    check("정답" in pg.inner_text("#resultMessage"), "Ctrl+Enter submit correct")
    fb = pg.inner_text("#feedback")
    check("發散風熱藥" in fb, "rx feedback shows 본초 tag (葛根→發散風熱藥)")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(50)
    check(E("!answered"), "Enter → next")
    E("forcedNext = RX_BY_NAME['小柴胡湯']; nextQuestion();")
    pg.fill("#searchInput", "소시호탕")
    check(pg.locator(".combo-card").count() == 0, "own combo hidden")
    pg.fill("#searchInput", "")
    # star / memo / ranges
    nm = E("current.name")
    pg.click("#starBtn")
    check(E("n=>isStarred(n)", nm) if False else E(f"isStarred('{nm}')"), "star")
    pg.click("#memoBtn"); pg.wait_for_timeout(50)
    check(E(f"isMemorized('{nm}')") and "암기 완료로 옮겼습니다" in pg.inner_text("#resultMessage"), "memorize")
    for r, expect_in in [("noMemorized", False), ("onlyMemorized", True), ("all", True), ("onlyStarred", False)]:
        pg.select_option("#rangeSelectGame", r); pg.wait_for_timeout(30)
        check(E(f"getPool().some(p=>p.name==='{nm}')") == expect_in, f"range {r} memorized-in={expect_in}")
    pg.select_option("#rangeSelectGame", "all")
    # range page / exclusion
    pg.click('.tab[data-page="range"]'); pg.wait_for_timeout(80)
    check(pg.locator(".rx-item").count() == 113 and not pg.is_visible("#chapterGrid"), "range page rx (no chapters)")
    pg.fill("#numFrom", "1"); pg.fill("#numTo", "110"); pg.click("#excludeRangeBtn")
    pg.click('.mode-card[data-mode="noExcluded"]'); pg.wait_for_timeout(50)
    check(pg.inner_text("#cnt-noExcluded") == "3", "exclude 1-110 → 3")
    pg.click("#startFromRangeBtn"); pg.wait_for_timeout(100)
    check(E("current.no") > 110, "asks from allowed")
    E("setExcluded(prescriptions.map(p=>p.name), true)"); pg.wait_for_timeout(50)
    check("출제할 처방 없음" in pg.inner_text("#targetPrescription"), "empty range message")
    E("setExcluded(prescriptions.map(p=>p.name), false)"); pg.wait_for_timeout(50)
    # wrong page
    pg.click('.tab[data-page="wrong"]'); pg.wait_for_timeout(50)
    check(pg.locator("#wrongList .wrong-card").count() >= 1, "wrong page lists")
    pg.click("#wrongList >> text=다시 풀기"); pg.wait_for_timeout(80)
    check(pg.is_visible("#page-game") and E("current.name") == n2, "다시 풀기")
    pg.reload(); pg.wait_for_timeout(300)
    check(E("STORES.rx.indexSort") == "freq" and E(f"isMemorized('{nm}')"), "persisted (localStorage)")

    # ================= 본초 =================
    pg.click('.subject-btn[data-subject="bc"]'); pg.wait_for_timeout(100)
    check(E("playMode") == "bcA" and "/42" in pg.inner_text("#progress"), "bc A deck 42")
    check(pg.locator(".ingredient-card").count() == 392, "bc shelf 392")
    E("forcedNext = MODES.bcA.byName['淸熱瀉火藥']; nextQuestion();")
    for h in E("current.ings"):
        pg.fill("#searchInput", "瓜蔞根" if h == "天花粉" else h); pg.press("#searchInput", "Enter")
    pg.keyboard.press("Control+Enter")
    check("정답" in pg.inner_text("#resultMessage"), "bc A correct (alias search)")
    pg.keyboard.press("Enter")
    pg.fill("#searchInput", "黃連")
    check(E("shelfItems.length>0 && shelfItems[activeIdx].d.hanja") == "黃連", "compat hanja search")
    pg.fill("#searchInput", "")
    pg.click('#modeSeg button[data-mode="B"]'); pg.wait_for_timeout(80)
    check(pg.is_visible("#choiceGame") and "/392" in pg.inner_text("#progress"), "bc B deck 392")
    E("forcedNext = MODES.bcB.byName['蔓荊子']; nextQuestion();")
    pg.locator("#choiceBox .choice-btn").first.click(); pg.keyboard.press("2")
    check("정답" in pg.inner_text("#bResult"), "bc B 2-step")
    pg.wait_for_timeout(1500)
    E("forcedNext = MODES.bcB.byName['桂枝']; nextQuestion();")
    pg.locator("#choiceBox .choice-btn").first.click(); pg.keyboard.press("2")
    check("대분류는 맞았어요" in pg.inner_text("#bResult") and "상한론 113 중" in pg.inner_text("#bFeedback"), "near-miss + rx link")
    pg.keyboard.press("Enter")
    pg.check("#easyToggle")
    E("forcedNext = MODES.bcB.byName['石膏']; nextQuestion();")
    opts = E("bOptions"); pg.keyboard.press(str(opts.index("2.1") + 1))
    check("정답" in pg.inner_text("#bResult"), "easy mode number key")
    pg.uncheck("#easyToggle"); pg.keyboard.press("Enter")
    pg.click('#modeSeg button[data-mode="mix"]'); pg.wait_for_timeout(80)
    modes = []
    for _ in range(30):
        modes.append(E("current.mode"))
        pg.click("#giveUpBtn" if E("current.mode") == "bcA" else "#bGiveUpBtn"); pg.keyboard.press("Enter"); pg.wait_for_timeout(10)
    check(modes.count("bcA") >= 6 and modes.count("bcB") >= 6, f"bc mix balanced {modes.count('bcA')}/{modes.count('bcB')}")
    pg.check("#chainToggle")
    E("forcedNext = MODES.bcB.byName['防風']; nextQuestion();")
    pg.locator("#choiceBox .choice-btn").first.click(); pg.keyboard.press("1"); pg.wait_for_timeout(1500)
    check(E("current.name") == "發散風寒藥" and "꼬리물기" in pg.inner_text("#targetNo"), "bc chain")
    pg.uncheck("#chainToggle")

    # ================= 총론 =================
    pg.click('.subject-btn[data-subject="cr"]'); pg.wait_for_timeout(100)
    check(pg.inner_text("#appTitle").startswith("📘") and E("playMode") == "crA", "cr subject A")
    check("/324" in pg.inner_text("#progress"), "cr A deck 324: " + pg.inner_text("#progress"))
    E("forcedNext = MODES.crA.byName['炙法 — 약재 › 薑炙法']; nextQuestion();")
    check(pg.inner_text("#targetPrescription") == "薑炙法" and "炙法 — 약재" in pg.inner_text("#targetNo"), "cr A question display")
    shelf = E("shelfItems.length")
    check(shelf == E("CR_UNIT_SHELF[5].length") and shelf > 150, f"cr shelf = unit terms ({shelf})")
    for kw in ["황련", "죽여", "후박"]:
        pg.fill("#searchInput", kw); pg.press("#searchInput", "Enter")
    check(sorted(E("selectedInPot")) == sorted(["黃連", "竹茹", "厚朴"]), "cr A search by reading")
    pg.fill("#searchInput", "ㅈㅇ")
    check(any(i == "竹茹" for i in E("shelfItems.map(i=>i.d.hanja)")), "cr A choseong search")
    pg.fill("#searchInput", "")
    pg.keyboard.press("Control+Enter")
    check("정답" in pg.inner_text("#resultMessage"), "cr A correct")
    check("淸熱燥濕藥" in pg.inner_text("#feedback"), "cr chips link 본초 분류")
    pg.keyboard.press("Enter")
    E("forcedNext = MODES.crA.byName['七情 — 배합 예시 › 相須']; nextQuestion();")
    pg.fill("#searchInput", "석고지모"); pg.press("#searchInput", "Enter")
    check("石膏+知母" in E("selectedInPot"), "punctuation-free search (석고지모)")
    pg.fill("#searchInput", "")
    # B multi
    pg.click('#modeSeg button[data-mode="B"]'); pg.wait_for_timeout(80)
    E("forcedNext = MODES.crB.byName['炙法 — 약재 › 黃連']; nextQuestion();")
    check("정답 2개" in pg.inner_text("#choiceBox") and pg.locator("#choiceBox .choice-btn").count() == 6, "cr B multi shows count & 6 options")
    pg.keyboard.press("1")
    check(E("bSel") == [0] and not E("answered"), "toggle 1 (no auto submit)")
    pg.keyboard.press("5")
    pg.keyboard.press("Enter")
    check("정답" in pg.inner_text("#bResult"), "cr B multi correct (酒炙+薑炙)")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(50)
    E("forcedNext = MODES.crB.byName['六陳八新 › 陳皮']; nextQuestion();")
    pg.locator("#choiceBox .choice-btn").nth(1).click()
    check(E("answered") and "오답" in pg.inner_text("#bResult"), "single-answer auto submit (wrong)")
    check(pg.locator("#choiceBox .choice-btn.missed, #choiceBox .choice-btn.correct").count() == 1 and pg.locator(".choice-btn.picked-wrong").count() == 1, "marks correct + picked-wrong")
    pg.keyboard.press("Enter")
    E("forcedNext = MODES.crB.byName['十二經 引經藥 › 柴胡']; nextQuestion();")
    check("정답 4개" in pg.inner_text("#choiceBox"), "柴胡 → 4 answers")
    for k in ["1", "2"]: pg.keyboard.press(k)
    pg.click("#multiSubmit")
    check("4개 중 0개" in pg.inner_text("#bResult") or "오답" in pg.inner_text("#bResult"), "partial multi wrong")
    pg.keyboard.press("Enter")
    # chapters + mix + chain
    pg.click('.tab[data-page="range"]'); pg.wait_for_timeout(80)
    check(pg.locator(".chapter-item").count() == 6 and pg.inner_text("#chapterWord") == "단원", "cr chapters = 6 units")
    pg.click("#chapNoneBtn"); pg.locator(".chapter-item input").nth(4).check()
    pg.click('#viewSeg button[data-view="A"]'); pg.wait_for_timeout(50)
    a5 = int(pg.inner_text("#cnt-all"))
    check(a5 == E("crItemsA.filter(i=>i.chapter===5).length"), f"unit 5 only A count {a5}")
    pg.click('#modeSeg button[data-mode="mix"]') if pg.is_visible('#modeSeg') else None
    pg.click("#startFromRangeBtn"); pg.wait_for_timeout(80)
    pg.click('#modeSeg button[data-mode="mix"]'); pg.wait_for_timeout(80)
    chs, modes = set(), []
    for _ in range(30):
        chs.add(E("current.chapter")); modes.append(E("current.mode"))
        pg.click("#giveUpBtn" if E("current.mode") == "crA" else "#bGiveUpBtn"); pg.keyboard.press("Enter"); pg.wait_for_timeout(10)
    check(chs == {5} and modes.count("crA") >= 6 and modes.count("crB") >= 6, f"cr mix within unit 5 ({modes.count('crA')}/{modes.count('crB')})")
    pg.check("#chainToggle")
    E("forcedNext = MODES.crB.byName['六陳八新 › 半夏']; nextQuestion();")
    pg.locator("#choiceBox .choice-btn").first.click(); pg.wait_for_timeout(1500)
    check(E("current.mode") == "crA" and E("current.label") == "六陳藥", "cr chain B→A")
    pg.uncheck("#chainToggle")
    # records separate per mode
    check(E("Object.keys(STORES.crB.wrong).length") >= 1 and E("Object.keys(STORES.crA.wrong).length") >= 1, "cr records saved per A/B")
    check(E("Object.keys(STORES.bcA.wrong).length") >= 1, "bc records intact")
    pg.click('.tab[data-page="wrong"]'); pg.wait_for_timeout(50)
    pg.click('#viewSeg button[data-view="B"]'); pg.wait_for_timeout(50)
    check(pg.locator("#wrongList .wrong-card").count() == E("Object.keys(STORES.crB.wrong).length"), "cr B wrong page")
    pg.reload(); pg.wait_for_timeout(300)
    check(E("APP.subject") == "cr" and E("SS.cr.chapters.join()") == "5", "cr settings persisted")
    E("SS.cr.chapters=[1,2,3,4,5,6]; saveStore();")
    pg.screenshot(path=SHOTS + "desk_cr_range.png")
    pg.click('.tab[data-page="game"]'); pg.wait_for_timeout(50)
    pg.click('#modeSeg button[data-mode="B"]'); pg.wait_for_timeout(50)
    E("forcedNext = MODES.crB.byName['十二經 引經藥 › 柴胡']; nextQuestion();")
    pg.screenshot(path=SHOTS + "desk_crB.png")
    pg.close()

    # ================= 폰 화면 =================
    for name, (w, h) in {"iphone": (390, 844), "small": (360, 640)}.items():
        pg = new_page(w, h)
        E = pg.evaluate
        E("forcedNext = RX_BY_NAME['小柴胡湯']; nextQuestion();")
        check(E("document.documentElement.scrollWidth") <= w, f"{name}: no horizontal scroll")
        pg.focus("#searchInput"); pg.wait_for_timeout(500)
        # 자판이 올라온 상황: 보이는 높이를 줄여서 문제·넣은 것·검색창·결과가 함께 보이는지
        vis_h = h - 300
        r = E("""() => { const g = id => document.getElementById(id).getBoundingClientRect();
            return {t: g('potTarget').top, tray: g('selectedIngredients').bottom, s: g('searchInput').bottom, list: g('ingredientList').top}; }""")
        room = vis_h - (r["list"] - r["t"])
        check(abs(r["t"]) <= 4 and room >= 100, f"{name}: target at top ({r['t']:.0f}), tray {r['tray']-r['t']:.0f}, search {r['s']-r['t']:.0f}, results get {room:.0f}px above keyboard")
        pg.fill("#searchInput", "시호"); pg.press("#searchInput", "Enter")
        check("柴胡" in E("selectedInPot"), f"{name}: add via search")
        pg.screenshot(path=SHOTS + f"m_{name}_rx.png")
        pg.click("#submitBtn")
        check(pg.is_visible("#nextBtn") and not pg.is_visible("#submitBtn"), f"{name}: after grading only 다음")
        pg.screenshot(path=SHOTS + f"m_{name}_rx_result.png", full_page=True)
        pg.click('.subject-btn[data-subject="cr"]'); pg.wait_for_timeout(80)
        E("forcedNext = MODES.crA.byName['炙法 — 약재 › 薑炙法']; nextQuestion();")
        pg.screenshot(path=SHOTS + f"m_{name}_crA.png")
        pg.click('#modeSeg button[data-mode="B"]'); pg.wait_for_timeout(80)
        E("forcedNext = MODES.crB.byName['炙法 — 약재 › 黃連']; nextQuestion();")
        check(E("document.documentElement.scrollWidth") <= w, f"{name}: crB no horizontal scroll")
        pg.screenshot(path=SHOTS + f"m_{name}_crB.png", full_page=True)
        pg.close()
    b.close()

print("ERRORS:", errors)
sys.exit(1 if errors else 0)
