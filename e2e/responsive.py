"""Kiểm tra bố cục ở nhiều cỡ màn hình + chụp ảnh để xem lại.

Chạy:  python e2e/responsive.py [--offline-fonts] [1366x768 390x844 …]
Ảnh lưu ở e2e/screenshots/. Với mỗi cỡ màn hình kiểm tra trang chủ, phòng chờ, chọn từ, người vẽ, người đoán:
  - không có thanh cuộn ngang (không tràn ngang)
  - bảng vẽ đúng tỉ lệ 4:3 và nằm trọn trong bề ngang màn hình
  - máy tính / máy tính bảng: màn chơi vừa một màn hình, không phải cuộn dọc
  - chữ hiển thị không nhỏ hơn 11px
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright
from common import Recorder, start_server, new_context, open_page, wait_until, check, finish

OFFLINE_FONTS = '--offline-fonts' in sys.argv
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
VIEWPORTS = [
    ('1920x1080', (1920, 1080), False),
    ('1366x768', (1366, 768), False),
    ('1024x768', (1024, 768), False),
    ('768x1024', (768, 1024), True),
    ('412x915', (412, 915), True),
    ('390x844', (390, 844), True),
]

METRICS = """() => {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const cv = document.querySelector('#canvas');
  const r = cv && cv.offsetParent ? cv.getBoundingClientRect() : null;
  let minFont = 99, smallText = '';
  for (const el of document.querySelectorAll('body *')) {
    if (!el.offsetParent || !el.childNodes.length) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < minFont) { minFont = fs; smallText = el.textContent.trim().slice(0, 30); }
  }
  return { vw, vh, sw: de.scrollWidth, sh: de.scrollHeight, minFont, smallText,
           canvas: r && { x: r.x, y: r.y, w: r.width, h: r.height } };
}"""


def measure(page, label, vp_name, desktop, R, in_game):
    time.sleep(0.4)
    m = page.evaluate(METRICS)
    page.screenshot(path=os.path.join(OUT, f'{vp_name}-{label}.png'))
    check(m['sw'] <= m['vw'] + 1, f'[{vp_name}] {label}: không tràn ngang ({m["sw"]}/{m["vw"]})', R)
    check(m['minFont'] >= 11, f'[{vp_name}] {label}: chữ nhỏ nhất {m["minFont"]}px ("{m["smallText"]}")', R)
    if in_game and m['canvas']:
        c = m['canvas']
        ratio = c['w'] / c['h'] if c['h'] else 0
        check(abs(ratio - 4 / 3) < 0.02, f'[{vp_name}] {label}: bảng vẽ tỉ lệ 4:3 ({ratio:.3f})', R)
        check(c['x'] >= -1 and c['x'] + c['w'] <= m['vw'] + 1, f'[{vp_name}] {label}: bảng vẽ nằm trọn bề ngang', R)
        if desktop:
            check(m['sh'] <= m['vh'] + 1, f'[{vp_name}] {label}: vừa một màn hình, không cuộn dọc ({m["sh"]}/{m["vh"]})', R)
            check(c['y'] + c['h'] <= m['vh'] + 1, f'[{vp_name}] {label}: bảng vẽ hiện trọn trong màn hình', R)


def main():
    os.makedirs(OUT, exist_ok=True)
    only = [a for a in sys.argv[1:] if not a.startswith('--')]  # ví dụ: python e2e/responsive.py 390x844
    viewports = [v for v in VIEWPORTS if not only or v[0] in only]
    rec, R = Recorder(), []
    proc, URL = start_server('0.25')
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            helper_ctx = new_context(b, (1280, 800), offline_fonts=OFFLINE_FONTS)
            for vp_name, vp, mobile in viewports:
                print(f'\n— {vp_name}')
                desktop = not mobile
                ctx = new_context(b, vp, mobile=mobile and vp[0] < 600, offline_fonts=OFFLINE_FONTS)
                P = open_page(ctx, URL, rec, f'P{vp_name}', 'Nhung')
                P.wait_for_function("() => !document.querySelector('#room-list').textContent.includes('Đang tải')")
                measure(P, '1-home', vp_name, desktop, R, False)
                if mobile:
                    P.screenshot(path=os.path.join(OUT, f'{vp_name}-1-home-full.png'), full_page=True)
                P.click('#btn-create')
                P.wait_for_selector('#screen-room:not(.hidden)')
                code = P.locator('#room-code').inner_text().strip()
                Q = open_page(helper_ctx, URL, rec, f'Q{vp_name}', 'Bạn vẽ')
                Q.goto(f'{URL}/r/{code}')
                Q.wait_for_selector('#screen-room:not(.hidden)')
                P.select_option('[name=drawTime]', '120')
                wait_until(lambda: P.locator('#players .pl').count() == 2, what='2 người')
                measure(P, '2-lobby', vp_name, desktop, R, False)
                P.click('#btn-start')
                P.wait_for_selector('#overlay .choice', timeout=10000)
                measure(P, '3-choose', vp_name, desktop, R, False)
                P.click('#overlay .choice >> nth=0')
                P.wait_for_selector('#word-area .word-big')
                word = P.locator('#word-area .word-big').inner_text().strip()
                box = P.locator('#canvas').bounding_box()
                P.mouse.move(box['x'] + box['width'] * .2, box['y'] + box['height'] * .3)
                P.mouse.down()
                P.mouse.move(box['x'] + box['width'] * .8, box['y'] + box['height'] * .7, steps=12)
                P.mouse.up()
                check(P.locator('#toolbar:not(.hidden)').count() == 1 and P.locator('#toolbar').is_visible(),
                      f'[{vp_name}] người vẽ thấy thanh công cụ', R)
                measure(P, '4-drawer', vp_name, desktop, R, True)
                Q.fill('#chat-input', word)
                Q.press('#chat-input', 'Enter')
                Q.wait_for_selector('#overlay .choice', timeout=12000)
                Q.click('#overlay .choice >> nth=0')
                P.wait_for_selector('#guess-bar:not(.hidden)', timeout=8000)
                check(P.locator('#chat-input').is_visible() or mobile, f'[{vp_name}] người đoán thấy ô nhập đáp án', R)
                measure(P, '5-guesser', vp_name, desktop, R, True)
                if mobile:
                    P.screenshot(path=os.path.join(OUT, f'{vp_name}-5-guesser-full.png'), full_page=True)
                P.close()
                Q.close()
                ctx.close()
            b.close()
    finally:
        proc.terminate()
    print('\nẢnh chụp:', OUT)
    finish(R, rec)


if __name__ == '__main__':
    main()
