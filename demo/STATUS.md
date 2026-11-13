# Demo hoạt hình Lazydoor: trạng thái (gửi Kane)

Nhánh `demo-animation`, thư mục `demo/`. Mới nhất ở dưới.

## Nhật ký

### 1. Kế hoạch (xong)
- Plan: `docs/superpowers/plans/2026-11-14-lazydoor-demo-animation.md`.
- `docs/events.md` chưa có trên `main`; đang bám schema trong brief. Cần kiểm lại trước khi merge.

### 2. Logic có test (xong)
- `demo/model.mjs`: reducer sự kiện → trạng thái cảnh (chef, agent, cửa, kệ, điện thoại, xe tải, đồng hồ).
- `demo/story.mjs`: kịch bản 120 giây, số liệu thật (464306, 1,010.00 €, 463038 CUTOFF_PASSED, Arla 469363 còn 384, 470863 NEW_ALLERGEN).
- `demo/live.mjs`: SSE qua `fetch` (có header Bearer), tự chuyển sang polling, thử lại khi gateway sập; phát lại file JSON; ô nhập yêu cầu của giám khảo.
- Chạy test: `node --test demo/test/*.test.mjs` (25 pass).

### 3. Cảnh isometric + hai chế độ (xong)
- `demo/scene.mjs`: cảnh dựng bằng kit anatomy (`demo/kit/`, bản sao MIT): bếp khách sạn + chef, robot agent (cầm thẻ draft/quote/receipt), Lazydoor (cổng, cánh cửa, máy quét, đèn tem AUTO xanh / NEEDS_APPROVAL vàng / REJECT đỏ, bảng lý do), kho Valio 4 kệ (khóa đỏ CUTOFF_PASSED, "384 left", gạch chéo NEW_ALLERGEN), điện thoại quản lý (Approve/Reject, xám khi hết hạn), đồng hồ cut-off, xe tải chở thùng đi "MON 16 NOV".
- `demo/index.html` + `main.mjs`: Story (play/pause/tua, phím cách, mũi tên) và Live (URL gateway hoặc file .json, API key, buyer, ô gõ yêu cầu của giám khảo).
- Tham số URL: `?mode=live&gateway=…&key=…&buyer=…`, `?theme=dark`, `?kiosk=1` (chỉ sân khấu, để quay), `?autoplay=1`, `?t=56` (nhảy tới giây 56), `?manual=1` (quay từng khung).
- Chạy thử: `node demo/dev/fake-gateway.mjs` rồi mở http://localhost:8790 (cờ `--story` phát sự kiện mẫu, `--no-sse` ép polling).

### 4. Kiểm tra Live (xong với gateway giả; gateway thật: chờ)
- Gateway giả có SSE: chip "streaming", cảnh chạy đúng. Tắt SSE: tự sang "polling". Gateway chết: chip "down · Failed to fetch", cảnh vẫn đứng, không lỗi. File `demo/fixtures/sample-events.json`: phát lại đúng. Ô yêu cầu: "1,000 l lactose-free milk by Monday" → NEEDS_APPROVAL → điện thoại → xe tải; "some milk please" → dừng ở interpret: thiếu quantity.
- `docs/events.md` trên `main` (đã đọc): khớp với code. Chưa test `wrangler dev` vì `main` chưa có route `/v1/events` và `/v1/interpret`.
- Một chênh lệch nhỏ: rejection `STOCK_LIMITED` trong `docs/events.md` chỉ có `{productId, code}`. Kệ chỉ hiện "384 left" nếu gateway thêm `remaining` (hoặc có `stock.denied`); nếu không, kệ hiện "STOCK LIMITED".
- Ô yêu cầu gọi `POST /v1/interpret` → `/v1/drafts/{id}/confirm` (fill rỗng) → `/v1/quotes` → `/v1/orders` (Idempotency-Key). Cần đối chiếu lại khi route thật có (tên trường `draft.id`/`quote.id`, có cần `fill` không).
