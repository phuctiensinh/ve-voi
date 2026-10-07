"""Tiện ích chung cho kiểm thử giao diện bằng trình duyệt thật (Playwright + Chromium).

Không bắt buộc để chạy game. Cài một lần:
    pip install playwright && python -m playwright install chromium
"""
import os
import socket
import subprocess
import sys
import time
import unicodedata
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Khi máy không ra được Internet (CI nội bộ…), thay font Google bằng font có sẵn để giao diện không bị chờ tải font.
FONT_CSS = """
@font-face{font-family:'Nunito';font-weight:500 600;src:local('Inter SemiBold'),local('Inter-SemiBold'),local('Arial');}
@font-face{font-family:'Nunito';font-weight:700;src:local('Inter Bold'),local('Inter-Bold'),local('Arial Bold');}
@font-face{font-family:'Nunito';font-weight:800 900;src:local('Inter ExtraBold'),local('Inter-ExtraBold'),local('Arial Black');}
@font-face{font-family:'Baloo 2';font-weight:700 800;src:local('Inter Black'),local('Inter-Black'),local('Arial Black');}
"""


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def start_server(time_scale='0.25', port=None):
    """Chạy máy chủ game riêng cho lần kiểm thử (thời lượng rút ngắn theo TIME_SCALE)."""
    port = port or free_port()
    env = dict(os.environ, PORT=str(port), HOST='127.0.0.1', TIME_SCALE=str(time_scale), LOG_LEVEL='warn')
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'server', 'index.js')], env=env, cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    url = f'http://127.0.0.1:{port}'
    for _ in range(100):
        try:
            urllib.request.urlopen(url + '/health', timeout=1).read()
            return proc, url
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError('Máy chủ không khởi động được: ' + proc.stderr.read().decode('utf-8', 'replace'))
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError('Máy chủ không phản hồi /health')


class Recorder:
    """Ghi lại lỗi JavaScript, lỗi console và hộp thoại bất ngờ (dấu hiệu XSS) trên mọi trang."""

    def __init__(self):
        self.errors = []
        self.dialogs = []

    def watch(self, page, name):
        page.on('pageerror', lambda e: self.errors.append(f'{name}: {e}'))
        page.on('console', lambda m: m.type == 'error' and 'fonts.g' not in m.text
                and 'net::ERR' not in m.text and self.errors.append(f'{name} console: {m.text}'))
        page.on('dialog', lambda d: (self.dialogs.append(f'{name}: {d.type} {d.message}'), d.dismiss()))


def new_context(browser, viewport=(1366, 768), mobile=False, offline_fonts=False):
    ctx = browser.new_context(viewport={'width': viewport[0], 'height': viewport[1]},
                              device_scale_factor=2 if mobile else 1, has_touch=mobile, is_mobile=mobile,
                              locale='vi-VN')
    if offline_fonts:
        ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=FONT_CSS))
        ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    return ctx


def open_page(ctx, url, rec, name, nick=None):
    page = ctx.new_page()
    rec.watch(page, name)
    page.goto(url)
    page.wait_for_selector('#conn-banner.hidden', state='attached', timeout=10000)
    if nick is not None:
        page.fill('#nick', nick)
    return page


def plain(word):
    s = ''.join(c for c in unicodedata.normalize('NFD', word) if unicodedata.category(c) != 'Mn')
    return s.replace('đ', 'd').replace('Đ', 'D')


def wait_until(fn, timeout=10.0, step=0.1, what='điều kiện'):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    raise AssertionError(f'Hết {timeout} giây mà chưa thấy: {what}')


def drawer_of(pages):
    """Trang đang hiện lớp phủ chọn từ (tức là người vẽ của lượt này)."""
    for name, pg in pages.items():
        if not pg.is_closed() and pg.locator('#overlay .choice').count():
            return name
    return None


def draw_stroke(page):
    box = page.locator('#canvas').bounding_box()
    x0, y0, w, h = box['x'], box['y'], box['width'], box['height']
    page.mouse.move(x0 + w * .3, y0 + h * .7)
    page.mouse.down()
    page.mouse.move(x0 + w * .5, y0 + h * .3, steps=10)
    page.mouse.move(x0 + w * .7, y0 + h * .7, steps=10)
    page.mouse.up()


def ink_pixels(page):
    """Số điểm ảnh không trắng trên bảng vẽ (để biết tranh đã hiện ra chưa)."""
    return page.evaluate("""() => {
      const c = document.querySelector('#canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++; return n; }""")


def send_chat(page, text):
    if not page.locator('#chat-input').is_visible() and page.locator('#mobile-tabs').is_visible():
        page.click('#mobile-tabs [data-tab=chat]')  # điện thoại: đang ở tab "Người chơi" thì quay về tab chat
    page.fill('#chat-input', text)
    page.press('#chat-input', 'Enter')


def check(cond, msg, results):
    results.append(('OK ' if cond else 'LỖI') + ' ' + msg)
    if not cond:
        print('  ✖', msg, flush=True)
    else:
        print('  ✔', msg, flush=True)
    return cond


def finish(results, rec):
    failed = [r for r in results if r.startswith('LỖI')]
    if rec.errors:
        print('\nLỗi JavaScript / console:')
        for e in rec.errors:
            print('  -', e)
    if rec.dialogs:
        print('\nHộp thoại bất ngờ (nghi XSS):')
        for d in rec.dialogs:
            print('  -', d)
    ok = not failed and not rec.errors and not rec.dialogs
    print(f"\n{'ĐẠT' if ok else 'KHÔNG ĐẠT'}: {len(results) - len(failed)}/{len(results)} kiểm tra, "
          f'{len(rec.errors)} lỗi JS, {len(rec.dialogs)} hộp thoại lạ')
    sys.exit(0 if ok else 1)
