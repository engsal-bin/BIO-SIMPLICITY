"""앱(hanui) 안에서 탕전 게임 — Supabase를 흉내 내고 진짜 app.js·boot.js·game.html로 확인"""
import sys, json, threading, http.server, socketserver, functools, time
from playwright.sync_api import sync_playwright

import os
HERE = os.path.dirname(os.path.abspath(__file__))
HANUI = os.path.join(HERE, "..", "..", "hanui")
GAME_DATA = open(os.path.join(HERE, "..", "out", "game_data.json"), encoding="utf8").read()
SHOTS = os.path.join(HERE, "..", "shots") + "/"
PORT = 8766
errors = []

def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        errors.append(msg)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Q, directory=HANUI))
threading.Thread(target=srv.serve_forever, daemon=True).start()

D = {"items": [], "chapters": []}
JD = {"lecs": [], "items": [], "rd": {}}
ROWS = {"data": json.dumps(D), "jydata": json.dumps(JD), "game": GAME_DATA}
SAVED = {"data": None, "posts": 0}
UID = "00000000-0000-0000-0000-000000000001"

def route(r):
    url = r.request.url
    if "/rest/v1/hanui_content" in url:
        if "select=id,updated_at" in url:
            return r.fulfill(json=[{"id": k, "updated_at": "2026-11-19T00:00:00Z"} for k in ROWS])
        rid = url.split("id=eq.")[1]
        return r.fulfill(json=[{"id": rid, "data": ROWS[rid], "updated_at": "2026-11-19T00:00:00Z"}])
    if "/rest/v1/hanui_state" in url:
        if r.request.method == "GET":
            return r.fulfill(json=[{"data": SAVED["data"]}] if SAVED["data"] else [])
        SAVED["data"] = json.loads(r.request.post_data)["data"]; SAVED["posts"] += 1
        return r.fulfill(status=201, body="")
    return r.continue_()

AUTH = json.dumps({"access_token": "t", "refresh_token": "r", "expires_at": 4102444800, "user": {"id": UID, "email": "me@example.com"}})

with sync_playwright() as p:
    b = p.chromium.launch()
    def open_app(w, h, fresh=True):
        ctx = b.new_context(viewport={"width": w, "height": h})
        ctx.add_init_script(f"localStorage.setItem('hanui:auth', {json.dumps(AUTH)});")
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append("JS error: " + str(e)))
        pg.on("console", lambda m: m.type == "error" and "favicon" not in m.text and errors.append("console: " + m.text))
        pg.on("dialog", lambda d: d.accept())
        pg.route("https://bdnipfhflsmvfpajuqvn.supabase.co/**", route)
        pg.goto(f"http://127.0.0.1:{PORT}/index.html"); pg.wait_for_timeout(1200)
        return ctx, pg

    ctx, pg = open_app(1280, 900)
    check(pg.is_visible("#appRoot"), "app booted with mocked Supabase")
    check(pg.locator('#nav [data-go="game"]').count() == 1, "menu has 탕전 게임")
    pg.click('#nav [data-go="game"]'); pg.wait_for_timeout(1500)
    fr = pg.frame_locator("#gameHost iframe")
    f = [x for x in pg.frames if x.url.endswith("game.html")][0]
    check(f.evaluate("typeof current !== 'undefined' && !!current"), "game started inside iframe with data from content row")
    check(f.evaluate("document.body.classList.contains('hosted')"), "hosted mode")
    hb = pg.evaluate("document.getElementById('gameHost').getBoundingClientRect().height")
    check(hb > 800, f"iframe fills height ({hb:.0f})")
    # play: wrong answer → saved to app record
    f.evaluate("addToPot('海藻')"); fr.locator("#submitBtn").click()
    pg.wait_for_timeout(1700)
    st = pg.evaluate("JSON.stringify(window.__s=null)")
    saved = json.loads(SAVED["data"] or "{}")
    g = saved.get("game", {})
    check("shanghan113_state_v2" in g and g["shanghan113_state_v2"]["v"]["wrong"], "game record synced into hanui_state.game")
    # switch to 총론 and star
    fr.locator('.subject-btn[data-subject="cr"]').click(); pg.wait_for_timeout(200)
    fr.locator("#starBtn").click(); pg.wait_for_timeout(1700)
    g = json.loads(SAVED["data"])["game"]
    check(g.get("app_settings_v1", {}).get("v", {}).get("subject") == "cr" and g.get("cr_A_v1", {}).get("v", {}).get("starred"), "subject + star saved")
    # leave and come back: iframe is kept (no reset)
    cur = f.evaluate("current.name")
    pg.click('#nav [data-go="home"]'); pg.wait_for_timeout(200)
    check(not pg.is_visible("#gameHost"), "game hidden on other menu")
    pg.click('#nav [data-go="game"]'); pg.wait_for_timeout(200)
    check(f.evaluate("current.name") == cur, "same question kept after switching menus")
    # theme follows app
    pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
    pg.close(); ctx.close()

    # second device: record comes back from the account
    ctx, pg = open_app(390, 844)
    pg.wait_for_timeout(500)
    pg.locator('#topbar [data-go="game"]').click(); pg.wait_for_timeout(1500)
    f = [x for x in pg.frames if x.url.endswith("game.html")][0]
    check(f.evaluate("APP.subject") == "cr", "other device: subject restored from account")
    check(f.evaluate("Object.keys(STORES.rx.wrong).length") == 1 and f.evaluate("Object.keys(STORES.crA.starred).length") == 1, "other device: wrong + star restored")
    sw = pg.evaluate("document.documentElement.scrollWidth")
    check(sw <= 390, f"phone: no horizontal scroll in app ({sw})")
    tb = pg.evaluate("document.getElementById('gameHost').getBoundingClientRect()")
    check(tb["top"] < 70 and abs(tb["bottom"] - 844) < 4, f"phone: game fills below topbar (top {tb['top']:.0f}, bottom {tb['bottom']:.0f})")
    pg.screenshot(path=SHOTS + "app_phone_cr.png")
    fr = pg.frame_locator("#gameHost iframe")
    fr.locator('.subject-btn[data-subject="rx"]').click(); pg.wait_for_timeout(200)
    pg.screenshot(path=SHOTS + "app_phone_rx.png")
    pg.close(); ctx.close()

    # dark theme passes through
    ctx, pg = open_app(1280, 900)
    pg.evaluate("localStorage.setItem('x','1')")
    pg.click('#nav [data-go="stats"]'); pg.wait_for_timeout(300)
    btn = pg.locator('[data-theme-set="dark"]')
    if btn.count():
        btn.first.click(); pg.wait_for_timeout(200)
        pg.click('#nav [data-go="game"]'); pg.wait_for_timeout(1500)
        f = [x for x in pg.frames if x.url.endswith("game.html")][0]
        check(f.evaluate("document.documentElement.getAttribute('data-theme')") == "dark", "dark theme passed to game")
        pg.screenshot(path=SHOTS + "app_desktop_dark.png")
    else:
        check(False, "theme buttons not found")
    pg.close(); ctx.close()

    # game.html opened directly → guidance, no crash
    ctx = b.new_context(); pg = ctx.new_page()
    pg.goto(f"http://127.0.0.1:{PORT}/game.html"); pg.wait_for_timeout(300)
    check("메뉴에서 열어" in pg.inner_text("body"), "direct open shows guidance")
    ctx.close()
    b.close()
srv.shutdown()
print("ERRORS:", errors)
sys.exit(1 if errors else 0)
