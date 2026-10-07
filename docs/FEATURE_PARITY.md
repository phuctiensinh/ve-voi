# Đối chiếu tính năng với skribbl.io

Lấy hành vi người chơi **nhìn thấy** trên skribbl.io làm chuẩn, không sao chép mã, logo hay asset của họ.

Ba cột trạng thái, chỉ đánh dấu khi có bằng chứng:

- **IMPLEMENTED**: có logic thật ở máy chủ và giao diện (không phải nút giả, không chỉ đổi giao diện tại máy).
- **TESTED**: có test tự động trong `test/` (`npm test`) kiểm tra hành vi đó. Ghi tên file.
- **VERIFIED**: đã kiểm tra trên trình duyệt thật (Chromium qua Playwright) bằng `e2e/scenario.py` (5 trình duyệt chơi cùng phòng, 33 bước, 7 phần) hoặc `e2e/responsive.py` (6 cỡ màn hình), và đã xem ảnh chụp.

✅ = đạt, ➖ = không áp dụng.

## Bảng đối chiếu

| Hạng mục | skribbl.io | Vẽ Vời | IMPLEMENTED | TESTED | VERIFIED |
|---|---|---|---|---|---|
| **HOME** | nhập tên, chọn ngôn ngữ, chỉnh avatar, "Play" / "Create private room" | biệt danh, ngôn ngữ (Tiếng Việt), avatar 16 mặt × 12 màu, "Chơi ngay", "Tạo phòng riêng", vào bằng mã, danh sách phòng công khai, bật/tắt âm thanh | ✅ | ✅ multiplayer (chơi nhanh & danh sách phòng) | ✅ scenario bước 1, responsive (trang chủ ở 6 cỡ) |
| **LOBBY** | mã/link mời, danh sách người, cài đặt, nút Start | mã phòng, sao chép mã/link (chia sẻ trên điện thoại), danh sách người cập nhật tức thì, cài đặt, nút Bắt đầu chỉ chủ phòng bấm được, chủ phòng dừng trận giữa chừng | ✅ | ✅ moderation (đồng bộ cài đặt), multiplayer (dừng trận) | ✅ scenario bước 1 (khách thấy cài đặt, không sửa được), bước 7 (chủ phòng dừng trận) |
| **ROOM** | phòng công khai / riêng, link mời | công khai / riêng / có mật khẩu, link `/r/MÃ`, phòng đầy, sai mã, phòng hết hạn, người vào giữa trận | ✅ | ✅ moderation (phòng đầy, mật khẩu), resilience (hết hạn) | ✅ scenario bước 1 (phòng đầy), bước 6 (vào giữa trận) |
| **SETTINGS** | số người, ngôn ngữ, thời gian vẽ, số hiệp, số từ, gợi ý, chế độ từ, từ tự thêm | số người 2–12, hiệp 1–10, thời gian 30–120 giây, số từ 1–5, gợi ý 0–5, chế độ bình thường/ẩn độ dài, chấm dấu tiếng Việt, chủ đề, từ tự thêm (tối đa 200, có thể chỉ dùng từ tự thêm); máy chủ kẹp mọi giá trị | ✅ | ✅ rules (kiểm tra cài đặt), moderation, engine (không đổi giữa trận) | ✅ scenario bước 1 |
| **PLAYER LIST** | thứ hạng, tên, điểm, người vẽ, "(You)", chủ phòng | thứ hạng, avatar, tên, điểm, bút chì = đang vẽ, nền xanh = đã đoán ra, vương miện = chủ phòng, "(bạn)", mờ = mất kết nối, số phiếu mời ra, điểm cộng bật lên | ✅ | ✅ engine, resilience (trạng thái kết nối) | ✅ scenario bước 3 (thấy người mất kết nối), responsive |
| **AVATAR** | avatar tự chỉnh | avatar SVG tự vẽ, 16 khuôn mặt × 12 màu, lưu trên máy | ✅ | ✅ rules (hồ sơ được kẹp) | ✅ ảnh chụp |
| **CHAT** | chat chung, tin hệ thống, đoán đúng màu xanh | chat thời gian thực; tin hệ thống vào/ra/hiệp/đáp án/vô địch; giới hạn 100 ký tự; chống spam; ẩn tin của một người trên máy mình | ✅ | ✅ engine (kênh chat, chống spam), security (spam, XSS) | ✅ scenario bước 2 (XSS), bước 3 (spam) |
| **CANVAS** | bảng vẽ đồng bộ, người vào sau thấy tranh | toạ độ logic 800×600, tỉ lệ 4:3 ở mọi màn hình, độ phân giải nội bộ gấp đôi, người vào giữa lượt / tải lại / nối lại nhận cả nét đang vẽ dở | ✅ | ✅ canvas (người vào sau, tải lại trang) | ✅ scenario bước 3 (tải lại vẫn còn tranh), responsive (tỉ lệ 4:3) |
| **DRAWING** | nét hiện liên tục khi đang kéo | gửi điểm mỗi 40 ms trong lúc kéo; máy chủ cấp id nét, kẹp toạ độ, phát cho người khác; chuột, cảm ứng, bút | ✅ | ✅ canvas (100 nét đúng thứ tự, chỉ người vẽ được vẽ) | ✅ scenario bước 3 (người đoán thấy nét) |
| **COLORS** | bảng màu cố định | 25 màu + chọn màu tuỳ ý; máy chủ chỉ nhận mã màu hợp lệ | ✅ | ✅ canvas (màu sai → màu mặc định) | ✅ ảnh chụp người vẽ |
| **BRUSH** | cọ nhiều cỡ | 5 cỡ, phím tắt 1–5, con trỏ hình tròn đúng cỡ | ✅ | ✅ canvas (cỡ bị kẹp) | ✅ responsive (thanh công cụ hiện đủ) |
| **ERASER** | tẩy | tẩy (phím E) | ✅ | ➖ (tẩy là nét vẽ màu nền, đi chung đường với nét thường đã test) | ✅ ảnh chụp |
| **FILL** | đổ màu | đổ màu (phím F), lưu như một thao tác, vẽ lại giống nhau ở mọi máy | ✅ | ✅ canvas | ✅ |
| **UNDO / REDO** | hoàn tác | hoàn tác + làm lại do máy chủ xử lý, mọi người nhận cùng một bản | ✅ | ✅ canvas, rules (bảng vẽ) | ✅ |
| **CLEAR** | xoá bảng | xoá bảng phát tới mọi người, hoàn tác được | ✅ | ✅ canvas | ✅ |
| **WORD CHOICE** | chọn 1 trong vài từ, hết giờ tự chọn | chọn 1 trong 1–5 từ có nhãn độ khó, chủ đề, điểm tối đa; 15 giây không chọn thì máy chủ chọn; danh sách chỉ gửi người vẽ; từ đã đưa ra không quay lại khi ngân hàng còn đủ | ✅ | ✅ engine, multiplayer (tự chọn từ), rules (chọn từ) | ✅ scenario mọi lượt |
| **HINT** | gạch dưới + số chữ, mở dần chữ cái | ô chữ theo từng tiếng + số chữ mỗi tiếng, mở dần theo lịch, không quá nửa số chữ, tắt ở chế độ ẩn từ | ✅ | ✅ rules (lịch gợi ý), engine, multiplayer (gợi ý tới người đoán) | ✅ scenario (ô gợi ý sau khi tải lại) |
| **TIMER** | đồng hồ đếm ngược | đồng hồ của máy chủ (`phaseEndsAt`), client bù lệch giờ, tải lại / nối lại vẫn đúng; 10 giây cuối đổi màu + tiếng tích tắc | ✅ | ✅ multiplayer (hết giờ), resilience | ✅ ảnh chụp |
| **GUESS** | gõ đáp án vào chat, báo "close" | so khớp tiếng Việt (có/không dấu, kiểu bỏ dấu cũ/mới, gõ liền, lượng từ), chống nhầm (`bò` ≠ `bơ`), báo gần đúng riêng, câu chứa đáp án bị ẩn, chế độ bắt buộc đúng dấu | ✅ | ✅ vietnamese, multiplayer (kết quả đoán qua mạng) | ✅ scenario bước 3 (đoán sai, đoán đúng không dấu) |
| **ANTI-SPOILER** | người đoán đúng chat riêng | máy chủ chọn người nhận: người vẽ + người đã đoán ra nói chuyện riêng; từ khoá không có trong bất kỳ gói tin nào gửi người chưa đoán | ✅ | ✅ multiplayer (quét toàn bộ gói tin), engine | ✅ scenario bước 3 |
| **SCORING** | đoán nhanh nhiều điểm, người vẽ có điểm | người đoán tối đa 400/450/500 theo độ khó, giảm theo thời gian, thưởng người đầu; người vẽ tỉ lệ số người đoán ra; tố viết chữ trừ 100 | ✅ | ✅ rules (điểm), multiplayer (điểm cuối = tổng từng lượt) | ✅ scenario (bảng điểm cập nhật) |
| **ROUNDS** | mỗi hiệp ai cũng vẽ một lần | xoay vòng theo thứ tự vào phòng, người vào giữa hiệp vẽ từ hiệp sau, bỏ qua người mất kết nối | ✅ | ✅ engine (xoay vòng), multiplayer (3 người × 2 hiệp) | ✅ scenario (chơi hết trận) |
| **GAME END** | bục 3 người, bảng điểm | bục vinh danh, thứ hạng, danh hiệu vui, "Chơi lại" (chủ phòng), "Về phòng chờ", tự về phòng chờ sau 25 giây | ✅ | ✅ multiplayer (chơi lại, về phòng chờ, tự về) | ✅ scenario bước 6 (bục vinh danh, chỉ chủ phòng có "Chơi lại", chơi lại thì điểm về 0) |
| **KICK** | chủ phòng mời ra | mời ra có xác nhận, phải chờ khoảng 1 phút mới vào lại | ✅ | ✅ moderation, engine | ✅ scenario bước 5 |
| **BAN** | chủ phòng cấm | cấm vào lại phòng | ✅ | ✅ moderation | ✅ scenario bước 6 |
| **MUTE** | ẩn chat của một người (tại máy) | hai mức: ẩn tin của một người trên máy mình; chủ phòng tắt chat của một người với cả phòng (người đó vẫn đoán được) | ✅ | ✅ engine, moderation | ✅ scenario bước 7 (tắt rồi bật lại chat) |
| **VOTE KICK** | bỏ phiếu mời ra | mỗi người một phiếu, không tự bỏ phiếu mình, cần quá nửa số người còn lại (tối thiểu 2), số phiếu hiện trên danh sách, bị mời ra thì không vào lại được | ✅ | ✅ engine, moderation | ✅ scenario bước 6 (hai người bỏ phiếu mời người thứ ba) |
| **LIKE / DISLIKE** | thích / không thích bức vẽ | thích / chưa thích bức vẽ, mỗi người một lần mỗi lượt, báo trong chat | ✅ | ✅ engine | ✅ scenario bước 3 |
| **REPORT** | báo cáo người chơi | "Tố viết chữ": đủ một nửa người đoán thì người vẽ mất lượt, bị trừ 100 điểm | ✅ | ✅ engine | ✅ ảnh chụp |
| **RECONNECT** | (skribbl không giữ chỗ khi tải lại) | giữ chỗ 45 giây, vào lại đúng người cũ (điểm, quyền chủ phòng, tranh, từ của người vẽ); người vẽ / chủ phòng rớt mạng có thời gian chờ rồi mới xử lý; tab thứ hai thay tab cũ | ✅ | ✅ resilience, canvas, scenario | ✅ scenario bước 3–5 |
| **MOBILE** | chơi được trên điện thoại | bố cục riêng ≤ 860 px: bảng vẽ toàn chiều ngang, tab Trò chuyện / Người chơi, lớp phủ toàn màn hình, vẽ cảm ứng | ✅ | ➖ | ✅ responsive (390×844, 412×915, 768×1024), scenario (người chơi C dùng điện thoại) |
| **ERROR STATES** | thông báo lỗi | phòng không tồn tại / đầy / hết hạn, sai mật khẩu, bị mời ra / cấm, mất kết nối (thanh trạng thái + tự nối lại), máy chủ không phản hồi, thao tác không hợp lệ; thông báo tiếng Việt, không lộ stack trace | ✅ | ✅ moderation, security, multiplayer (lỗi nội bộ) | ✅ scenario (phòng đầy, mất mạng, bị mời ra) |
| **SOUND** | âm thanh | tổng hợp bằng Web Audio, bật/tắt hiệu ứng và nhạc nền, chỉ phát sau khi người chơi tương tác | ✅ | ➖ | ✅ (bật/tắt ở trang chủ và màn chơi) |

## Khác biệt có chủ đích

- **Giới hạn cài đặt:** 2–12 người, 1–10 hiệp, 30–120 giây mỗi lượt theo yêu cầu thiết kế ban đầu (skribbl cho tới 20 người, 240 giây).
- **Ngôn ngữ:** chỉ tiếng Việt, nên ô ngôn ngữ cố định. Bù lại có cách chấm dấu riêng cho tiếng Việt mà skribbl không có.
- **Chế độ từ:** bình thường và ẩn độ dài. Không có chế độ "ghép hai từ" của skribbl vì ghép từ tiếng Việt thường ra cụm vô nghĩa.
- **Báo cáo:** thay nút báo cáo chung bằng "Tố viết chữ" có hậu quả rõ ràng trong trận.
- **Nối lại:** giữ chỗ khi rớt mạng hoặc tải lại trang, điều skribbl không làm.

## Cách kiểm chứng lại

```bash
npm install && npm run build && npm test     # 83 test tự động
python e2e/scenario.py                        # 5 trình duyệt, 33 bước
python e2e/responsive.py                      # 6 cỡ màn hình × 5 màn
```
