// Ngân hàng từ khoá tiếng Việt — ưu tiên từ cụ thể, dễ vẽ.
// Cú pháp mỗi mục: "Từ chính|cách viết khác|cách viết khác". Lượng từ đầu (con, cái, quả…) đã được
// bộ so khớp tự xử lý nên không cần liệt kê "mèo" cho "Con mèo".
'use strict';

const BANK = {
  'do-vat': {
    label: 'Đồ vật',
    easy: ['Cái ghế', 'Cái bàn', 'Cái ô|ô dù|dù|cây dù', 'Đồng hồ', 'Chìa khoá|chìa khóa', 'Cây nến', 'Cái kéo', 'Cái lược',
      'Bóng đèn', 'Cái cốc|cái ly|ly', 'Đôi đũa', 'Cái thìa|cái muỗng|muỗng', 'Cái chổi', 'Cái gương', 'Cái mũ|nón',
      'Đôi dép', 'Cái gối', 'Ổ khoá|ổ khóa'],
    medium: ['Bàn chải đánh răng', 'Máy sấy tóc', 'Cái quạt|quạt máy', 'Bình hoa|lọ hoa', 'Tủ lạnh', 'Nồi cơm điện', 'Cái búa',
      'Cái thang', 'Ấm trà|ấm nước', 'Móc áo|móc treo quần áo', 'Hộp quà', 'Cái xô', 'Đèn pin', 'Bàn là|bàn ủi', 'Kính lúp'],
    hard: ['Bình chữa cháy', 'Máy khâu|máy may', 'Đồng hồ cát', 'Ổ cắm điện', 'Bình nóng lạnh', 'Bật lửa|hộp quẹt',
      'Cái võng', 'Ống nhòm', 'La bàn'],
  },
  'dong-vat': {
    label: 'Động vật',
    easy: ['Con mèo', 'Con chó', 'Con cá', 'Con gà', 'Con vịt', 'Con lợn|con heo', 'Con bò', 'Con trâu', 'Con voi',
      'Con khỉ', 'Con thỏ', 'Con rắn', 'Con ếch', 'Con rùa', 'Con chim', 'Con ong', 'Con kiến', 'Con cua'],
    medium: ['Con hổ|con cọp', 'Sư tử', 'Hươu cao cổ', 'Ngựa vằn', 'Cá heo', 'Cá mập', 'Bạch tuộc', 'Con sứa',
      'Chuồn chuồn', 'Con bướm', 'Cá sấu', 'Con nhện', 'Chim cánh cụt', 'Con gấu', 'Con muỗi', 'Ốc sên', 'Con chuột'],
    hard: ['Tắc kè hoa', 'Cá voi sát thủ|cá kình', 'Chim bói cá', 'Đom đóm', 'Chuột túi|kangaroo', 'Con nhím',
      'Con công|chim công', 'Hà mã', 'Chim gõ kiến', 'Sao biển'],
  },
  'con-nguoi': {
    label: 'Con người',
    easy: ['Em bé', 'Ông lão|ông già|cụ già', 'Bà cụ|bà già', 'Cô dâu', 'Chú rể', 'Người tuyết', 'Bàn tay', 'Bàn chân',
      'Con mắt', 'Cái mũi', 'Cái miệng', 'Lỗ tai|cái tai', 'Cái răng', 'Mái tóc|tóc'],
    medium: ['Bộ râu|râu', 'Người khổng lồ', 'Siêu nhân', 'Sinh đôi|cặp sinh đôi', 'Ông già Noel|ông già nô en|santa',
      'Nàng tiên cá|tiên cá', 'Phù thuỷ|phù thủy', 'Ninja', 'Cướp biển|hải tặc', 'Xác ướp', 'Ma cà rồng',
      'Người ngoài hành tinh', 'Hiệp sĩ', 'Công chúa', 'Hoàng tử', 'Nhà vua|vua', 'Nữ hoàng'],
    hard: ['Thiên thần', 'Người que', 'Tóc xoăn', 'Nụ cười', 'Lông mày', 'Tóc đuôi ngựa', 'Cái cằm'],
  },
  'nghe-nghiep': {
    label: 'Nghề nghiệp',
    easy: ['Bác sĩ', 'Y tá', 'Giáo viên|cô giáo|thầy giáo', 'Ca sĩ', 'Đầu bếp', 'Nông dân', 'Cảnh sát|công an',
      'Lính cứu hoả|lính cứu hỏa', 'Thợ cắt tóc', 'Ngư dân'],
    medium: ['Phi hành gia', 'Phi công', 'Thợ điện', 'Thợ mộc', 'Thợ xây', 'Hoạ sĩ|họa sĩ', 'Nhiếp ảnh gia|thợ chụp ảnh',
      'Người đưa thư|bưu tá', 'Shipper|người giao hàng', 'Thợ săn', 'Bộ đội|chú bộ đội', 'Ảo thuật gia', 'Vận động viên',
      'Thủ môn', 'Cầu thủ', 'Tài xế|lái xe', 'Nha sĩ'],
    hard: ['Thợ lặn', 'Lính gác', 'Chú hề', 'Kiến trúc sư', 'Thám tử', 'Người dẫn chương trình|mc', 'Lập trình viên',
      'Thợ sửa xe', 'Nhạc trưởng', 'Bảo vệ'],
  },
  'do-an': {
    label: 'Đồ ăn',
    easy: ['Bánh mì', 'Quả trứng', 'Cây kem|kem', 'Dưa hấu', 'Quả chuối', 'Quả xoài', 'Quả táo', 'Bát cơm|chén cơm|cơm',
      'Viên kẹo', 'Bánh kem|bánh sinh nhật', 'Trà sữa', 'Hộp sữa', 'Cà rốt', 'Bắp ngô|bắp|ngô', 'Chùm nho|nho',
      'Quả dứa|quả thơm', 'Quả cam'],
    medium: ['Phở bò|phở|tô phở', 'Bún chả', 'Sầu riêng', 'Cà phê sữa đá|cà phê|cafe', 'Bánh chưng', 'Nem rán|chả giò',
      'Bánh xèo', 'Chè ba màu', 'Măng cụt', 'Thanh long', 'Cơm tấm', 'Bánh trung thu', 'Hột vịt lộn|trứng vịt lộn',
      'Xúc xích', 'Bánh pizza|pizza', 'Bánh hamburger|hamburger', 'Mì tôm|mì gói', 'Bỏng ngô|bắp rang bơ|popcorn'],
    hard: ['Bánh tráng trộn', 'Bún đậu mắm tôm', 'Nồi lẩu|lẩu', 'Gỏi cuốn|nem cuốn', 'Bánh bèo', 'Cơm cháy',
      'Cà phê trứng', 'Ốc luộc', 'Bánh cuốn', 'Xôi gấc'],
  },
  'phuong-tien': {
    label: 'Phương tiện',
    easy: ['Xe đạp', 'Xe máy', 'Ô tô|xe hơi', 'Xe buýt|xe bus', 'Tàu hoả|tàu hỏa|xe lửa', 'Máy bay', 'Chiếc thuyền|con thuyền',
      'Tàu thuỷ|tàu thủy', 'Xe tải'],
    medium: ['Trực thăng|máy bay trực thăng', 'Tàu ngầm', 'Xe cứu thương', 'Xe cứu hoả|xe cứu hỏa', 'Xe cảnh sát',
      'Khinh khí cầu', 'Tên lửa', 'Xích lô', 'Ván trượt', 'Xe lăn', 'Xe đẩy em bé|xe nôi', 'Ca nô', 'Xe taxi|taxi'],
    hard: ['Xe ôm công nghệ|xe ôm|grab', 'Tàu điện ngầm|metro', 'Thuyền thúng', 'Cáp treo', 'Đĩa bay', 'Máy ủi|xe ủi',
      'Máy xúc|xe xúc', 'Tàu lượn siêu tốc', 'Dù lượn'],
  },
  'dia-diem': {
    label: 'Địa điểm',
    easy: ['Ngôi nhà', 'Trường học', 'Bệnh viện', 'Cái chợ|chợ', 'Công viên', 'Bãi biển', 'Sân bóng', 'Cây cầu',
      'Ngôi chùa', 'Lâu đài'],
    medium: ['Siêu thị', 'Thư viện', 'Sân bay', 'Nhà ga|ga tàu', 'Rạp chiếu phim|rạp phim', 'Sở thú|vườn thú|thảo cầm viên',
      'Bể bơi|hồ bơi', 'Nhà thờ', 'Tiệm cắt tóc|tiệm tóc', 'Cây xăng|trạm xăng', 'Ngã tư', 'Bến xe', 'Khách sạn',
      'Ngọn hải đăng|hải đăng', 'Kim tự tháp'],
    hard: ['Chợ Bến Thành', 'Chùa Một Cột', 'Hồ Gươm|hồ hoàn kiếm', 'Cầu Rồng', 'Vịnh Hạ Long', 'Tháp Eiffel|tháp ép phen',
      'Vạn Lý Trường Thành', 'Nhà rông', 'Chợ nổi', 'Phố cổ Hội An|phố cổ hội an|hội an'],
  },
  'thien-nhien': {
    label: 'Thiên nhiên',
    easy: ['Mặt trời', 'Mặt trăng', 'Ngôi sao', 'Đám mây', 'Cơn mưa|mưa', 'Cầu vồng', 'Ngọn núi', 'Cái cây',
      'Bông hoa', 'Chiếc lá', 'Biển', 'Dòng sông', 'Tuyết', 'Ngọn lửa', 'Hòn đá'],
    medium: ['Núi lửa', 'Thác nước', 'Hoa sen', 'Hoa mai', 'Hoa đào', 'Cây dừa', 'Xương rồng', 'Tia sét|sấm sét',
      'Cơn gió|gió', 'Hang động', 'Hòn đảo', 'Sa mạc', 'Khu rừng|rừng', 'Hồ nước', 'Ruộng bậc thang',
      'Hoa hướng dương|hướng dương', 'Cây nấm'],
    hard: ['Lốc xoáy|vòi rồng', 'Sóng thần', 'Lũ lụt', 'Nhật thực', 'Cực quang', 'Sao băng', 'San hô', 'Đồi cát',
      'Thiên thạch', 'Sao Thổ'],
  },
  'hoat-dong': {
    label: 'Hoạt động',
    easy: ['Ngủ|đi ngủ', 'Ăn cơm', 'Chạy bộ', 'Bơi lội|bơi', 'Ca hát|hát', 'Nhảy múa', 'Khóc', 'Cười', 'Đá bóng|đá banh',
      'Đọc sách', 'Tắm', 'Câu cá'],
    medium: ['Nấu ăn', 'Chụp ảnh|chụp hình', 'Đánh răng', 'Thả diều', 'Leo núi', 'Cắm trại', 'Trượt tuyết', 'Gội đầu',
      'Tưới cây', 'Đạp xe', 'Chống đẩy|hít đất', 'Ngáp', 'Hắt hơi', 'Vẫy tay', 'Ôm nhau', 'Đi chợ', 'Lướt sóng', 'Nhảy dây'],
    hard: ['Múa lân', 'Kéo co', 'Đá cầu', 'Ô ăn quan|chơi ô ăn quan', 'Bịt mắt bắt dê', 'Trốn tìm|chơi trốn tìm',
      'Tập yoga|yoga', 'Hát karaoke|karaoke', 'Bập bênh|chơi bập bênh', 'Chụp ảnh tự sướng|selfie|tự sướng'],
  },
  'truong-hoc': {
    label: 'Trường học',
    easy: ['Bút chì', 'Cục tẩy|cục gôm|gôm', 'Thước kẻ', 'Cặp sách|ba lô|balo', 'Quyển vở', 'Quyển sách', 'Bảng đen',
      'Viên phấn', 'Bàn học', 'Bút mực'],
    medium: ['Hộp bút', 'Com pa|compa', 'Máy tính bỏ túi|máy tính cầm tay', 'Quả địa cầu', 'Kính hiển vi', 'Giấy khen',
      'Đồng phục', 'Khăn quàng đỏ', 'Lớp học', 'Giờ ra chơi', 'Bảng cửu chương', 'Bút bi', 'Ống nghiệm', 'Trống trường'],
    hard: ['Đi thi|kỳ thi', 'Lễ khai giảng|khai giảng', 'Bằng tốt nghiệp', 'Phòng thí nghiệm', 'Thời khoá biểu|thời khóa biểu',
      'Trả bài|kiểm tra miệng', 'Điểm mười|điểm 10', 'Học thêm'],
  },
  'cong-nghe': {
    label: 'Công nghệ',
    easy: ['Điện thoại', 'Máy tính', 'Cái tivi|ti vi', 'Tai nghe', 'Cục pin', 'Máy ảnh|máy chụp hình|camera', 'Cái loa',
      'Chuột máy tính'],
    medium: ['Robot|người máy', 'Flycam|drone|máy bay không người lái', 'Bàn phím', 'Máy in', 'Đồng hồ thông minh',
      'Sạc dự phòng|pin dự phòng', 'Wifi|wi fi', 'USB', 'Tay cầm chơi game|máy chơi game', 'Kính thực tế ảo|kính vr',
      'Vệ tinh', 'Mã QR|qr'],
    hard: ['Tấm pin mặt trời|pin mặt trời', 'Xe tự lái', 'Máy in 3D', 'Phát trực tiếp|livestream|live stream',
      'Gậy tự sướng', 'Ổ cứng', 'Cột phát sóng|tháp phát sóng', 'Thẻ ATM|thẻ ngân hàng'],
  },
  'doi-song': {
    label: 'Đời sống',
    easy: ['Áo dài', 'Nón lá', 'Đèn lồng', 'Bao lì xì|lì xì', 'Pháo hoa', 'Bóng bay|bong bóng'],
    medium: ['Trà đá vỉa hè|trà đá', 'Kẹt xe|tắc đường', 'Đám cưới', 'Tết Trung thu|trung thu', 'Mâm ngũ quả',
      'Cây nêu', 'Bàn thờ', 'Chợ Tết', 'Gánh hàng rong|hàng rong', 'Ghế nhựa', 'Quán nhậu', 'Áo mưa',
      'Mũ bảo hiểm|nón bảo hiểm', 'Đèn ông sao'],
    hard: ['Múa rối nước|rối nước', 'Đờn ca tài tử', 'Rước dâu', 'Câu đối đỏ|câu đối', 'Ông đồ|xin chữ',
      'Đèn hoa đăng|thả đèn hoa đăng', 'Đua ghe|đua thuyền', 'Ông Công ông Táo|cúng ông táo'],
  },
  'thanh-ngu': {
    label: 'Thành ngữ (khó)',
    off: true,
    easy: [],
    medium: [],
    hard: ['Ếch ngồi đáy giếng', 'Mèo mù vớ cá rán', 'Đàn gảy tai trâu', 'Nước đổ lá khoai', 'Cá lớn nuốt cá bé',
      'Vắt chanh bỏ vỏ', 'Ném đá giấu tay', 'Ăn cháo đá bát', 'Nước chảy đá mòn', 'Mưa dầm thấm lâu',
      'Đứng núi này trông núi nọ', 'Một con ngựa đau cả tàu bỏ cỏ', 'Có công mài sắt có ngày nên kim', 'Gieo gió gặt bão',
      'Chó cắn áo rách', 'Tre già măng mọc', 'Ăn quả nhớ kẻ trồng cây', 'Thả hổ về rừng', 'Cưỡi ngựa xem hoa', 'Nuôi ong tay áo'],
  },
};

const DIFFS = ['easy', 'medium', 'hard'];
/** @typedef {{w: string, d: 'easy'|'medium'|'hard', t: string, a: string[]}} Word */

/** @type {Word[]} */
const WORDS = [];
for (const [t, cat] of Object.entries(BANK)) {
  for (const d of DIFFS) {
    for (const entry of cat[d]) {
      const [w, ...a] = entry.split('|').map((s) => s.trim()).filter(Boolean);
      WORDS.push({ w, d, t, a });
    }
  }
}

/** Nhãn chủ đề hiển thị cho client. */
const TOPICS = Object.fromEntries(Object.entries(BANK).map(([k, v]) => [k, v.label]));
/** Chủ đề bật sẵn khi tạo phòng (thành ngữ tắt vì khó vẽ). */
const DEFAULT_TOPICS = Object.entries(BANK).filter(([, v]) => !v.off).map(([k]) => k);

/** Phân bổ độ khó theo số từ được chọn. */
const PATTERNS = {
  1: ['medium'],
  2: ['easy', 'hard'],
  3: ['easy', 'medium', 'hard'],
  4: ['easy', 'medium', 'medium', 'hard'],
  5: ['easy', 'easy', 'medium', 'hard', 'hard'],
};

function difficultyFromLength(word) {
  const syl = word.trim().split(/\s+/).length;
  return syl <= 1 ? 'easy' : syl <= 3 ? 'medium' : 'hard';
}

const keyOf = (w) => w.normalize('NFC').toLocaleLowerCase('vi');

/**
 * Chọn `count` từ cho người vẽ. Không trùng nhau trong cùng lượt.
 * Ưu tiên: từ chưa từng xuất hiện trong trận → từ đã được đưa ra nhưng không ai chọn → (bất đắc dĩ) từ đã vẽ.
 * Nhờ vậy người vẽ trước không "biết trước" đáp án của lượt sau khi ngân hàng từ còn đủ.
 * Từ tự thêm: nếu `customOnly` thì chỉ dùng từ tự thêm; nếu không, mỗi ô có 40% cơ hội lấy từ tự thêm cùng độ khó.
 * @param {{count?:number, topics?:string[], used:Set<string>, seen?:Set<string>, custom?:string[], customOnly?:boolean, rand?:Function}} o
 *   used = từ đã được chọn để vẽ trong trận, seen = từ đã từng được đưa ra cho người vẽ
 * @returns {Word[]}
 */
function pickOptions({ count = 3, topics, used, seen = new Set(), custom = [], customOnly = false, rand = Math.random }) {
  const n = Math.max(1, Math.min(5, count | 0));
  const taken = new Set();
  const notUsed = (list) => list.filter((x) => !used.has(keyOf(x.w)) && !taken.has(keyOf(x.w)));
  const fresh = (list) => notUsed(list).filter((x) => !seen.has(keyOf(x.w)));
  const pickFrom = (list) => {
    const x = list[Math.floor(rand() * list.length)];
    taken.add(keyOf(x.w));
    return x;
  };
  const customEntries = custom.map((w) => ({ w, d: difficultyFromLength(w), t: 'custom', a: [] }));

  if (customOnly && customEntries.length >= 3) {
    const out = [];
    for (let i = 0; i < n; i++) {
      let pool = fresh(customEntries);
      if (!pool.length) pool = notUsed(customEntries);
      if (!pool.length) pool = customEntries.filter((x) => !taken.has(keyOf(x.w)));
      if (!pool.length) break;
      out.push(pickFrom(pool));
    }
    return out;
  }

  const enabled = topics && topics.length ? WORDS.filter((x) => topics.includes(x.t)) : WORDS.filter((x) => DEFAULT_TOPICS.includes(x.t));
  return PATTERNS[n].map((d) => {
    const customPool = fresh(customEntries.filter((x) => x.d === d));
    if (customPool.length && rand() < 0.4) return pickFrom(customPool);
    // Ưu tiên trong chủ đề đã bật: từ mới đúng độ khó → từ mới bất kỳ → từ từng đưa ra nhưng chưa vẽ → rồi mới tới toàn bộ ngân hàng
    const tries = [
      () => fresh(enabled.filter((x) => x.d === d)),
      () => fresh(enabled),
      () => notUsed(enabled.filter((x) => x.d === d)),
      () => notUsed(enabled),
      () => notUsed(WORDS.filter((x) => x.d === d)),
      () => WORDS.filter((x) => !taken.has(keyOf(x.w))),
    ];
    for (const get of tries) { const pool = get(); if (pool.length) return pickFrom(pool); }
    return pickFrom(WORDS);
  });
}

module.exports = { WORDS, TOPICS, DEFAULT_TOPICS, BANK, PATTERNS, pickOptions, difficultyFromLength };
