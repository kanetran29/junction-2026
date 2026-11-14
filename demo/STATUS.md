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

### 8. Thế giới đậm màu + logo Valio Aimo (theo phản hồi "it's all white")
- Bỏ giao diện giấy trắng của anatomy cho demo này: nền trời xanh thẫm → tím (chuyển sang tím hồng, cam lúc gần hạn chót, đỏ thẫm khi phê duyệt hết hạn), "đảo" nền xanh ngọc trên mặt đất tím, sàn kho xanh dương, tường kho gạch cam có cửa sổ sáng đèn, kệ mã màu theo nhóm hàng (tím: hộp 10 l, vàng: Arla, xanh dương: Valio 1 l, xanh lá: hàng thay thế), chef áo đỏ, robot thân xanh ngọc đầu vàng, xe tải thùng vàng cabin xanh, điện thoại tím có màn hình phát sáng theo trạng thái.
- Bóng và sáng có màu: mặt khuất pha về chàm `#1d1452`, mặt trên pha về ánh vàng ấm `#fff3d1` (vẫn 4 tông của kit nhưng trên màu bão hòa). Bóng đổ dưới vật màu chàm.
- Đèn kho: vùng sáng vàng đặt có chủ đích (một vũng sáng trước mỗi kệ, một vệt hắt xuống tường dưới mỗi đèn) thay cho suy giảm 1/r², vì cách cũ phủ cam lên sàn xanh thành màu xám tím.
- Khung trang tối và có màu (nền chàm, nút tím thương hiệu); trang mặc định `theme=dark`.
- Logo Valio Aimo chính thức: `demo/assets/valio-aimo-logo.svg`, lấy từ logo đầu trang https://www.valioaimo.fi/ (liên kết "Valio Aimo" trỏ tới file SVG trên CDN của Valio; trang tải về không có `<svg>` nội tuyến mà dùng `<img>` tới file này, cùng viewBox `0 0 537.17 179.06`, 2.8 KB). Giữ nguyên từng byte, chỉ thêm một dòng chú thích nguồn và ngày ở đầu. Dùng không sửa (chỉ thu phóng, không nghiêng): biển trên tường kho (đặt trên tấm trắng, quay thẳng về người xem), màn kết "Lazydoor for [logo]", và chip nhỏ ở đầu trang "for [logo] Junction 2026".
- Valio Aimo logo © Valio Ltd, used for the Junction 2026 Trusted Trade Agents challenge demo.

### 9. Audit theo design-taste-frontend (trước khi sửa, phản hồi "truck looks ugly, colours half-hearted", "text too small")
Design read: cảnh hoạt hình isometric cho video pitch 2 phút và màn chiếu trước giám khảo (doanh nghiệp, procurement), ngôn ngữ "diorama đồ chơi có ánh sáng", hướng tới một bảng màu thương hiệu có chủ đích thay vì giao diện giấy của kit anatomy. Skill này viết cho landing page; ở đây chỉ áp các phần màu, chữ, chất liệu, chuyển động, độ tương phản. Dial: VARIANCE 6, MOTION 7 (hoạt hình kể chuyện, có reduced-motion), DENSITY 4.

Ảnh trước: [toàn cảnh](shots/before-scene.png), [xe tải](shots/before-truck.png), [bếp và cửa](shots/before-kitchen-door.png).

Vấn đề tìm thấy:
1. Màu: tím nền + tím thương hiệu + tím giao diện là đúng "AI purple" mà skill cấm làm mặc định (LILA rule). Bảy tám màu nhấn ngang nhau (tím, xanh ngọc, cam, vàng, đỏ, xanh lá, xanh dương) nên không màu nào dẫn mắt: "half-hearted".
2. Màu vẫn là "giấy được tô": mặt khuất pha đen, sàn kho bị đèn phủ thành tím xám, nhiều mặt nhạt (tường lilac, rào lilac, đỉnh khối sáng gần trắng).
3. Glow ngoài (con dấu, điện thoại, đèn báo) dùng khắp nơi; skill cấm neon/outer glow mặc định. Giữ lại một chỗ có chủ đích.
4. Xe tải: một khối thùng hở có tấm bạt, bánh là hình elip phẳng, không vòm bánh, không kính chắn gió, không đèn, không cản; bảng "MON 16 NOV" lơ lửng trên nóc. Tỉ lệ cabin/thùng sai.
5. Chef, robot, cửa, kho: ít chi tiết (chef là ống trụ, robot là hai hộp, cửa là cột + tấm, kho là một mặt tường).
6. Chữ trong cảnh 10 đến 14 px ở 1080p (nhãn kệ, mã lý do trên bảng cửa, màn hình điện thoại, đồng hồ, biển đích). Không đọc được ở khoảng cách máy chiếu.
7. Icon vẽ tay (đường SVG tự viết); skill yêu cầu thư viện icon. Font hệ thống + mono cho mọi thứ.
8. Nhãn kiểu "FIG 1 · LAZYDOOR · VALIO AIMO" ở góc là eyebrow trang trí; dấu chấm giữa (·) dùng quá dày; còn dấu gạch dài "—" trên điện thoại và đồng hồ (skill cấm em-dash).
9. Bán kính bo góc lẫn lộn (phụ đề, huy hiệu, bảng, chip) không theo một thang.
10. Câu chuyện: xe tải chạy ra khỏi bàn thay vì giao tới bếp của chef (Kane hỏi "why does the truck drive away instead of to the chef?").

### 10. Làm lại theo một hướng mỹ thuật: "Petrol night, signal colours"
- Một bảng màu duy nhất cho cả cảnh và khung trang: màu petrol của logo Valio Aimo (`#005670`) làm nền đêm, một màu thương hiệu Lazydoor là magenta `#ff2e88` (cổng, rào, biển LAZYDOOR, nút), ánh sáng ấm amber là nguồn sáng duy nhất (đèn kho, cửa sổ, đèn xe), vật thể dùng một bộ màu cố định (gạch cho kho, cobalt cho xe Valio và kệ, vàng chanh cho chef và thùng xe, san hô cho robot, 4 màu thùng hàng theo nhóm). Bóng pha về petrol đậm, mặt trên pha về ánh vàng, nên bóng và sáng đều có màu. Không còn mặt trắng hay xám chiếm diện tích (tấm biển logo trắng là để logo đủ tương phản). Chỉ một ánh phát sáng có chủ đích (biển LAZYDOOR và đèn).
- Font Geist và Geist Mono (OFL, `demo/assets/fonts/`), icon Phosphor (MIT, `demo/icons.mjs`), thay icon vẽ tay. Một thang bo góc 10 px. Bỏ nhãn góc kiểu "FIG 1 ·", bỏ dấu gạch dài.
- Dựng lại có chi tiết theo cách của skill anatomy: xe tải cabin kiểu châu Âu (kính chắn gió, cần gạt, lưới tản nhiệt, đèn pha, đèn sương mù, biển số, cản, đèn nóc, cửa sổ hông, cửa, tay nắm, bậc lên, gương, ống xả đứng, bình nhiên liệu, thùng có gân, dải sơn VALIO AIMO, đèn hông, vòm bánh, lốp, mâm, ốc, chắn bùn); chef (giày, quần, áo vàng hai hàng cúc, tạp dề có túi, khăn quàng, mặt có ria và má hồng, mũ có nếp, tay xuống hoặc giơ ngón cái); robot (bánh xích, ngực có màn hình và đèn, khe thông gió, vai, đầu có tai và kính); cổng (đế bắt bu lông, cột, dầm, đầu quét, đèn hiệu, biển LAZYDOOR, cánh cửa có ô, cửa sổ, tấm đá chân, con dấu); kho (gạch có mạch so le, trụ gạch, gờ mái, 4 cửa sổ sáng, đồng hồ treo tường có kim chạy theo giờ của cổng, đèn tường, biển logo).
- Vòng câu chuyện mới (Kane hỏi vì sao xe chạy đi mà không tới chef): đường từ bến kho tới bếp, có rào chắn Lazydoor ở hàng rào. Khi order.accepted: thùng hàng bay từ kệ lên xe, pháo giấy, rào nâng (đèn xanh), xe chạy tới bếp có khói và vệt tốc độ, dỡ thùng lên quầy, chef giơ ngón cái, thẻ hoá đơn hiện, lịch bếp lật sang MON 16, rồi xe quay về bến. Xe của agent ngây thơ chạy tới rào rồi đứng đó dưới mây mưa (rào đỏ, hết hạn chót), quầy bếp trống. REJECT hoặc phê duyệt hết hạn: xe không chạy.
- Chữ: mọi chữ trong cảnh chuyển thành nhãn màn hình (không còn chữ nhỏ trên mặt vật thể). Nhỏ nhất 23 đơn vị viewBox = 27,6 px ở 1080p (1/40 chiều cao), phụ đề 2,5% chiều rộng = 48 px, số lớn (đếm ngược) 3,1% = 60 px, hoá đơn 30 đơn vị = 36 px. Vị trí cố định để không chồng nhau: sự kiện góc trên trái, đồng hồ hạn chót góc trên phải, quyết định của cổng (con dấu + lý do bằng lời) góc dưới phải, nhãn kệ ngay trên từng kệ, nhãn điện thoại bên trái điện thoại, hoá đơn trên tường bếp. Nhãn bị kẹp trong khung hình.
- Kiểm tra: ảnh 1080p xem ở 50% (khoảng cách laptop/máy chiếu), đọc được mọi chữ: [toàn cảnh 50%](shots/after-scene-50pct.png).
- Ảnh sau: [toàn cảnh](shots/after-scene.png), [xe tải](shots/after-truck.png), [bếp và chef](shots/after-kitchen-chef.png), [cổng và robot](shots/after-door-robot.png), [kho](shots/after-warehouse.png), [giao hàng tới bếp](shots/after-delivery.png).
- Kịch bản dài 123 giây (thêm 4 giây cho xe tới bếp). Hiệu năng vẫn trên 60 khung/giây ở 1080p (đo lại trước khi quay).

## Còn lại / cần làm sau
- Test Live với `wrangler dev` khi `main` có route `/v1/events`, `/v1/events/stream`, `/v1/interpret`; khi đó kiểm tra tên trường trong `sendRequest` (`demo/live.mjs`).
- Gắn `demo/` vào Worker tại `/demo` (mục 5).
