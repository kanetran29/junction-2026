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

### 5. Cách gắn vào Worker (việc của phiên build, khi merge)
- `demo/` là file tĩnh thuần, không cần build. Phục vụ tại `/demo` bằng Workers static assets, ví dụ trong `wrangler.jsonc`: `"assets": { "directory": "./demo-public" }` với `demo-public/demo` trỏ (copy) tới `demo/`, hoặc route `/demo/*` đọc từ binding `ASSETS`. Khi cùng origin, ô "Gateway URL" để trống là dùng luôn gateway đó, không cần CORS.
- Không đưa `demo/dev/` và `demo/test/` ra ngoài (chỉ dùng khi phát triển).

### 6. Video mẫu (xong)
- `demo/story.mp4`: 2:00, 1920×1080, 60 khung/giây (bản đầu 30), H.264 yuv420p, faststart, không tiếng. Quay từng khung (`?manual=1`, mỗi khung `window.__step(1/60)`) nên chuyển động mượt và lặp lại y hệt nếu quay lại.
- Quay lại: chạy `node demo/dev/fake-gateway.mjs` (cổng 8790), rồi script quay trong phiên này (Playwright + ffmpeg, Chrome có GPU Metal). Cách nhanh hơn để lấy cảnh cho video pitch: mở `http://localhost:8790/?kiosk=1&autoplay=1` toàn màn hình rồi quay màn hình.
- 60 khung/giây thay vì 24 theo quy ước của skill quay video: đây là hoạt hình, cần mượt.

### 7. Bản màu sắc + hiệu ứng (theo yêu cầu của Kane, Thứ Bảy 14/11)
- Bảng màu đậm: mỗi vật liệu có một màu `--c`, kit tự pha 4 mặt bóng + mặt trên + nét viền (`demo.css`, `.m`). Lazydoor có màu thương hiệu tím `#6c47ff` (cổng, cột, rào, bảng trạng thái, chữ LAZYDOOR trên dầm). Kho Valio tường xanh navy, kệ cột xanh dầm cam, xe tải cabin xanh Valio, bếp gạch cam đất + tủ xanh ngọc, chef áo trắng khăn đỏ, robot agent xanh ngọc, robot ngây thơ xám.
- Ánh đèn ấm trong kho bằng WebGL (`demo/kit/gl.mjs` của skill anatomy): 4 đèn tường trên 4 kệ, vùng sáng tính trong không gian thế giới trên sàn bê tông và tường kho (cảnh tách thành SVG sau / canvas / SVG trước). Đèn sáng dần khi trời tối.
- Hiệu ứng (đều chạy theo thời gian của câu chuyện, không theo đồng hồ máy, nên Story mode quay ra y hệt mỗi lần):
  - Con dấu: huy hiệu lớn cạnh cổng đập xuống (phóng to rồi bật về), quầng sáng và 2 vòng sóng xung kích; xanh ✓ AUTO, vàng ! NEEDS APPROVAL, đỏ ✕ REJECT.
  - Kệ CUTOFF_PASSED: đèn báo động đỏ nhấp nháy + quầng đỏ, thanh khóa sập xuống có nảy.
  - Điện thoại: rung + 3 vòng xung lan ra khi chờ duyệt.
  - order.accepted: thùng hàng bay theo đường cong từ kệ lên xe, pháo giấy 64 mảnh; xe chạy đi có khói xả và vệt tốc độ.
  - Xe của agent ngây thơ: ho ra khói đen, rung giật, đứng dưới đám mây mưa xám.
- Bầu trời đổi theo đồng hồ tới hạn chót: ngày (Thứ Bảy 10:15) → chiều vàng → tối tím hồng (Chủ Nhật 15:50) → đỏ thẫm khi phê duyệt hết hạn. Kịch bản có thêm 3 lần đặt đồng hồ (Thứ Bảy 16:40, Chủ Nhật 11:20, Chủ Nhật 15:50) để trời chuyển dần.
- Dễ đọc trên máy chiếu/video 1080p: phụ đề to trên nền tối, mỗi trạng thái màu đều có biểu tượng + chữ (✓/!/✕, khóa, cảnh báo, chuông, đồng hồ) để người mù màu vẫn đọc được.
- `prefers-reduced-motion`: tắt pháo giấy, sóng xung kích, khói, mưa rơi, vòng xung; trạng thái vẫn hiện (huy hiệu, đèn đỏ sáng đứng, mây đứng yên).
- Hiệu năng: đo trên Chrome có GPU (Metal, M4 Pro) ở 1920×1080 đoạn bận nhất (giây 58–62): 108 khung/giây headless, 144 có cửa sổ. Lớp WebGL chỉ vẽ lại khi độ sáng đèn đổi.
- Video `demo/story.mp4` quay lại ở 60 khung/giây.

## Còn lại / cần làm sau
- Test Live với `wrangler dev` khi `main` có route `/v1/events`, `/v1/events/stream`, `/v1/interpret`; khi đó kiểm tra tên trường trong `sendRequest` (`demo/live.mjs`).
- Gắn `demo/` vào Worker tại `/demo` (mục 5).
