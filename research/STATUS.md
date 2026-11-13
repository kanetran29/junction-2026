# Lazydoor: trạng thái build (gửi Kane)

Phiên build tự động, bắt đầu Thứ Bảy 14/11/2026. Mỗi bước xong là một mục mới ở cuối file, mới nhất ở dưới.

## Cần Kane quyết định

(chưa có)

## Nhật ký

### A1. Ghi lại quyết định D1–D6 vào spec (xong)
- Đã đọc hết `~/junction26-valio/REVIEW-2.md`.
- Thêm mục "Decisions after REVIEW-2" vào spec: D1 hạn mức tự động theo ngày giao = 500 € (cộng dồn), D2 đơn chờ duyệt không giữ kho,
  D3 yêu cầu mơ hồ → form có kiểu + bản đồ danh mục + tìm theo dịp, D4 độ tin cậy không rõ do người mua chọn (mặc định chỉ gắn cờ),
  D5 link duyệt chỉ vào hộp thư người duyệt, D6 áp diff mục 11 ngay.
- Đã copy dữ liệu Valio và bản ghi (Thứ Sáu 21:08) vào `.data/valio/` (gitignore, không commit).

### A2. Áp REVIEW-2 mục 10, 11, 13 (xong)
- Spec: áp đủ 11 điểm của diff mục 11 (luật công bố + chủ sở hữu, hạn mức ngày 500 €, `exp`/`aud`/`reliabilityUnknown`, policy theo giỏ,
  chỉ đơn ACCEPTED mới lấy kho trong một câu SQL, 3 kết quả khi duyệt lại, link duyệt chỉ ở hộp thư người duyệt, `rankedBy`/`summary`/
  thứ tự mã từ chối, giỏ hàng, resolve, `needs_input` + families, `/v1/rules`, non-goals).
- Plan: áp phần PLAN của diff + bảng hợp đồng HTTP giữa runner (Task 0) và routes (Task 10), để các subagent không lệch nhau.
  Ghi rõ: Gemini chưa có key → stub trong test, case cần model thật báo BLOCKED_ON_GEMINI; bản ghi Thứ Sáu 21:08 đã có, Task 4 chỉ còn replay.
- `research/acceptance/cases.json`: 49 case (đổi AC01/AC14/AC15/AC26, thêm AC29–AC49). Chạy lại oracle trên bản ghi: `expected_facts.json`
  khớp y hệt bản của REVIEW-2, và mọi giá trị mới trong case khớp với facts R2 (không có số viết tay).
- `research/ANALYSIS.md` mục 4.4: thay bằng 7 câu hỏi booth của REVIEW-2 mục 13.

### A3. Đổi tên thành Lazydoor (xong)
- Spec, plan, mock POC: tiêu đề "Lazydoor", câu khẩu hiệu "Lazy at the order, strict at the border."; plan ghi rõ package và Worker
  `lazydoor`, User-Agent `lazydoor/0.1`, tiêu đề OpenAPI và tên MCP server `lazydoor`. Giữ nguyên đường dẫn file và tên repo.
- "gateway"/"door" vẫn dùng như danh từ chung trong thân bài.

### A4. Dữ liệu (xong)
- `.data/valio/data/` và `.data/valio/recordings/` đã có (copy, không commit). `.dev.vars` có `VALIO_API_KEY` và `ADMIN_KEY` (gitignore, không in ra).

### B0–B1. Runner nghiệm thu + khung Worker (xong, đang review)
- Task 0 (`ecbc493`): runner chạy 49 case qua HTTP; khi chưa có gateway thì 49/49 FAIL "gateway unreachable" (RED đúng như plan).
- Task 1 (`915ad12`): Worker `lazydoor` (Hono + D1), schema, đồng hồ đặt được, `/health` báo `models.gemini: false`.
- Đang chạy: Task 2 (chỉ mục danh mục + subtype đã review cho sữa/gà/bơ). Review Opus cho Task 0 và 1 đang chạy song song.

### Thêm theo yêu cầu (Thứ Bảy 14/11)
- **Event stream cho trang demo**: schema ở `docs/events.md` (commit `b196d25`, đã push). Plan thêm `logEvent` (Task 3), các nơi phát
  event (Task 5, 7, 9, 10) và `GET /v1/events` + SSE `GET /v1/events/stream` (Task 10). Sẽ build theo thứ tự task bình thường.
- **Gemini**: key đã vào `.dev.vars` (gitignore, không in ra). Model mặc định `gemini-3.8-flash`. Thêm `scripts/check-secrets.sh` chạy như
  pre-commit hook (và trước `pnpm test`): fail nếu giá trị nào trong `.dev.vars` / `~/.config/junction2026/*.env` hay mẫu key Google
  nằm trong git index. Các case cần model (AC01, AC24, AC44) sẽ chạy thật khi Task 9 (interpret) xong.
- Lưu ý trung thực: khi kiểm tra file key, một lệnh `grep -c` bị hook RTK đổi thành lệnh in ra dòng chứa key, nên key hiện một lần
  trong transcript phiên local này. Key không nằm trong file nào của repo; guard ở trên chặn commit nếu có.

### B0–B1. Xong review
- Task 0 (runner): review Opus tìm 2 lỗi quan trọng (matcher `contains` trên object → AC26 sẽ fail oan; token duyệt lấy quá muộn → AC20 fail
  oan) + vài lỗi nhỏ; đã sửa (`f896577`), re-review sạch.
- Task 1 (khung): review tìm 1 lỗi quan trọng (test `/health` dùng giờ thật, sẽ đỏ đúng ngày demo); đã sửa (`298ca85`), re-review sạch.
- Đã push `main` tới `298ca85`. `pnpm test`: 29/29 xanh. Task 2 (chỉ mục) đang review; Task 3 (client Valio + replay) đang build.

### B2–B3. Chỉ mục, client Valio, mandate (xong)
- Task 2 (`6547c4b`): chỉ mục 17.546 sản phẩm; review Opus kiểm trên dữ liệu thật: search text khớp oracle 100 %, AC02 = 35. Approved.
- Task 3+4 (`62ccea4`): client Valio + replay (1.078 dòng), orderable, quy đổi, tiền, mã lý do, helper event. Review: mọi con số AC09/AC28/
  AC34 khớp oracle trên bản ghi thật. Approved (2 lỗi nhỏ an toàn chuyển sang Task 5).
- Task 6 (`1121647`..`21903d3`): mandate ký Ed25519. Review bảo mật Opus tìm 2 lỗi quan trọng (lưu mandate tin `aud` của chính token;
  chặn hạ version tự tắt khi có lỗi) → đã sửa, re-review sạch.
- Đang chạy: Task 5 (báo giá) và Task 12b (Gemini đặt tên 349 nhóm hàng, cần cho `interpret`).

### B4. Báo giá, đặt tên nhóm hàng, interpret
- Task 12b (`9d47938`, `f11b264`): Gemini đặt tên tiếng Anh cho 349/349 nhóm hàng (3 nhóm demo giữ tên đã review). Ghi chú chi phí: subagent
  lỡ chạy toàn bộ job khoảng 5 lần (~1 triệu token Gemini trên account lab); đã thêm chạy bù chỉ cho nhóm còn thiếu.
- Task 5 (`f6be902`, `e896c4e`): báo giá. Review Opus chạy trên bản ghi thật: AC01/03/05–12/17–19/27/32/34/43/46 đúng tới từng cent.
  Một lỗi quan trọng (AC40: "2 pcs" của sản phẩm không có lít/kg bị từ chối) đã sửa; thêm chống trùng ứng viên, chia lô ưu tiên hàng tham
  chiếu, VAT tính bằng số nguyên. Thứ tự mã từ chối: NEW_ALLERGEN đứng trước CLAIM_MISSING (AC17 cần), spec đã cập nhật cho khớp.
- Task 9 (`83d89ce`, `411a64b`, `b7b5e44`): `interpret` với `gemini-3.8-flash`. Chạy thật: AC01 và AC24 (có câu "ignore your limits") ra
  cùng draft 10400 / lactose-free / 1000 l / 16-11; AC44 (tiệc) ra `needs_input`. Review tìm 4 lỗi quan trọng (confirm xoá được ô
  "unclear"; bỏ qua nghi ngờ của model; buyer khác confirm được draft; thiếu kiểm hình dạng) → đã sửa, đang re-review.
- Đang chạy: Task 7 (policy, sổ kho, đơn hàng, duyệt).
