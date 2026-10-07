"""Kịch bản nhiều trình duyệt chơi cùng một phòng (mục 33 của yêu cầu) trên giao diện thật.

Chạy:  python e2e/scenario.py            (tự bật máy chủ riêng, thời lượng rút ngắn TIME_SCALE=0.25)
       python e2e/scenario.py --offline-fonts   (máy không ra Internet: thay font Google bằng font có sẵn)

Các bước: phòng đầy → XSS ở tên & chat → bắt đầu → đoán sai → tải lại trang → mất mạng & có mạng lại
→ spam chat → thích bức vẽ → đoán đúng → người vẽ đóng tab → chủ phòng đóng tab → chủ mới mời người ra → người mới vào giữa trận
→ bỏ phiếu mời ra → cấm → chơi tới tổng kết → chơi lại → dừng trận → tắt/bật chat. Thoát mã 0 nếu mọi kiểm tra đạt.
"""
import sys
import time
from playwright.sync_api import sync_playwright
from common import (Recorder, start_server, new_context, open_page, plain, wait_until, drawer_of,
                    draw_stroke, ink_pixels, send_chat, check, finish)

OFFLINE_FONTS = '--offline-fonts' in sys.argv
XSS_NAME = '<b>Bình</b>'
XSS_CHAT = '<img src=x onerror=alert(1)>'


def wait_home_ready(pg):
    pg.wait_for_function("() => !document.querySelector('#room-list').textContent.includes('Đang tải')", timeout=10000)


def in_room(pg, timeout=10000):
    pg.wait_for_selector('#screen-room:not(.hidden)', timeout=timeout)


def chat_text(pg):
    return pg.locator('#chat').inner_text()


def player_row(pg, name):
    """Dòng người chơi `name` (trên điện thoại phải mở tab "Người chơi" trước)."""
    if pg.locator('#mobile-tabs').is_visible():
        pg.click('#mobile-tabs [data-tab=players]')
    return pg.locator('#players .pl.clickable', has_text=name)


def host_name(pg):
    return pg.evaluate("""() => { const r = [...document.querySelectorAll('#players .pl')].find(x => x.querySelector('[aria-label="Chủ phòng"]'));
      return r ? r.querySelector('.pl-name > span').textContent : null; }""")


def main():
    rec, R = Recorder(), []
    proc, URL = start_server('0.25')
    print('Máy chủ thử nghiệm:', URL)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = {
                'A': new_context(b, (1366, 768), offline_fonts=OFFLINE_FONTS),
                'B': new_context(b, (1280, 800), offline_fonts=OFFLINE_FONTS),
                'C': new_context(b, (390, 844), mobile=True, offline_fonts=OFFLINE_FONTS),
                'D': new_context(b, (1024, 768), offline_fonts=OFFLINE_FONTS),
            }
            names = {'A': 'An', 'B': XSS_NAME, 'C': 'Chi', 'D': 'Dũng'}
            pages = {}

            print('\n1. Tạo phòng, mời bạn, phòng đầy')
            A = pages['A'] = open_page(ctx['A'], URL, rec, 'A', names['A'])
            wait_home_ready(A)
            A.click('#btn-create')
            in_room(A)
            code = A.locator('#room-code').inner_text().strip()
            check(len(code) == 6, f'có mã phòng 6 ký tự ({code})', R)
            A.select_option('[name=maxPlayers]', '3')
            A.select_option('[name=rounds]', '2')
            A.select_option('[name=drawTime]', '120')
            B = pages['B'] = open_page(ctx['B'], URL, rec, 'B', names['B'])
            B.goto(f'{URL}/r/{code}')
            in_room(B)
            C = pages['C'] = open_page(ctx['C'], URL, rec, 'C', names['C'])
            wait_home_ready(C)
            C.fill('#join-code', code.lower())
            C.click('#btn-join')
            in_room(C)
            wait_until(lambda: A.locator('#players .pl').count() == 3, what='3 người trong phòng')
            check(B.locator('[name=maxPlayers]').input_value() == '3', 'cài đặt của chủ phòng đồng bộ sang khách', R)
            check(B.locator('[name=rounds]').is_disabled(), 'khách không sửa được cài đặt', R)
            D = pages['D'] = open_page(ctx['D'], URL, rec, 'D', names['D'])
            wait_home_ready(D)
            D.fill('#join-code', code)
            D.click('#btn-join')
            wait_until(lambda: 'đủ người' in D.locator('#toasts').inner_text(), what='thông báo phòng đầy')
            check(D.locator('#screen-home:not(.hidden)').count() == 1, 'người thứ 4 bị từ chối vì phòng đầy, vẫn ở trang chủ', R)
            del pages['D']

            print('\n2. Tên & chat chứa HTML hiển thị như chữ thường (chống XSS)')
            send_chat(B, XSS_CHAT)
            wait_until(lambda: XSS_CHAT in chat_text(A), what='tin nhắn XSS hiện dạng chữ')
            check(A.locator('#chat img').count() == 0, 'chat không tạo thẻ <img> từ tin nhắn', R)
            check(XSS_NAME in A.locator('#players').inner_text() and A.locator('#players .pl-name b').count() == 0,
                  'tên chứa HTML hiện nguyên văn, không thành thẻ', R)

            print('\n3. Bắt đầu, lượt 1: vẽ, đoán sai, tải lại trang, mất mạng, spam, đoán đúng')
            A.click('#btn-start')
            d1 = wait_until(lambda: drawer_of(pages), 15, what='lớp phủ chọn từ')
            dp = pages[d1]
            dp.click('#overlay .choice >> nth=0')
            dp.wait_for_selector('#word-area .word-big')
            word = dp.locator('#word-area .word-big').inner_text().strip()
            print('   người vẽ', d1, 'từ', word)
            draw_stroke(dp)
            guessers = [n for n in pages if n != d1]
            for n in guessers:
                wait_until(lambda: ink_pixels(pages[n]) > 50, what=f'nét vẽ hiện trên máy {n}')
                check(pages[n].locator('#word-area .word-big').count() == 0, f'{n} đang đoán không thấy từ khoá', R)
            g0 = pages[guessers[0]]
            send_chat(g0, 'con voi biển')
            wait_until(lambda: all('con voi biển' in chat_text(pages[n]) for n in pages), what='đoán sai hiện cho cả phòng')
            check(True, 'đoán sai hiện như chat thường cho cả phòng', R)

            rname = 'B' if 'B' in guessers else guessers[0]
            rp = pages[rname]
            rp.reload()
            in_room(rp)
            wait_until(lambda: ink_pixels(rp) > 50, what='tranh vẽ khôi phục sau khi tải lại')
            check(True, f'{rname} tải lại trang: vào lại đúng phòng, tranh vẽ còn nguyên', R)
            check(rp.locator('#word-area .slot').count() > 0 and rp.locator('#word-area .word-big').count() == 0,
                  'sau khi tải lại vẫn chỉ thấy ô gợi ý, không lộ từ', R)

            oname = [n for n in guessers if n != rname][0]
            op = pages[oname]
            op.context.set_offline(True)
            wait_until(lambda: op.locator('#conn-banner:not(.hidden)').count() == 1, what='thanh báo mất kết nối')
            wait_until(lambda: dp.locator('#players .pl.offline').count() == 1, what='người khác thấy trạng thái mất kết nối')
            check(True, f'{oname} mất mạng: hiện thanh báo, cả phòng thấy {oname} mất kết nối', R)
            op.context.set_offline(False)
            wait_until(lambda: op.locator('#conn-banner.hidden').count() == 1, 15, what='tự nối lại khi có mạng')
            wait_until(lambda: dp.locator('#players .pl.offline').count() == 0, what='trạng thái kết nối lại')
            check(dp.locator('#players .pl').count() == 3, f'{oname} có mạng lại: tự vào lại, không bị nhân đôi', R)

            for i in range(15):
                send_chat(g0, f'spam {i}')
            time.sleep(0.8)
            spam_seen = sum(1 for line in chat_text(dp).split('\n') if 'spam ' in line)
            check(spam_seen <= 6, f'spam 15 tin: người khác chỉ nhận {spam_seen} tin', R)
            check('chậm lại' in chat_text(g0) or 'nhanh quá' in g0.locator('#toasts').inner_text(),
                  'người spam được nhắc gõ chậm lại', R)

            liker = pages[guessers[-1]]
            liker.click('#btn-like')
            wait_until(lambda: 'thích bức vẽ' in chat_text(dp), what='người vẽ thấy có người thích tranh')
            check(liker.locator('#btn-like').is_disabled(), 'bấm "thích" bức vẽ: cả phòng thấy, mỗi người chấm một lần', R)

            time.sleep(4.2)  # qua khung chống spam 4 giây
            for n in guessers:
                send_chat(pages[n], plain(word).lower())
            dp.wait_for_selector('#overlay.k-turnEnd', timeout=8000)
            check(word in dp.locator('#overlay').inner_text(), 'hết lượt: công bố đáp án', R)

            print('\n4. Lượt 2: người vẽ đóng tab giữa chừng')
            d2 = wait_until(lambda: (lambda n: n if n and n != d1 else None)(drawer_of(pages)), 15, what='lượt 2')
            pages[d2].click('#overlay .choice >> nth=0')
            pages[d2].wait_for_selector('#word-area .word-big')
            watcher = pages[[n for n in pages if n != d2][0]]
            pages[d2].close()
            wait_until(lambda: 'Người vẽ đã rời đi' in watcher.locator('#overlay').inner_text(), 10, what='bỏ lượt khi người vẽ rời')
            check(True, 'người vẽ rời đi: lượt kết thúc, trận không bị treo', R)
            pages[d2] = open_page(ctx[d2], f'{URL}/r/{code}', rec, d2 + "'")
            in_room(pages[d2])
            check(pages[d2].locator('#players .pl').count() == 3, f'{d2} mở lại tab: vào lại phòng như cũ', R)

            print('\n5. Chủ phòng đóng tab → chuyển quyền; chủ mới mời người ra')
            old_host = names['A']
            pages['A'].close()
            others = [n for n in pages if n != 'A']
            wait_until(lambda: host_name(pages[others[0]]) not in (None, old_host), 10, what='chuyển quyền chủ phòng')
            new_host_name = host_name(pages[others[0]])
            check(new_host_name in (names['B'], names['C']), f'quyền chủ phòng chuyển cho {new_host_name}', R)
            pages['A'] = open_page(ctx['A'], f'{URL}/r/{code}', rec, "A'")
            in_room(pages['A'])
            check(host_name(pages['A']) == new_host_name, 'chủ cũ quay lại không lấy lại quyền', R)
            hp = pages['B'] if new_host_name == names['B'] else pages['C']
            player_row(hp, 'An').click()
            hp.click('#player-menu [data-act=kick]')
            hp.click('#modal [data-yes]')
            pages['A'].wait_for_selector('#screen-home:not(.hidden)', timeout=8000)
            check('mời bạn ra' in pages['A'].locator('#toasts').inner_text(), 'người bị mời ra được báo và về trang chủ', R)
            pages['A'].fill('#join-code', code)
            pages['A'].click('#btn-join')
            wait_until(lambda: 'vừa bị mời ra' in pages['A'].locator('#toasts').inner_text(), what='chặn vào lại ngay')
            check(True, 'người vừa bị mời ra không vào lại ngay được', R)
            del pages['A']


            print('\n6. Người mới vào giữa trận, chơi tới tổng kết')
            Dp = pages['D'] = open_page(ctx['D'], URL, rec, "D'")
            wait_home_ready(Dp)
            Dp.fill('#join-code', code)
            Dp.click('#btn-join')
            in_room(Dp)
            check(Dp.locator('#lobby-panel.hidden').count() == 1, 'người vào giữa trận thấy ngay màn chơi', R)

            # Bỏ phiếu mời ra: 2 người còn lại cùng bỏ phiếu mời D
            for voter in [pg for n, pg in pages.items() if n != 'D']:
                player_row(voter, names['D']).click()
                voter.click('#player-menu [data-act=vote]')
                time.sleep(0.3)
            Dp.wait_for_selector('#screen-home:not(.hidden)', timeout=8000)
            check('bỏ phiếu' in Dp.locator('#toasts').inner_text(), 'đủ phiếu: người bị bỏ phiếu bị mời ra và được báo lý do', R)
            del pages['D']

            # Chủ phòng cấm một người: không vào lại được nữa
            ctx['E'] = new_context(b, (1280, 720), offline_fonts=OFFLINE_FONTS)
            E = open_page(ctx['E'], URL, rec, 'E', 'Én')
            wait_home_ready(E)
            E.fill('#join-code', code)
            E.click('#btn-join')
            in_room(E)
            player_row(hp, 'Én').click()
            hp.click('#player-menu [data-act=ban]')
            hp.click('#modal [data-yes]')
            E.wait_for_selector('#screen-home:not(.hidden)', timeout=8000)
            E.click('#btn-join')
            wait_until(lambda: 'bị cấm' in E.locator('#toasts').inner_text(), what='người bị cấm không vào lại được')
            check(True, 'chủ phòng cấm: người bị cấm về trang chủ và không vào lại được', R)
            seen_turns = set()
            deadline = time.time() + 120
            while time.time() < deadline:
                if hp.locator('#overlay .podium').count():
                    break
                n = drawer_of(pages)
                if n:
                    pg = pages[n]
                    pg.click('#overlay .choice >> nth=0')
                    pg.wait_for_selector('#word-area .word-big', timeout=8000)
                    w = pg.locator('#word-area .word-big').inner_text().strip()
                    if w not in seen_turns:
                        seen_turns.add(w)
                        for g in pages:
                            if g != n:
                                send_chat(pages[g], w)
                time.sleep(0.3)
            check(hp.locator('#overlay .podium').count() == 1, 'trận chơi tới màn tổng kết', R)
            guest = [pg for pg in pages.values() if pg is not hp][0]
            check(hp.locator('#overlay [data-act=again]').count() == 1 and guest.locator('#overlay [data-act=again]').count() == 0,
                  'chỉ chủ phòng có nút "Chơi lại"', R)
            hp.click('#overlay [data-act=again]')
            wait_until(lambda: guest.locator('#overlay .podium').count() == 0 and guest.locator('#round-chip').inner_text().startswith('Hiệp 1'),
                       what='chơi lại từ hiệp 1')
            check(all(t.endswith(' 0 điểm') or t == '0 điểm' for t in guest.locator('#players .pl-score').all_inner_texts()),
                  '"Chơi lại": bắt đầu trận mới, điểm mọi người về 0', R)

            print('\n7. Chủ phòng dừng trận, thử tắt / bật chat ở phòng chờ')
            check(guest.locator('#btn-stop.hidden').count() == 1, 'khách không có nút dừng trận', R)
            hp.click('#btn-stop')
            hp.click('#modal [data-yes]')
            guest.wait_for_selector('#lobby-panel:not(.hidden)', timeout=8000)
            check('Chủ phòng đã dừng trận' in chat_text(guest), 'chủ phòng dừng trận: cả phòng về phòng chờ', R)
            other, other_name = guest, (names['C'] if hp is pages['B'] else names['B'])
            player_row(hp, other_name).click()
            hp.click('#player-menu [data-act=mute]')
            wait_until(lambda: other.locator('#players .pl.me .pl-name svg').count() >= 1, what='biểu tượng bị tắt chat')
            send_chat(other, 'tin nhắn bị chặn')
            wait_until(lambda: 'tin nhắn bị chặn' in chat_text(other), what='người bị tắt chat vẫn thấy tin của mình')
            time.sleep(0.5)
            check('tin nhắn bị chặn' not in chat_text(hp), 'chủ phòng tắt chat một người: người khác không nhận tin của người đó', R)
            player_row(hp, other_name).click()
            hp.click('#player-menu [data-act=mute]')
            wait_until(lambda: other.locator('#players .pl.me .pl-name svg').count() == 0, what='bỏ biểu tượng tắt chat')
            send_chat(other, 'đã nói lại được')
            wait_until(lambda: 'đã nói lại được' in chat_text(hp), what='bật lại chat')
            check(True, 'bật lại chat: tin nhắn tới cả phòng bình thường', R)
            b.close()
    finally:
        proc.terminate()
    finish(R, rec)


if __name__ == '__main__':
    main()
