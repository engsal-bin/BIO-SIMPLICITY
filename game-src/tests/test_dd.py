"""덩달이 힌트·노트, 힌트 보고 맞히면 다시 출제"""
import sys, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
URL = "file://" + os.path.join(HERE, "..", "out", "shanghan113_game.html")
SHOTS = os.path.join(HERE, "..", "shots") + "/"
errors = []
def check(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: errors.append(m)
with sync_playwright() as p:
    b = p.chromium.launch()
    def new_page(w=1250, h=950):
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.on("pageerror", lambda e: errors.append("JS error: " + str(e)))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(URL); pg.wait_for_timeout(300)
        return pg
    pg = new_page(); E = pg.evaluate
    # 상한론: 덱에서 나온 문제에 힌트 → 정답 → 맞힘 아님, 오답 노트, 다시 나옴
    name = E("current.name")
    check(E("currentFromDeck"), "deck question")
    E("forcedNext = null")
    pg.click("#hintBtn")
    ht = pg.inner_text("#hintText")
    check("다시 나와요" in ht, "hint says it will come back: " + ht[:60])
    E("current.ings.forEach(h=>addToPot(h))"); pg.click("#submitBtn")
    rm = pg.inner_text("#resultMessage")
    check("힌트" in rm and "다시" in rm, "hinted correct message: " + rm)
    check(not E(f"STORES.rx.mastered.has({name!r})"), "hinted correct not mastered")
    check(E(f"!!(STORES.rx.wrong[{name!r}] && STORES.rx.wrong[{name!r}].hint)"), "hinted correct in wrong notes with hint flag")
    check(E("S().score") == 0, "score not counted")
    pg.wait_for_timeout(2200)
    check(E("current.name") == name, "no auto-advance after hinted correct")
    seen = []
    for i in range(6):
        pg.click("#nextBtn"); seen.append(E("current.name"))
        E("current.ings.forEach(h=>addToPot(h))"); pg.click("#submitBtn")
    check(name in seen, f"hinted question came back within a few: {name} in {seen}")
    check(E(f"STORES.rx.mastered.has({name!r})") and not E(f"!!STORES.rx.wrong[{name!r}]"), "answering without hint clears it")
    # 덩달이 노트 (상한론)
    E("forcedNext = RX_BY_NAME['大柴胡湯']; nextQuestion();")
    pg.click("#hintBtn")
    check("황금짓" in pg.inner_text("#hintText"), "rx hint shows 덩달이")
    check(pg.locator("#hintText b").count() > 0, "bold parts rendered")
    pg.click("#giveUpBtn") if pg.is_visible("#giveUpBtn") else None
    fb = pg.inner_text("#feedback")
    check("덩달이" in fb and "황금짓" in fb, "rx feedback shows 덩달이")
    # 오답 노트에 힌트 표시
    E("forcedNext = RX_BY_NAME['桂枝湯']; nextQuestion();")
    pg.click("#hintBtn"); E("current.ings.forEach(h=>addToPot(h))"); pg.click("#submitBtn")
    pg.evaluate("location.hash='#wrong'"); pg.wait_for_timeout(200)
    check("힌트 보고 맞힘" in pg.inner_text("body"), "wrong note shows hint tag")
    pg.evaluate("location.hash='#game'"); pg.wait_for_timeout(200)
    # 본초 A: 덩달이 순서
    pg.click('.subject-btn[data-subject="bc"]'); pg.wait_for_timeout(100)
    E("forcedNext = MODES.bcA.byName['淸熱凉血藥']; nextQuestion();")
    pg.click("#hintBtn")
    check("현서각" in pg.inner_text("#hintText"), "bcA hint shows 덩달이")
    E("addToPot('木賊')"); pg.click("#submitBtn")
    fb = pg.inner_text("#feedback")
    check("현서각" in fb and pg.locator("#feedback .dd-o").count() == 6, "bcA feedback shows 덩달이 + 6 herbs in order")
    check("목단피" in fb, "order chips have readings")
    pg.screenshot(path=SHOTS + "dd_bcA.png", full_page=False)
    E("forcedNext = MODES.bcA.byName['補陽藥']; nextQuestion();"); pg.click("#giveUpBtn")
    check("덩달이에 없는 약물: 韭子" in pg.inner_text("#feedback"), "lists herbs missing from 덩달이")
    # 본초 B: 노트에 덩달이
    pg.click('#modeSeg button[data-mode="B"]'); pg.wait_for_timeout(80)
    E("forcedNext = MODES.bcB.byName['犀角']; nextQuestion();")
    E("pickB(BCG_BY_NAME ? 'x' : 'x')") if False else None
    E("finishQuestion(true)")
    check("현서각" in pg.inner_text("#bFeedback"), "bcB feedback shows 덩달이 of answer group")
    # 폰
    pg2 = new_page(390, 844); E2 = pg2.evaluate
    E2("forcedNext = RX_BY_NAME['小靑龍湯']; nextQuestion();")
    pg2.click("#hintBtn"); pg2.click("#giveUpBtn")
    sw = E2("document.documentElement.scrollWidth")
    check(sw <= 390, f"phone no h-scroll ({sw})")
    pg2.screenshot(path=SHOTS + "dd_phone_rx.png", full_page=True)
    b.close()
print("ERRORS:", errors)
sys.exit(1 if errors else 0)
