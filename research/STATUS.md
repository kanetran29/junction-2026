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
