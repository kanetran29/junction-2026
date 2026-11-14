# Demo hoạt hình Lazydoor: trạng thái (gửi Kane)

Nhánh `demo-animation`, thư mục `demo/`. Mới nhất ở dưới.

## Ready for Kane's review

Story v2.1 theo `demo/SCRIPT.md` mục 14–15 (Kane duyệt 14/11): một câu chuyện liền, một bếp, một agent, Thứ Sáu → Thứ Hai, có giọng đọc mới. Mở http://localhost:8790/, bấm Play ("Sound on/off" cạnh thanh thời gian). Chưa quay `demo/story.mp4`: Kane xem trên trình duyệt trước.

- Dài **1:50** (110,0 s), 11 cảnh theo 11 đoạn lời: 0:00 Thứ Sáu 16:30 không có door · 0:15,6 tối Thứ Sáu dựng cổng · 0:21,8 21:10 cùng câu qua door · 0:38,4 giữ đơn, thư Lazydoor tới điện thoại manager, agent tự duyệt 403 · 0:51,6 gà 190,92 € AUTO, khách sạn kia STOCK_TAKEN · 1:04,4 "Which Friday?" · 1:12,4 Thứ Bảy 10:15 manager duyệt · 1:17,6 sữa yến mạch NEW_ALLERGEN · 1:24,4 Chủ nhật: chia đơn, giỏ 666,00 €, duyệt lúc 17:05 hết hạn · 1:37,4 Thứ Hai giao hàng, biên nhận · 1:44,4 màn kết.
- Event gateway lấy từ **lần chạy thật** chuỗi 14.6 trên door (52 event, cả 8 bước khớp): `demo/fixtures/story-v2.json`, chỉ giữ thứ hiện trên màn hình (loại event, id, trạng thái, mã lý do, số tiền, số đếm); không có tên sản phẩm, danh sách id ứng viên hay reply thô của Valio. `demo/dev/story-fixture.mjs` tạo lại file này từ `~/junction-2026/.data/story-v2.1-run.json`. `story.mjs` chỉ hẹn giờ cho từng event; đổi fixture mà lệch thứ tự thì test báo ngay.
- Giọng: Gemini TTS Charon, 11 đoạn `demo/assets/voice/01–11.mp3`, 98,7 s lời (khoảng lặng dài hơn 0,42 s được rút còn 0,42 s để vừa 1:50 mà không phải cắt cảnh 6). Trong input TTS viết "Vah-lee-oh"; Gemini nghe lại là "Valio" (đoạn 1, 3, 8) và "Valeo" (đoạn 4), không còn "Volio".
- Hình mới: điện thoại của manager trên quầy bếp (đứng trên đế sạc, cờ tên "Kitchen manager", rung và có vòng sáng khi có yêu cầu, ngón tay chạm khi duyệt); phong thư bay vòng qua robot: thẻ luật có chữ ký điện thoại → cổng, "from Lazydoor" cổng → điện thoại, "approved" điện thoại → cổng; bảng luật của bếp với thanh đo tổng ngày tới 1.500 € (vạch 500 € "per order", đơn chờ duyệt kẻ sọc, phần chia đơn 303 € đỏ); pallet "MON 16 NOV" ở bến, thùng được nhận nằm đó tới Thứ Hai; phong thư khách sạn kia bay từ mép trái. Robot đưa thư và dock giữ nguyên từ 956ad2f.
- Model: event của buyer khác (hotel-b) chỉ vào ticker, dấu ✕ ở khe và kệ "2 left", không kéo robot; tổng ngày suy từ quyết định của door (giỏ hàng = các báo giá từ quyết định trước); duyệt/hết hạn hiện lại thẻ quyết định của đúng đơn đó, kèm "Approved by Kitchen manager" hoặc "Approval expired · APPROVAL_EXPIRED".

Lệch so với 14.3 (lý do):
1. Bảng luật của bếp và thanh đo ở góc dưới trái (Z6) thay vì Z2: Z2 trên phải không đủ chỗ cho hai bảng + thanh đo mà Z4 vẫn nằm trên mui xe tải. Z2 giữ bảng luật của Valio ("Valio's rule · cut-off Sun 17:00", đếm ngược, giờ hiện tại); cảnh 1 Z2 chỉ có giờ. Thứ Hai biên nhận thay chỗ bảng luật.
2. Chữ trên phong thư ("from Lazydoor", "approve", "another hotel", "303.00 €") không vẽ trên phong thư bay (nó bay qua cổng và robot, vùng cấm); tên của từng thư nằm ở Z3/Z7, phong thư khác màu dấu niêm. Ba phong thư chia đơn là ba chip trong bảng luật, chip 303 € rơi vào thanh đo.
3. Dòng "Approve order · Net 1,010.00 € · Gross 1,146.35 € · Decide within 43 h" là thẻ Z3 nối tới điện thoại (màn hình điện thoại quá nhỏ để đọc); ghi "43 h 50 min" như trang duyệt thật đếm.
4. "6 left", "STOCK_TAKEN · 2 left" và "403 AGENT_CANNOT_APPROVE" nằm trong thẻ Z3/Z4; ở khe cổng chỉ có dấu ✕.
5. Lịch bếp dời sang trái (trên đầu chef) và kệ đĩa còn 2 đĩa, nhường đầu phải quầy cho điện thoại manager.
6. Live đã làm lại theo v2.1 (mục 25): chỉ xem, không key, theo dõi `hotel-a`; bản ghi Live mẫu cũ đã xoá.

Sửa theo Kane (SCRIPT.md mục 16, giọng không đổi): cảnh 1 có hậu quả (lịch MON 16 dấu đỏ "NO MILK", caption "Closed Thu 15:00. Monday: no milk."); cờ "Next delivery Mon 16 Nov" ở bến và thẻ "Accepted … · ships Mon 16 Nov" giải thích vì sao xe chỉ chạy Thứ Hai; một door cho mọi bếp (giá thẻ ba khe trên trụ cổng, thẻ của Kitchen B, C và Hotel Aurora bay vào, thẻ Aurora sáng; bảng "Valio's rules · same for every buyer" và "Hotel Aurora's rules · signed by its kitchen"; ghi chú "Another hotel: same door, its own rules.").

Cảnh 1 nhảy tới Thứ Hai rồi tua về Thứ Sáu (SCRIPT.md 16.4): Story giờ dài **1:54** (114,0 s), giọng giữ nguyên, các cảnh sau lùi 4 s.

Màn kết ghi cách agent nối vào (host, `/openapi.json`, `/mcp` 9 tool) thay cho hai icon phích cắm.

Kiểm tra: 44 test pass; `node demo/dev/label-overlap.mjs` báo `label overlaps: 0` (Story mỗi 0,25 s và Live; thêm bảng luật, cờ tên điện thoại, biển pallet vào danh sách chữ, điện thoại manager vào vật cấm). Live xem lần chạy thật phát qua gateway giả không lỗi console.

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

### 11. Sửa theo nhận xét của Kane lúc 1:24 (xe tải, chặn đúng chỗ luật tác động)
- Ảnh Kane chụp là bản trước (xe thùng bạt, giao diện cũ); xe đã được dựng lại ở mục 10. Kiểm tra lại cận cảnh 1080p: một khung gầm, cabin và thùng cùng trục và cùng mặt đất, bánh nằm dưới vòm và chạm đường, ánh sáng một hướng ([xe tải](shots/after-truck.png)).
- Bỏ hình ảnh "mây mưa, xe không chạy được": thời tiết không phải lý do đơn hỏng. Chặn xảy ra đúng nơi luật tác động:
  - Trong luồng Lazydoor: lúc có báo giá, mỗi sản phẩm ứng viên bay từ kệ tới máy quét của cổng; hàng bị loại bật lại với ✕ đỏ ở cổng và lý do ngay cạnh cổng; hàng được chọn qua với ✓. Khi chính sách ra REJECT, đơn bị dừng ở cổng (✕ ở cổng). Hàng bị loại không bao giờ tới bến hay xe ([cổng từ chối](shots/after-door-refusal.png)).
  - Agent ngây thơ: thùng từ kệ hộp 10 l bị cổng bến (thanh chắn trước đầu xe) từ chối với nhãn "Cut-off Thu 12 Nov 15:00"; xe trống, quầy bếp trống ([bến từ chối](shots/after-dock-refusal.png)).
  - Chờ duyệt: cổng bến đóng, đèn vàng, "Waiting for approval". Hết hạn: cổng bến đóng, "Approval expired", xe không chất hàng ([hết hạn](shots/after-expired.png)).
- Thanh chắn chuyển từ hàng rào ra cổng bến trước đầu xe; bỏ khoá đỏ, đèn báo và dấu X trên kệ (kệ chỉ còn icon trạng thái trên bảng tên).
- Bản quay 60 khung/giây làm trước nhận xét này nằm ngoài repo và không commit.

### 12. Sửa theo nhận xét lúc 0:23 (chef hành động, thùng xe mở hông, agent đứng ngoài cổng)
- Chef hành động: gõ yêu cầu vào màn hình bếp (màn hình sáng, chữ gõ dần, tay gõ), nhìn màn hình khi có yêu cầu duyệt và chạm để duyệt, giơ ngón cái khi hàng tới, nhún vai (hai tay ngửa) khi bến từ chối hoặc phê duyệt hết hạn. Màn hình bếp là thiết bị duyệt (chef là người được ủy quyền duyệt), phụ đề đổi theo.
- Thùng xe: bỏ mặt hông phía người xem, kiểu xe rèm cuốn (rèm cuộn dưới mái, có chữ VALIO AIMO), thấy được 8 chỗ thùng bên trong. Thùng hàng bay vào đúng chỗ khi được chấp nhận, đi cùng xe tới bếp rồi được dỡ ra; khi bến từ chối, xe trống. Vẫn là một xe, một khung gầm.
- Agent: chỉ đi giữa chef và vạch quét (vạch magenta trước cổng), đứng chờ ở đó, không bao giờ vào phía kho; khi đơn được chấp nhận thì quay về chef. Cánh cổng chỉ mở khi quyết định cho hàng qua. Agent ngây thơ cũng đi tới trước cổng rồi đứng ngoài.

### 13. Màn hình bếp lộ hoàn toàn, thẻ quyết định xuống góc, kiểm tra chồng chữ
- Chef chuyển sang bên phải màn hình bếp (không còn đứng trước màn hình); màn hình quay về người xem, có bàn phím nhỏ gắn bên hông, tay chef gõ trên bàn phím nên không che màn hình. Thứ tự vẽ: màn hình trước, chef sau, hai bên không chồng lên nhau.
- Thẻ quyết định (con dấu + lý do) neo vào góc dưới phải, đáy ngay trên chỗ phụ đề hai dòng bắt đầu. Ảnh Kane gửi là bản trước, khi nhãn bến còn nằm bên phải thanh chắn.
- Kiểm tra chồng chữ: `demo/dev/label-overlap.mjs` lấy khung bao màn hình của mọi chữ đang hiện (nhãn agent, ô chữ gõ, hoá đơn, thẻ quyết định, nhãn cổng, nhãn kệ, nhãn bến, nhãn màn hình, biển LAZYDOOR, biển logo, lịch, màn hình bếp, chữ VALIO AIMO trên xe, khung sự kiện, đồng hồ hạn chót, phụ đề) ở 1080p, cả Story và Live. Lần chạy đầu tìm ra 20 cặp; đã sửa:
  - Ô chữ gõ dời sang cột trái phía trên màn hình bếp (không đè lịch, biển LAZYDOOR).
  - Hoá đơn dời xuống góc dưới trái, cạnh chỗ xe dỡ hàng (không đè ô chữ gõ).
  - Nhãn màn hình nằm dưới màn hình, cạnh chân đế (không đè màn hình).
  - Nhãn agent tự né lịch và màn hình bếp.
  - Nhãn bến nằm dưới chân thanh chắn, chỉ hiện "Waiting for approval"/"Approval expired" khi xe đã đỗ ở bến (không đè chữ trên xe đang chạy).
  - Nhãn "999999?" của agent ngây thơ nằm bên phải biển LAZYDOOR.
  - Thẻ kết thúc phủ toàn khung nên không tính chồng.
- Test 28 pass; 120 khung/giây ở 1080p.

### 14. Sửa theo nhận xét của Kane về 77db1ef (chef, xe, thanh chắn, phong thư, màu, cỡ chữ)
- Chef: dựng lại trong hệ trục quay mặt về người xem (vai theo hướng nằm ngang trên màn hình), nên hai vai ngang và hai tay đối xứng; tay gõ phím là một thanh nối từ vai tới bàn phím bên hông màn hình.
- Xe tải: bỏ chữ trên rèm.
- Thanh chắn: nguyên nhân mở hai lần là điều kiện "xe ở gần thanh chắn" cũng đúng khi xe đang đỗ ở bến (chỗ đỗ nằm sát thanh chắn). Vì vậy thanh chắn mở lúc chất hàng, hạ khi xe chạy qua, mở lại khi xe quay về, rồi đứng mở tới sự kiện sau. Thay bằng `boomOpen(tr, age)` (thuần, có test): mở từ 0,5 giây trước khi xe chạy tới khi xe đã đỗ lại ở bến. Test: mở đúng một lần mỗi chuyến, xe không bao giờ chạy qua khi thanh chắn hạ, xe ngây thơ/kẹt/đỗ không làm nó mở.
- Phong thư: khe thư (viền vàng) trên cánh cổng; agent tới trước cổng thì thẻ trên tay bay thành phong thư vào khe, agent đứng chờ tay không; báo giá đi ra khỏi khe về tay agent (chờ ít nhất 1,2 giây sau khi thả thư). Agent ngây thơ: phong thư bay theo đường cong xám vòng qua cổng tới kệ.
- Màu: theo design-taste-frontend, một màu nhấn duy nhất, độ bão hoà thấp hơn 80%, không phát sáng neon: hồng đậm `--brand #d65c84` (chữ trên nền tối, tương phản 5,0:1), `--brand-strong #b8456b` (nền nút có chữ trắng, 5,1:1), `--brand-soft #eba3ba` (đường mảnh, chữ biển). Không dùng xanh lá, vàng hay đỏ vì đó là màu tín hiệu AUTO / chờ duyệt / REJECT, không dùng xanh dương vì trùng Valio Aimo.
- Cỡ chữ: giữa bản trước khi phóng to (nhãn 14 đến 19, phụ đề 2,15%) và bản 77db1ef (nhãn 23 đến 26, phụ đề 2,5%).

### 15. Kịch bản hai hồi, một agent (theo yêu cầu của Kane)
- Model: thêm `gate: { built, since }`. Live mặc định có cổng; Story dùng tín hiệu `story.gate` để bỏ cổng ở đầu và dựng cổng sau hồi 1. Các bước `story.naive` giờ điều khiển chính agent: `take` (tới chef lấy đơn), `enter` (tới ranh giới kho), `gone` (về chỗ, tay không). Test mới cho cả ba điều này và cho thứ tự kịch bản (bỏ cổng, chạy hồi 1, dựng cổng, rồi mới tới đơn qua cổng).
- Cảnh: bỏ robot xám thứ hai. Khi chưa có cổng, phong thư của agent bay theo đường cong tới kệ 0 (API thô) thay vì vào khe. Các phần của cổng nằm trong nhóm riêng, hạ xuống và hiện dần theo thứ tự, mỗi phần 0,9 giây.
- Phụ đề hồi 1 và chuyển cảnh viết lại cho khớp: "The agent orders straight from Valio's raw API. Nothing checks the order.", "The agent learns it after the fact, at the dock.", "So we built a door in front of the warehouse.", "The same agent tries again, through the door. Every decision is a published rule.". Các mốc hồi 2 lùi 1 giây.

### 16. Story 1:48,5 cho video pitch 2 phút (theo yêu cầu của Kane)
- Ban tổ chức: video pitch dài tối đa 2 phút, kiểm rất chặt. Story rút từ 124 giây còn 108,5 giây: bớt các khoảng đứng, agent đi nhanh hơn (tốc độ tối đa 130, trước 95), xe chạy nhanh hơn. Giữ đủ mọi nhịp: hồi 1 không cổng, dựng cổng, cùng agent quay lại, đơn AUTO, NEEDS_APPROVAL rồi chef duyệt, giao hàng tới bếp, REJECT và hết hạn.
- Giới hạn 500 € là luật riêng của bếp, không phải của Valio (Valio không ép duyệt; khách tự đặt giới hạn). Phụ đề đổi thành "Over the kitchen's own 500 € limit, and boxes became cartons: NEEDS_APPROVAL." và "The same agent comes back. The door carries the kitchen's own signed rules.".
- Phụ đề rút gọn để vừa thời gian: "The dock refuses the load: its cut-off was Thursday 12 Nov 15:00.", "The chef's terminal asks for approval, valid until the cut-off, Sun 17:00.", "The chef approves, 30 hours before the cut-off.".
- Các phần cổng giờ hạ xuống từ độ cao 20 (trước 40): với nhịp mới, biển LAZYDOOR đang mờ dần lướt qua logo Valio Aimo ở 0:24,75 và kiểm tra chồng chữ bắt được.
- Test mới: Story không quá 110 giây, mỗi phụ đề đủ thời gian đọc, phụ đề giới hạn của bếp và luật ký của bếp có mặt, không có "unlimited". Thanh kéo `max` 108,5.

### 17. Chữ không che nhân vật, cổng hay xe; gợi ý xoay ngang trên điện thoại
- Mỗi khung, cảnh lập danh sách vùng cấm: chef, agent, xe tải (theo vị trí đang chạy), các phần của cổng (rào, cột, khung, biển LAZYDOOR, cánh cửa đang mở), màn hình bếp, lịch, và mọi chữ đã đặt. Nhãn của agent thử lần lượt: trên đầu, dưới chân, lệch trái/phải, hai bên; chỗ nào không chạm gì thì đặt, giữ chỗ cũ nếu còn trống để không nhảy qua lại; không có chỗ nào thì ẩn (lúc xe tải đỗ trước bếp; thẻ hoá đơn góc trái đã có cùng số tiền).
- Nhãn lý do của cổng ("Cut-off passed", "Only 384 left") chuyển xuống sàn kho, bên phải tầm quét của cánh cửa, không che kệ; ẩn khi đơn đã giao cho xe. Nhãn bến ("Waiting for approval") xuống dưới một hàng khi chỗ cũ bị chiếm. Ô chữ chef gõ và nhãn màn hình bếp lùi trái vài điểm để không chạm mũ chef. Thẻ quyết định góc phải mờ đi khi xe đã nhận hàng rời bến (xe chạy ngang qua góc thẻ).
- `demo/dev/label-overlap.mjs` thêm khung của chef, agent, xe tải, rào/cột/khung/cánh cổng và biển LAZYDOOR làm vật cứng: chữ không được chạm chúng (vật cứng chạm nhau thì bỏ qua). Lần chạy đầu: 11 cặp; sau khi sửa: `label overlaps: 0` (Story mỗi 0,25 giây, Live phát hết file mẫu).
- Điện thoại dọc (≤ 640 px): dòng gợi ý "Turn your phone sideways to see the whole scene." với biểu tượng xoay (Phosphor device-rotate). Xoay ngang thì tự ẩn và sân khấu vừa chiều cao màn hình. Đã kiểm 375×812 và 812×375.

### 18. Robot hút bụi, biển theo mặt iso, thùng xe trơn (theo nhận xét hình của Kane)
- Agent giờ là robot hút bụi tròn dẹt cỡ một viên gạch lát (vòng cản đen, vỏ san hô có đường nắp, cửa cảm biến, tháp lidar nắp vàng, đèn trạng thái, chổi cạnh), thẻ đơn cắm trên cột nhỏ. Đỗ ngay dưới chân màn hình bếp; nhận lệnh thì chạy vòng qua chef ra làn, tới vạch quét của cổng; cổng quyết định xong (AUTO, NEEDS_APPROVAL hay REJECT) thì tự chạy về chỗ đỗ, không chờ xe tải. Đơn được nhận thì robot vẫn đỗ, chỉ đổi thẻ sang biên nhận. Áp cho cả Story và Live (`model.mjs`: `policy.decided`, `approval.rejected`, `order.accepted` đều đưa robot về `home`; test đã đổi theo).
- Biển Valio Aimo là tấm phẳng gắn trên mặt tường kho (trên hàng đèn, giữa cửa sổ đầu và đèn thứ hai), logo vẽ trong mặt phẳng tường. Biển LAZYDOOR là tấm trên hai cột của dầm cổng, nằm trong mặt phẳng của cổng, quay về phía bếp. Khi dựng cổng, biển sáng dần tại chỗ (không hạ xuống), nên không lướt qua logo.
- Xe tải: bỏ tấm xanh ở thành thùng; thay bằng thanh ray trên cùng màu khung vàng, thùng để trơn.
- Nhãn màn hình bếp ("Approve …?", "Approved …") giờ cũng đi qua bộ đặt chữ: mặc định nằm bên trái màn hình, không che robot đang đỗ.
- `label overlaps: 0`, 36 test pass.

### 19. Story mới theo SCRIPT.md, có giọng đọc
- `story.mjs` viết lại theo 9 cảnh của `SCRIPT.md`, mốc tính từ độ dài thật của 9 đoạn giọng (`VOICE`), tổng 108,8 s. Cue mới trong `model.mjs`: `story.card` (Z3), `story.list` (Z4), `story.agent` (robot đi/về theo kịch bản, như case AC29), `story.flash` (dấu ✕ ở khe), `story.rival` (phong thư khách sạn khác); `story.reset` không còn đưa xe về bến trừ khi ghi `truck: true`.
- `scene.mjs`: vùng chữ Z3/Z4 cố định thay cho nhãn agent, bong bóng chef, nhãn cổng/bến/màn hình/kệ (bộ đặt chữ của mục 17 không cần nữa nên đã bỏ). Live tự suy ra thẻ Z3/Z4 từ sự kiện gateway. Biên nhận Z6 dùng chữ của door. Thẻ quyết định rộng 400, lý do "Over 500 € (kitchen's own limit)", "Day total over 500 €", "Approved". Lịch chỉ ở MON 16 trong lúc xe đi giao.
- Robot phóng 1,6 lần, chạy nhanh hơn (tối đa 190 đơn vị/giây) cho montage; dock sạc liền đế màn hình với đèn.
- `main.mjs`: phát giọng theo đồng hồ Story (không phát khi `?manual=1` để quay), nút tắt/bật tiếng nhớ lựa chọn, lớp phủ xoay ngang. `index.html`: màn kết mới.
- Test Story viết lại theo kịch bản mới (độ dài, giọng nằm trong cảnh, thứ tự cảnh, số đã kiểm trên door, không còn "wheat"/"unlimited"/"Only 384 left"/"2 rejected", phụ đề đủ thời gian đọc).

### 20. Agent là robot đưa thư (Kane: "nhìn giống robot hút bụi quá")
- Thay robot hút bụi bằng robot đưa thư nhỏ: khung gầm trên bốn bánh, thân san hô có đường ghép và khe thông gió, cổ, đầu vàng có màn hình mặt tối với hai mắt sáng, ăng-ten có đèn tín hiệu; phong thư (màu theo thứ nó mang: nháp, báo giá, biên nhận, bị từ chối, câu hỏi) nằm trong túi trước ngực, thư bay vào khe cổng từ đó.
- Giữ bề ngang cũ để vừa dock; cao tới đỉnh ăng-ten khoảng 34 đơn vị, thấp hơn đáy màn hình bếp nên khi đỗ không che màn hình (bản cao hơn bị test overlap bắt). Đèn dock dời ra mép trước tấm dock, thấy được khi robot đỗ.
- Hành vi, timeline Story và giọng đọc không đổi. `label overlaps: 0`, 37 test pass.

### 21. Story v2.1: một câu chuyện liền, event thật từ door, giọng mới
- `story.mjs` viết lại theo 14.3: 11 cảnh, mốc từ độ dài 11 đoạn giọng; event gateway từ `fixtures/story-v2.json` (lần chạy thật 14.6), timeline gọi `["gw", type]` để lấy event kế tiếp tới loại đó.
- `model.mjs`: buyer đầu tiên là "của mình", buyer khác chỉ vào ticker/kệ/dấu ✕; tổng ngày (`dayTotal`); `story.hold` + pallet + `story.ship` (đơn nhận nằm pallet tới Thứ Hai); `story.clock`, `story.rules`, `story.mail`, `story.split`, `story.receipt`; draft có `crossCheck: disagreed` thì robot mang câu hỏi về; lệnh gọi Valio kiểm lại đơn (không có draftId) không kéo robot ra cổng.
- `scene.mjs`: điện thoại manager + cờ tên, phong thư điện thoại ↔ cổng, bảng luật + thanh đo, pallet và biển, thẻ quyết định rộng 470, biên nhận 5 dòng, tối đa 3 thùng bay qua máy quét mỗi báo giá, rào cổng hiện tại chỗ.
- Test Story viết lại (fixture đặt đủ và đúng thứ tự, thứ tự 14.1, tổng ngày, buyer khác, phong thư, số và chữ, phụ đề ≥ 3 s).

### 22. Ba sửa của Kane cho v2.1 (SCRIPT.md mục 16)
- Model: cue `story.nomilk` (lịch lật MON 16 kèm dấu "NO MILK", `story.reset` tắt nó) và `story.mandates` (ba thẻ luật bay vào giá trên cổng).
- Scene: giá thẻ trên mặt trước trụ cổng (thẻ Kitchen B xanh, Aurora hồng sáng lên, Kitchen C xanh lá); cột cờ "Next delivery Mon 16 Nov" sau xe tải ở bến (chỉ trong Story, sau khi cổng dựng); bảng Z6 rộng 440 cho tiêu đề mới; Z2 "Valio's rules · same for every buyer" + "Cut-off Sun 17:00 · now …".
- Story: caption 0:12,5, 0:15,7, 0:59 mới; thẻ Z3 cho hậu quả, cho giá thẻ, cho gà và sữa "ships Mon 16 Nov"; ghi chú Z4 về khách sạn kia. Giọng và `VOICE` không đổi, vẫn 110,0 s.
- Overlap thêm cờ ở bến; thẻ Z4 lúc tranh hàng gộp tiêu đề để không chạm nóc xe. 43 test pass, `label overlaps: 0`.

### 23. Cảnh 1: Thứ Hai không có sữa, rồi tua về Thứ Sáu (SCRIPT.md 16.4)
- Model: cue `story.warp {to, dur}` đặt giờ mới ngay, `shownNow(state, t)` cho giờ chạy dần (tới hoặc lùi) trong `dur`; đồng hồ tường, lịch, bầu trời và Z2 dùng giờ này.
- Cảnh 1 dài 19,6 s: Thứ Hai 07:00 (xe và pallet trống, thùng sữa trống mờ trên quầy, dấu "NO MILK"), rồi nhãn "◀◀ Rewind" và cảnh nhạt màu trong lúc tua về Fri 16:30. Cảnh 2 chạy giờ tới Fri 19:40. Trước khi có cổng Z2 ghi cả ngày ("Now Mon 16 Nov 07:00"); biển pallet chỉ hiện sau khi cổng dựng.
- Story 114,0 s; `git diff ca42bc7 -- demo/assets/voice` rỗng. Test độ dài ≤ 114 s, thêm test nhảy Thứ Hai và tua ngược; overlap thêm nhãn Rewind. 44 test pass, `label overlaps: 0`.

### 24. Màn kết: cách agent nối vào thay cho hai icon (SCRIPT.md 16.5)
- Bỏ hai icon phích cắm "OpenAPI"/"MCP". Thay bằng "Any agent connects the same way:", `lazydoor.lazydoor.workers.dev`, "HTTP API · /openapi.json", "MCP · /mcp (9 tools)" (theo README trên `main`).
- Chữ màn kết dùng `clamp` có cỡ tối thiểu. Đã chụp kiểm ở 1920×1080, điện thoại dọc 375×812 (sau "Watch anyway") và ngang 812×375: không tràn, không chồng chữ.

### 25. Live làm lại cho v2.1: người xem chỉ xem, door thật, không key
- Trang bỏ ô Gateway URL, API key, Buyer, Connect, "Play recorded file", ô "Request to the gateway" và câu "The page acts as a minimal buyer agent…". Live chỉ xem; agent là chương trình riêng gọi door. Dưới sân khấu có một dòng giải thích (ẩn trong kiosk).
- Gateway là `?gateway=` nếu có (xem door thật từ máy: `?mode=live&gateway=https://lazydoor.lazydoor.workers.dev`), không thì `location.origin` (khi trang nằm ở `/demo` trên door). Không gửi key. `live.mjs`: `readBacklog` đọc hết log một lần, cảnh bắt đầu sau event mới nhất (chỉ giữ giờ của door, không chạy lại hoạt hình cũ), rồi `connectLive` theo SSE, rớt về polling, thử lại khi door không trả lời. Chip: "Connecting to the door…", "Watching the door live · connected", "… · checking every few seconds", "The door is not answering · retrying".
- Cảnh theo `hotel-a` (= Hotel Aurora, `?buyer=` để đổi); buyer khác thành "another hotel": phong thư bay vào từ mép trái, dấu ✕, kệ "2 left", dòng ticker "another hotel · …", caption riêng. Event tới cùng lúc được xếp hàng, mỗi 0,45 s một event; caption bằng chữ thường (`plain` trong `model.mjs`), mỗi caption ít nhất 2,5 s và đủ đọc ở 17 ký tự/giây, dồn thì chỉ giữ hai câu mới nhất. Ticker ghi giờ dạng "Fri 13 Nov 21:10" thay chuỗi ISO (cả Story).
- Hình v2.1 trong Live: giá thẻ luật đủ ba thẻ, bảng luật của Aurora và thanh đo tổng ngày (suy từ quyết định của door), điện thoại manager, phong thư Lazydoor/approved (giờ suy từ `approval.requested`/`approved`, Story bỏ cue riêng), pallet và cờ "Next delivery Mon 16 Nov"; đơn được nhận nằm pallet, xe chỉ chạy khi giờ của door tới ngày giao (`clock.set` ≥ Mon 16 06:00). Thẻ Z3 Live theo chữ Story: yêu cầu có kiểu (kèm câu gốc), báo giá, "ACCEPTED · on the pallet · ships on delivery day", câu hỏi của door.
- `dev/fake-gateway.mjs`: đọc log không cần key, trả mọi buyer; `--replay [file] [--pace n]` phát lại một lần chạy (mặc định `fixtures/story-v2.json`, hoặc `~/junction-2026/.data/story-v2.1-run.json`), bắt đầu khi có người xem đọc log; bỏ `--story`. Xoá `fixtures/sample-events.json`, `replayFile`, `sendRequest`.
- Kiểm tra: 46 test pass (thêm test backlog không key, gateway `--replay` mọi buyer, caption chữ thường, buyer khác không kéo robot, pallet chờ ngày giao); `label-overlap.mjs` (Story + 95 s Live trên gateway giả phát lần chạy thật) báo `label overlaps: 0`. Door thật đã mở log không key: Live kết nối SSE, lấy giờ door (Fri 13 Nov 21:10) và đứng chờ agent, không lỗi console.

### 26. Cảnh 1 nói ra hậu quả, có tiếng tua băng (SCRIPT.md 16.6)
- Lời mới `assets/voice/12.mp3` "So on Monday morning, there is no milk." (Gemini TTS Charon, Gemini chép lại đúng từng chữ), phát 0:15,2–0:18,12 ngay sau đoạn 1 (hết 0:14,91). Tiếng tua `assets/sfx/rewind.mp3` (ffmpeg tự tạo, thấp hơn giọng khoảng 14,5 dB) phát 0:18,4–0:20,1 cùng nhãn Rewind. Cảnh 2 từ 0:20,4; Story 114,8 s.
- `VOICE` giờ ghi rõ giờ phát và file của từng đoạn (12 đoạn); `SFX` là tiếng tua; `main.mjs` phát cả hai trên một kênh (`CLIPS`), nên tắt tiếng, tạm dừng, tua đều áp dụng. Caption "Nobody checked. Nobody approved." và "So on Monday morning, there is no milk.".
- Mười một đoạn giọng cũ không đổi (`git diff ca42bc7 -- 'demo/assets/voice/0*.mp3' 'demo/assets/voice/1[01].mp3'` rỗng). 47 test pass (thêm test lời mới và tiếng tua nằm trong cảnh 1, không chồng lời khác); `label overlaps: 0`. Trình duyệt tải 12.mp3 ở 0:15,2, rewind.mp3 ở 0:18,4, 02.mp3 ở 0:20,7.

## Còn lại / cần làm sau
- Quay `demo/story.mp4` khi Kane duyệt Story mới (ghép giọng từ `VOICE`).
- Live: khi biết `buyerId` agent tham chiếu dùng (mặc định `hotel-a`, đổi bằng `?buyer=`), kiểm lại trên door thật lúc agent chạy. Bảng luật của bếp trong Live ghi 500 € một đơn / 1.500 € một ngày (mandate của chuỗi v2.1); nếu door chạy mandate khác thì chữ này sai.
- Gắn `demo/` vào Worker tại `/demo` (mục 5).
