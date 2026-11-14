# Lazydoor Story: kịch bản mới (chờ Kane duyệt, chưa ai code)

Thứ Bảy 14/11/2026. Thay cho Story 1:48,5 hiện tại trong `story.mjs`. Lời đọc và caption bằng tiếng Anh; ghi chú bằng tiếng Việt.
Mọi con số lấy từ bản ghi Valio (Thứ Sáu 13/11, 21:08), oracle nghiệm thu, 49 case và 11 scenario trên `main`. Chỗ nào chưa kiểm trên door thật được ghi ở mục 9.

## 1. Ý chính

Một yêu cầu, chạy hai lần:

> "1,000 litres of lactose-free milk by Monday. Bulk boxes if you can."

- **Lần 1, không có door:** agent đọc reply thô của Valio cho hộp 10 l (`463038`), thấy `999999` và `Mon 16 Nov`, đặt 50 thùng (1.565,50 €). Cùng reply đó có `closingTime` là Thứ Năm 12/11 15:00. Thứ Hai không có sữa, và không ai duyệt khoản chi.
- **Lần 2, qua Lazydoor:** cùng agent, cùng câu. Door từ chối hộp 10 l (`CUTOFF_PASSED`), báo giá hộp 1 l `464306` với 1.010,00 € giá cố định, giữ đơn vì vượt hạn mức 500 € của chính bếp, gửi link cho người duyệt, rồi ACCEPTED và giao Thứ Hai.
- **Sau đó:** 8 case ngắn, mỗi case một con dấu, phủ hết phần còn lại của đề bài.

## 2. Độ dài: đề xuất để Kane quyết

| Cách | Nội dung | Đánh giá |
|---|---|---|
| **A (đề xuất)** | Một Story **1:50** (110 s), 9 cảnh, phủ mọi mục của đề bài (bảng ở mục 6). Video pitch chính là Story này cộng lời đọc. | Một timeline, một lần thu giọng, không phải cắt. Trần 2:00 còn dư 10 s. |
| B | Story trên web ~2:35 chia chương, kèm bản cắt ≤ 2:00 cho video | Hai timeline phải giữ khớp nhau; bản cắt vẫn phải phủ hết, nên vẫn cần làm xong A trước |
| A+ (tuỳ chọn) | A, cộng chương "More" ~45 s chỉ có trên web, sau màn kết (mục 7) | Chỉ làm nếu A đã xong và đã quay |

Lời đọc: 228 từ, đọc khoảng 91 s ở 150 từ/phút, còn 19 s cho khoảng nghỉ.

## 3. Luật hình ảnh (sửa lỗi 0:39: chữ che robot và cổng)

Khung 1920×1080. Chữ chỉ nằm trong các vùng dưới đây; nhân vật và cổng là vùng cấm.

| Vùng | Vị trí | Chứa gì |
|---|---|---|
| Z1 | góc trên trái (đã có) | dòng sự kiện của door |
| Z2 | góc trên phải (đã có) | đồng hồ cut-off |
| Z3 | trời bên trái, dưới Z1, trên tường bếp (x 40–520, y 230–390) | một thẻ tại một thời điểm: câu chef gõ → yêu cầu có kiểu → phiếu báo giá → thẻ case |
| Z4 | cột phải, dưới Z2, trên Z5 (x 1490–1890, y 215–600) | danh sách bị từ chối, tối đa 3 dòng và một dòng "+N more"; đường chỉ mảnh nối tới kệ |
| Z5 | góc dưới phải (đã có) | con dấu quyết định và lý do |
| Z6 | góc dưới trái (đã có) | thẻ "Approved", biên nhận |
| Z7 | dải dưới cùng (đã có) | caption, tối đa 2 dòng |

- **Vùng cấm:** chef và màn hình bếp; robot ở cả ba chỗ đứng; cổng LAZYDOOR; xe tải ở bến và ở bếp. Không bong bóng, không nhãn nào đè lên.
- **0:39 cũ:** bong bóng "Quote: 1,010.00 € / 2 rejected" chuyển thành phiếu báo giá ở Z3, nối với robot bằng một đường mảnh. Nhãn "Cut-off passed / Only 384 left" chuyển thành các dòng ở Z4. Kệ chỉ giữ icon ✓ ✕ ⚠ trên bảng tên.
- **Gốc lỗi:** `dev/label-overlap.mjs` chỉ so chữ với chữ. Thêm khung bao của chef, robot, cổng và xe tải vào danh sách được bảo vệ, rồi chạy lại trên cả Story.
- **Không phải chatbot:** door không có bong bóng thoại. Nó chỉ "nói" bằng con dấu, phiếu và mã lý do. Chỉ chef có ô chữ gõ.
- **Cảnh 6–8 (montage):** robot đứng yên ở vạch quét. Mỗi case là phong thư vào khe, con dấu ra. Z3 hiện thẻ case kèm mã bằng chứng (ví dụ "AC30"); Z2 hiện giờ của riêng case đó.

## 4. Kịch bản từng cảnh

Caption nằm ở Z7. Mỗi caption hiện ít nhất 2 s và không nhanh hơn 17 ký tự/giây (luật test đang có).

### Cảnh 1 · 0:00–0:07 · Yêu cầu

**VO:** "Saturday morning. A hotel kitchen needs a thousand litres of lactose-free milk by Monday."

| Mốc | Hình | Caption |
|---|---|---|
| 0:00 | Lịch SAT 14. Z2: "Now Sat 10:15". Chưa có cổng. Chef gõ trên màn hình bếp; câu yêu cầu hiện dần trong Z3. | Saturday 10:15. Hotel Aurora's kitchen orders milk for Monday. |

### Cảnh 2 · 0:07–0:23 · Không có Lazydoor

**VO:** "Its AI agent asks Valio's API directly. The ten-litre box looks available for Monday, so it orders fifty cases. But ordering for Monday closed on Thursday. Nobody checked, nobody approved. Monday: no milk."

| Mốc | Hình | Caption |
|---|---|---|
| 0:07 | Robot lấy thẻ đơn từ chef, đi tới mép kho. | No door: the agent calls Valio's API itself. |
| 0:10 | Phong thư bay theo đường cong xám tới kệ hộp 10 l. Z4 hiện reply thô, chữ đơn cách, 3 dòng: `availableAmount 999999`, `availableDate Mon 16 Nov`, `closingTime Thu 12 Nov 15:00` (dòng thứ ba mờ). | Raw reply for the 10 l box: 999999, Monday 16 Nov. |
| 0:13 | Z3: phiếu của agent "50 cases × 31.31 € = 1,565.50 €". Thùng trượt về phía bến. | It orders 50 cases: 1,565.50 €. No one is asked. |
| 0:16 | Thanh chắn bến không mở, đèn đỏ. Dòng `closingTime` ở Z4 sáng lên. | The same reply also said: closed Thu 12 Nov 15:00. |
| 0:19 | Lịch lật sang MON 16. Xe trống, quầy bếp trống, chef nhún vai. Robot về chỗ, tay không. | Monday 16 Nov: no milk in the kitchen. |

### Cảnh 3 · 0:23–0:28 · Dựng cổng

**VO:** "So we built a door in front of the warehouse: Lazydoor."

| Mốc | Hình | Caption |
|---|---|---|
| 0:23 | Tua ngược nhanh: lịch về SAT 14. Các phần cổng hạ xuống, biển LAZYDOOR sáng. | Rewind to Saturday. This time there is a door. |

### Cảnh 4 · 0:28–0:46 · Cùng yêu cầu: đọc, tra, báo giá

**VO:** "Same agent, same sentence. The door turns it into a typed request, finds thirty-five lactose-free milks, and asks Valio only about those. The boxes are refused: cut-off passed. Best offer: one-litre cartons, one thousand and ten euros, price fixed."

| Mốc | Hình | Caption |
|---|---|---|
| 0:28 | Robot lấy đúng thẻ đó, tới vạch quét, thả phong thư vào khe. | Same agent, same sentence, through Lazydoor. |
| 0:31 | Thẻ ở Z3 đổi thành yêu cầu có kiểu: `milk · lactose-free · 1,000 l · by Mon 16 Nov · prefers 10 l`, kèm chip "Gemini ✓ Gemma ✓". | Words become a typed request, read by two models. |
| 0:34 | Máy quét của cổng chạy. Z1: `search.done: 35 candidates`, `valio.called: availability`, `valio.called: price`. | 35 lactose-free milks found. Valio is asked about only these. |
| 0:38 | Ứng viên bay từ kệ tới máy quét; hàng bị loại bật lại, ✕ trên bảng tên kệ. Z4: "✕ 463038 Valio 10 l box · CUTOFF_PASSED", "✕ 464179 Arla 10 l box · CUTOFF_PASSED", "+18 more closed for Monday"; bên dưới là câu của mã lý do: "The order cut-off for this product has passed for the requested delivery." | 20 are past their cut-off. Each refusal has a reason code. |
| 0:42 | Phiếu báo giá ra khỏi khe về tay robot. Z3: "464306 Valio Eila 1 l · 1,000 × 1.01 € = 1,010.00 € · fixed for 30 min · reliability 1.0 · CO₂e 1.1 kg/kg (group average) · stock unknown at Valio". | Best offer: 1 l cartons, 1,010.00 €. Fixed price, facts attached. |

### Cảnh 5 · 0:46–1:03 · Duyệt, nhận đơn, giao hàng

**VO:** "That is over the kitchen's own five-hundred-euro limit, so the order waits. The approval link goes to the kitchen manager, never to the agent. The manager approves. Accepted. On Monday, the milk arrives."

| Mốc | Hình | Caption |
|---|---|---|
| 0:46 | Z5: dấu NEEDS APPROVAL, hai chip "Over 500 € (kitchen's own limit)" và "Pack size changed". Thẻ trên tay robot: "HELD · waiting for Kitchen manager", không có link. | Over the kitchen's own 500 € limit: a human must approve. |
| 0:50 | Màn hình bếp sáng, tiêu đề "Approver inbox · Kitchen manager". Trên màn hình: "10 l boxes → 1 l cartons", "1,010.00 € net · 1,146.35 € with VAT", đếm ngược tới cut-off. | The link goes to the manager, never to the agent. |
| 0:53 | Chef chạm duyệt, màn hình ✓. Z5 thêm chip "Approved". Cánh cổng mở, thùng lên xe. | Approved, 30 hours before the cut-off. Accepted. |
| 0:56 | Xe chạy, lịch lật sang MON 16, dỡ thùng ở bếp, chef giơ ngón cái. Z6: biên nhận "1,000 × 1 l · 1,010.00 € · VAT 136.35 € · total 1,146.35 € · approved by Kitchen manager · accepted (simulated)". | Monday 16 Nov: 1,000 litres delivered. Receipt in plain words. |

### Cảnh 6 · 1:03–1:17 · Guardrail (3 case)

**VO:** "Small orders pass alone: twenty litres, no human needed. Split the big order in three? The door counts the day, so part two waits. The agent approves itself? Refused."

| Mốc | Thẻ case (Z3) | Hình | Caption |
|---|---|---|---|
| 1:03 | Inside the limit · AC13 | Phong thư vào khe, dấu xanh AUTO, một thùng lên xe. | 20 l, 20.20 €: inside the limit. The agent orders alone. |
| 1:07 | Split to dodge approval · AC30 | Ba phong thư ghi 334, 333, 333. Thư đầu: AUTO, "337.34 €". Thư hai: dấu vàng, chip "Day total over 500 €". Thư ba đứng chờ. | 1,000 l split in three: part two waits. The day is counted. |
| 1:12 | Agent approves itself · AC29 | Robot thả một phong thư ghi "approve". Khe nháy đỏ "403". Chip đơn vẫn là HELD. | The agent tries to approve its own order: 403. |

### Cảnh 7 · 1:17–1:33 · Ngoại lệ (3 case)

**VO:** "Valio's listed substitute for a gluten-free oat drink contains wheat: refused. Two agents want the last six units: one gets them, the other is told two are left. And a late approval simply expires."

| Mốc | Thẻ case (Z3) | Hình | Caption |
|---|---|---|---|
| 1:17 | Unsafe substitute · AC17 | Kệ "Oddlygood oat drink, gluten-free" xám, ghi "out of stock (simulated)". Thùng "Oatly Oat Drink Semi" bay tới máy quét rồi bật lại. Z4: "✕ 470863 · NEW_ALLERGEN · wheat". | Valio's substitute for a gluten-free oat drink has wheat: refused. |
| 1:22 | Two agents, six units · AC31 | Hai phong thư tới khe cùng lúc: một từ robot, một bay vào từ mép trái, ghi "another hotel". Bảng tên kệ: "6 left". Một dấu xanh "ACCEPTED 190.92 €", một dấu đỏ "STOCK_TAKEN · 2 left". Z1: `stock.denied: 470746 · 2 left`. | Two agents, six units: one order wins, the other learns 2 are left. |
| 1:28 | Late approval · AC20 | Z2 chạy tới "Sun 17:05" rồi đổi đỏ. Màn hình bếp: "Approval expired". Thanh chắn bến đóng. | Sunday 17:05, past the cut-off: the approval expires. Nothing ships. |

### Cảnh 8 · 1:33–1:43 · Nhu cầu thật (2 case)

**VO:** "A basket has one total and one approval. And when Gemini and Gemma read 'Friday' differently, the door asks which Friday."

| Mốc | Thẻ case (Z3) | Hình | Caption |
|---|---|---|---|
| 1:33 | Basket · AC36 | Ba thùng ba màu (sữa 300 l, bơ 20 kg, ức gà 30 kg) qua máy quét cùng nhau. Phiếu: "303.00 + 132.00 + 231.00 = 666.00 €". Một dấu vàng, chef chạm một lần, một chuyến xe. | Milk, butter, chicken: one basket, 666.00 €, one approval. |
| 1:38 | Which Friday? · sent Fri 13 Nov | Lịch FRI 13. Chef gõ "40 kg chicken breast fillet for Friday, Atria only". Hai chip: "Gemini: Fri 13 Nov", "Gemma: Fri 20 Nov". Robot quay về chef với thẻ "?" ghi "deliverBy". | Gemini and Gemma read "Friday" differently: the door asks, never guesses. |

### Cảnh 9 · 1:43–1:50 · Kết

**VO:** "One door, open to any agent. Lazy at the order, strict at the border."

| Mốc | Hình | Caption |
|---|---|---|
| 1:43 | Màn kết đang có: Lazydoor for Valio Aimo, hai phích OpenAPI và MCP, dòng "Lazy at the order, strict at the border." Dòng phụ đổi thành: "49 acceptance cases pass on the deployed door. Every decision is a published rule: /v1/rules." Dòng nhỏ dưới cùng: "Valio adds: an order endpoint and its allocation rule." | (không có) |

## 5. Lời đọc đầy đủ (dán vào `pitch/pitch.json` → `video[].say`)

| # | Thời lượng | Từ | Lời |
|---|---|---|---|
| 1 | 7 s | 14 | Saturday morning. A hotel kitchen needs a thousand litres of lactose-free milk by Monday. |
| 2 | 16 s | 33 | Its AI agent asks Valio's API directly. The ten-litre box looks available for Monday, so it orders fifty cases. But ordering for Monday closed on Thursday. Nobody checked, nobody approved. Monday: no milk. |
| 3 | 5 s | 11 | So we built a door in front of the warehouse: Lazydoor. |
| 4 | 18 s | 39 | Same agent, same sentence. The door turns it into a typed request, finds thirty-five lactose-free milks, and asks Valio only about those. The boxes are refused: cut-off passed. Best offer: one-litre cartons, one thousand and ten euros, price fixed. |
| 5 | 17 s | 33 | That is over the kitchen's own five-hundred-euro limit, so the order waits. The approval link goes to the kitchen manager, never to the agent. The manager approves. Accepted. On Monday, the milk arrives. |
| 6 | 14 s | 29 | Small orders pass alone: twenty litres, no human needed. Split the big order in three? The door counts the day, so part two waits. The agent approves itself? Refused. |
| 7 | 16 s | 34 | Valio's listed substitute for a gluten-free oat drink contains wheat: refused. Two agents want the last six units: one gets them, the other is told two are left. And a late approval simply expires. |
| 8 | 10 s | 21 | A basket has one total and one approval. And when Gemini and Gemma read 'Friday' differently, the door asks which Friday. |
| 9 | 7 s | 14 | One door, open to any agent. Lazy at the order, strict at the border. |
| | **110 s** | **228** | |

Thu giọng trước, đo từng đoạn, rồi mới chỉnh mốc trong `BEATS` theo độ dài thật (mỗi cảnh = đoạn giọng + khoảng 0,6 s).

## 6. Bảng phủ

| Đề bài / rubric | Cảnh | Mốc | Bằng chứng |
|---|---|---|---|
| Request: agent nói điều người mua cần | 1, 4 | 0:00, 0:28 | AC01 |
| Lookup có cấu trúc: sản phẩm | 4 | 0:34 | AC02 (35 sản phẩm, 0 lời gọi Valio) |
| Lookup: giá | 4 | 0:42 | AC01, AC04 (1,01 €/l; 1.010,00 €) |
| Lookup: tồn kho và cut-off | 2, 4 | 0:10, 0:38 | bản ghi `463038`; AC03 (20 `CUTOFF_PASSED`), AC05 |
| Order ở giá cố định | 4, 5 | 0:42, 0:53 | AC04 (báo giá hết hạn sau 30 phút), AC01 (biên nhận) |
| Quyền hạn và người duyệt | 5 | 0:46–0:53 | AC05 (`OVER_ORDER_AUTO`, `PACK_SIZE_CHANGED`), AC01 (người duyệt "Kitchen manager"), scenario 1–2 |
| Agent tự quyết trong quyền của nó | 6 | 1:03 | AC13 |
| Bonus: độ tin cậy giao hàng, bền vững | 4 | 0:42 | AC27 (17/35 có số liệu; CO₂ là trung bình nhóm) |
| Bonus: hàng thay thế | 7 | 1:17 | AC17, scenario 9 |
| Bonus: ngoại lệ | 2, 4, 7, 8 | 0:16, 0:38, 1:22, 1:28, 1:38 | AC05, AC31 + scenario 7, AC20 + scenario 10, kiểm Gemma trên URL thật (STATUS C3) |
| Bonus: giải thích cho người đọc | 4, 5 | 0:38, 0:56 | `docs/reason-codes.md`; AC01 (biên nhận) |
| "It is not a chatbot" | 4 | 0:31 | yêu cầu có kiểu; door không có bong bóng thoại (mục 3) |
| "Query the APIs only when needed" | 4 | 0:34 | AC02, AC03 (tối đa 2 lời gọi cho 35 sản phẩm) |
| Valio: `closingTime` là cut-off | 2, 4 | 0:16, 0:38 | trả lời của Tommi; AC05 |
| Valio: ≥ 999999 là "không biết tồn kho" | 2, 4 | 0:10, 0:42 | trả lời của Tommi; `stockNote` (STATUS B12) |
| Valio: không có order API, chỉ tạo đơn cho người duyệt | 5 | 0:50–0:56 | biên nhận ghi "accepted (simulated)" |
| Valio: hạn mức và người duyệt là luật của khách | 5 | 0:46 | README "Who decides what" |
| Valio: 429 thì chờ 30 s | chỉ có ở chương "More" | — | STATUS B12, mã `VALIO_RATE_LIMITED` |
| Rubric: e2e demo (30) | 4, 5 | 0:28–1:03 | AC01, scenario 1 |
| Rubric: user need (20) | 1–5, 8 | — | AC05, AC36 |
| Rubric: guardrails (20) | 5, 6, 7 | 0:46, 1:03–1:17, 1:28 | AC13, AC30, AC29, AC20 |
| Rubric: exceptions (15) | 4, 7, 8 | 0:38, 1:17–1:33, 1:38 | AC05, AC17, AC31 |
| Rubric: openness, path to production (15) | 9 | 1:43 | AC26 (OpenAPI, MCP 9 tool), AC47 (`/v1/rules`), README "What Valio must add" |

## 7. Chương "More" (tuỳ chọn, chỉ trên web, không vào video)

Mỗi thẻ khoảng 7 s, cùng kiểu montage như cảnh 6–8.

| Thẻ | Caption | VO | Bằng chứng |
|---|---|---|---|
| Hard limit | 5,000 l is 5,050.00 €: over the hard limit. No approval can pass it. | Above the hard limit, even a human cannot approve. | AC16 |
| Valio says slow down | Valio answers 429: the door waits 30 s and quotes nothing stale. | When Valio says slow down, the door waits and tells the agent when to retry. | STATUS B12 |
| Barcode | GTIN 6408430000487 is exactly one product: 464306, sold per piece. | A barcode resolves to exactly one product. | AC41 |
| Vague request | "Buy for a party" gets a form to fill in, not a guess. | A vague request gets a form, not a guess. | AC44, AC45 |
| Price moved | The price changed while the order waited: the approval is not applied. | If the price moves while an order waits, nothing is approved silently. | AC35 |
| Arla only | Arla only: 435 of 1,000 l exist. The shortfall needs a human. | Not enough stock? The door says how much, and a human decides. | AC06, scenario 3 |

## 8. Giọng đọc và mobile

- **Engine: Gemini TTS**, qua `voice.js` của skill hackathon-pitch (giọng mặc định `Charon`, đổi bằng `GEMINI_VOICE`). Lý do: dùng được key AI Studio đang có; cùng họ với Gemini và Gemma đang đọc yêu cầu, nên làm mạnh bài nộp "Best Use of Gemini"; script tự in lại câu nó nghe được (`heard:`) để bắt chỗ đọc sai.
- **Không dùng OpenAI TTS:** Codex là agent viết code, không phải TTS, và STATUS ghi dự án không dùng Codex, nên không tính cho "Best Use of Codex".
- **Dự phòng:** `say` của macOS nếu Gemini TTS hết quota; hoặc Kane tự thu bằng `record-voice.sh`.
- **Cách viết cho TTS:** số tiền viết bằng chữ, không viết tắt "l" hay "€" trong lời đọc. Nghe lại ba chữ dễ sai: "Valio", "Gemma", "cut-off".
- **Mobile:** khi điện thoại đứng dọc, hiện nút "Rotate for the full scene" phủ lên sân khấu và tạm dừng Story cho tới khi xoay ngang hoặc người xem bấm "Watch anyway" (session demo đang làm).

## 9. Cần kiểm trên door thật trước khi quay

1. Gửi đúng câu của chef (có "Bulk boxes if you can.") qua `/v1/interpret`: draft có `packLitres 10` và `crossCheck: agreed` không. STATUS C3 mới kiểm câu không có vế "bulk boxes". Nếu hai model đọc khác nhau, bỏ chip "Gemini ✓ Gemma ✓" ở 0:31 hoặc đổi câu.
2. Lấy danh sách từ chối và số offer ở 0:38 từ reply thật của báo giá đó. Kịch bản chỉ khẳng định điều AC03 và AC05 đã kiểm: 35 ứng viên, 20 `CUTOFF_PASSED`, có `463038` và `464179`. Bản Story cũ ghi "2 rejected" và "Only 384 left"; hai chữ này không khớp con số 20.
3. Dòng "stock unknown" và "CO₂e 1.1 kg/kg" ở 0:42: lấy đúng chữ door trả về (`stockNote`, `carbonLabel`).
4. Case 1:17: `468465` còn hàng trong bản ghi; scenario 9 đặt nó hết hàng bằng `replayVariant`. Vì vậy kệ ghi "(simulated)".
5. Case 1:38 đo vào Thứ Sáu 13/11. Gửi vào ngày khác thì hai model có thể đọc giống nhau; thẻ case ghi rõ "sent Fri 13 Nov".

Agent ở cảnh 2 là giả định (không có team nào bị nêu tên); mọi số trong cảnh đó là từ reply thật: 31,31 € một thùng 2 × 10 l, `999999`, `closingTime` 12/11 15:00.

## 10. Câu cần Kane quyết

1. **Độ dài:** A (một Story 1:50) như đề xuất, hay B?
2. **Chương "More":** làm hay bỏ? Nếu bỏ thì 429 chỉ còn trong README.
3. **Người duyệt trên hình:** giữ chef, màn hình ghi "Approver inbox · Kitchen manager" (không cần hình mới), hay vẽ thêm một người quản lý riêng?
4. **Cảnh 2:** có nêu số tiền 1.565,50 € không? Nó là 50 × 31,31 € từ bản ghi, nhưng là đơn của một agent giả định.
5. **Cảnh "Which Friday?":** giữ (điểm cho Gemini) hay đổi lấy case hard limit 5.050,00 € (thêm một guardrail)?
6. **Giọng:** Gemini TTS giọng `Charon`, giọng khác, hay Kane tự thu?

## 11. Kane đã duyệt (Thứ Bảy 14/11, ~15:40)

Kane: "Duyệt như đề xuất".
1. Độ dài: **A**, một Story 1:50, dùng luôn làm video pitch.
2. Chương "More": **bỏ**. 429 chỉ còn trong README.
3. Người duyệt: **giữ chef**; màn hình ghi "Approver inbox · Kitchen manager".
4. Cảnh 2: **giữ** 1.565,50 €.
5. "Which Friday?": **giữ**.
6. Giọng: **Gemini TTS, giọng `Charon`**.

Thêm theo nhận xét hình của Kane: agent là **robot hút bụi nhỏ** đỗ dưới chân màn hình bếp. Nó chạy tới cổng rồi tự về, không chờ xe tải. Hai biển LAZYDOOR và Valio Aimo nằm theo mặt phẳng isometric của cảnh. Thùng xe tải để trơn, không có tấm xanh.

## 12. Kết quả kiểm trên door

Kiểm Thứ Bảy 14/11 trên https://lazydoor.lazydoor.workers.dev (bản `b134f073`, Aiven PostgreSQL), mỗi lần chạy reset về clock
`2026-11-13T21:10:00+02:00`, replay `replies_2026-11-16`, mandate mặc định (tự duyệt 500 €). Door chỉ có buyer `hotel-a`/`hotel-b`;
"Hotel Aurora" chạy bằng `hotel-a`. Kiểm xong đã reset về đúng trạng thái demo đó (`/health`: `replay: true`, `store: aiven-postgres`).
Tóm tắt: **2 điểm khớp (2, 5), 3 điểm lệch (1, 3, 4)**.

**1. Câu của chef → `/v1/interpret`: lệch một nửa.**
- Câu gửi: "1,000 litres of lactose-free milk by Monday. Bulk boxes if you can." (gửi hai lần).
- `crossCheck`: `{ model: "gemma-4-31b-it", result: "agreed" }` cả hai lần → chip "Gemini ✓ Gemma ✓" ở 0:31 **khớp**.
- `packLitres`: **không có**. Gemini để vế "bulk boxes" vào `unclear` dưới dạng chữ tự do (lần 1: `"packaging format (bulk boxes)"`,
  lần 2: `"bulk boxes"`). Draft: `10400 · drinking milk · FREE_FROM_LACTOSE · 1000 l · deliverBy 2026-11-16`.
- Hệ quả: "prefers 10 l" ở 0:31 và chip "Pack size changed" ở 0:46 chỉ đúng khi bên confirm điền `packLitres: 10`. Đã thử
  (fill `packLitres: 10` + khoá unclear): draft confirmed `packLitres 10`, offer 0 có `changes: ["PACK_SIZE_CHANGED"]`, đặt hàng ra HELD
  với `OVER_ORDER_AUTO, OVER_DAY_AUTO, PACK_SIZE_CHANGED`. Không điền thì không có `PACK_SIZE_CHANGED`.
- Lưu ý cho agent tham chiếu: `agent/plan.ts` `fillUnclear` chỉ điền khi `unclear` chứa đúng chữ `packLitres`, nên agent thật sẽ không
  tự confirm được draft này (unclear là chữ tự do).

**2. Báo giá của draft đó: khớp.**
- `search.done`: `count 35`; `valio.called` availability và price, mỗi cái 35 id, `replay: true`.
- 7 offer, 28 từ chối: `CUTOFF_PASSED` 20, `SUBTYPE_MISMATCH` 5 (463203, 463380, 464237, 476957, 477050), `STOCK_LIMITED` 2
  (462775 "51 available, 1000 needed"; 469363), `NOT_ORDERABLE` 1 (464440).
- Thứ tự trong reply: 462626 `CUTOFF_PASSED`, 462775 `STOCK_LIMITED`, 462921 `CUTOFF_PASSED`, 463038 `CUTOFF_PASSED`. Reply chỉ có
  `productId`, `code`, `detail` (không có tên). 463038 detail: "cut-off was 2026-11-12T15:00:00+02:00". 464179 `CUTOFF_PASSED` (AC05 PASS).
  Tên trong danh mục: 463038 "Valio Eila® semi skimmed milk drink 10 l novobox lactose free" (thùng 2 × 10 l); 464179 "Arla 10 L
  Novobox Suomi semi skimmed lactose free milk drink ESL". "+18 more" khớp (20 − 2).
- Câu của mã: "The order cut-off for this product has passed for the requested delivery." (`/v1/reason-codes`) khớp.
- Offer 0: `o1`, 464306 "Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free", 1,000 × 1 l × 1.01 € =
  **1,010.00 €** net, 1,146.35 € gross, reliability `1` (`pass`), quote hết hạn 21:40 (giá cố định 30 phút), closingTime Sun 15/11 17:00,
  `rankedBy: netTotal, unitPrice, reliability`.

**3. `stockNote` và `carbonLabel` trên 464306: lệch chữ.**
- `stockNote` (trên dòng 464306): **"Stock unknown: Valio does not stock this product"**. Kịch bản 0:42 ghi "stock unknown at Valio".
- `carbonLabel` nằm trên **offer**, không nằm trên dòng: `carbonLabel: "product-group average"`, `carbonKg: 1100` (cả 1,000 l), `estimate:
  false`. Door không có chữ "1.1 kg/kg"; 1.1 là 1,100 kg chia 1,000 l. Gợi ý: "CO₂e 1,100 kg (product-group average)".

**4. Số cảnh 6–8: khớp, trừ chữ "wheat" ở AC17.**
- AC13: offer 0 464306, 2,020 cent = **20.20 €**, ACCEPTED, AUTO. Khớp.
- AC30: 334 l → **337.34 €** ACCEPTED; 333 l → 336.33 € HELD `OVER_DAY_AUTO`; 333 l thứ ba → 336.33 € HELD `OVER_DAY_AUTO`. Khớp.
- AC17: 468465 "Oddlygood® oat drink 1l UHT gluten free" → `NOT_ORDERABLE` "no stock lines" (biến thể `out_of_stock`, tức "simulated").
  470863 "Oatly Oat Drink Semi 1L" → `NEW_ALLERGEN`, detail **"adds allergen AW"**; 0 offer. **Lệch:** AW là mã GS1 "cereals containing
  gluten" (wheat riêng là UW). Danh mục: 470863 chứa `AW, GO`, không có claim `FREE_FROM_GLUTEN`; 468465 chứa `GO`, có `FREE_FROM_GLUTEN`.
  Gợi ý đổi "wheat" thành "gluten" ở VO, caption 1:17 và Z4 ("✕ 470863 · NEW_ALLERGEN · gluten (AW)").
- AC31: 470746 "Top Choice poultry Chicken breast fillet … 5kg", 4 × 5 kg × 47.73 € = **190.92 €** ACCEPTED; buyer kia REJECTED `STOCK_TAKEN`,
  `available: 2`, `retryable: false`; event `stock.denied {productId: 470746, remaining: 2}`. "6 left" khớp (6 − 4 = 2). Khớp.
- AC20: HELD, hạn duyệt `approvalExpiresAt` = **Sun 15/11 17:00**; đặt clock Sun 17:05 rồi duyệt → `EXPIRED`, `APPROVAL_EXPIRED`. Khớp
  (17:05 đã qua cut-off 17:00).
- AC36: 464306 30,300 + 464411 13,200 + 472673 23,100 cent = **666.00 €** (gross 755.91 €), một đơn HELD (`OVER_ORDER_AUTO`, `OVER_DAY_AUTO`).
  Khớp.
- "Which Friday?" (gửi lúc door ở Fri 13/11 21:10): "We need 40 kg of chicken breast fillet for Friday, Atria only." → `needs_input`,
  `missing: ["deliverBy"]`, Gemini `2026-11-13`, Gemma `2026-11-20`, `crossCheck: disagreed`. Khớp.

**5. Biên nhận cảnh 5: khớp số.**
- Biên nhận thật (`/v1/orders/{id}/receipt`, đơn của câu chef, đã duyệt): "1,000 × 1 l", "Fixed price 1.01 EUR/l", "Net 1,010.00 EUR",
  "Gross 1,146.35 EUR", "Approved by Kitchen manager", "Accepted = binding order, invoiced on delivery (simulated)".
- VAT không in thành dòng riêng; Gross − Net = **136.35 €** (13.5 %). Các số 1,010.00 / 136.35 / 1,146.35 khớp; chữ door là "Gross", không
  phải "total".

**Ghi thêm (ngoài 5 điểm):**
- 0:50: trang duyệt thật (`/approve/{token}`) có "Approve order", dòng hàng kèm "Stock unknown: Valio does not stock this product", "What
  changed: Requested 1,000 l, delivered 1,000 l", câu của từng mã, "Net 1,010.00 EUR Gross 1,146.35 EUR", "Decide within" (đếm ngược).
  Không có chữ "10 l boxes → 1 l cartons" hay tiêu đề "Approver inbox · Kitchen manager" (đó là chữ của animation).
- 0:53 "30 hours before the cut-off": cut-off duyệt là Sun 17:00; từ giờ truyện Sat 10:15 là 30 h 45 phút (khớp); từ đồng hồ door
  Fri 21:10 là 43 h 50 phút.

## 13. Sửa chữ theo kết quả mục 12 (áp vào Story mới)

- Câu chef (cảnh 1, 4): đổi thành "1,000 litres of lactose-free milk by Monday, in 10-litre boxes if you can." để door đọc ra `packLitres 10`. Lý do: "Bulk boxes" bị đưa vào `unclear` (door không đoán), nên không có `PACK_SIZE_CHANGED`. Session build đang kiểm câu mới, kết quả ở mục 12b.
- 0:42, tồn kho: "Stock unknown: Valio does not stock this product" (chữ thật của `stockNote`).
- 0:42, CO₂: "CO₂e 1,100 kg (product-group average)" (door không có "1.1 kg/kg").
- 1:17 (AC17): "wheat" đổi thành "gluten". Ba chỗ cần sửa:
  - VO 7: "Valio's listed substitute for a gluten-free oat drink contains gluten: refused."
  - Caption: "Valio's substitute for a gluten-free oat drink has gluten: refused."
  - Z4: "✕ 470863 · NEW_ALLERGEN · gluten (AW)"
- 0:56, biên nhận: dùng chữ của door: "Net 1,010.00 € · Gross 1,146.35 € · approved by Kitchen manager · accepted (simulated)".
- 0:38: giữ "20 are past their cut-off", "+18 more". Tổng là 7 offer và 28 bị từ chối: 20 CUTOFF_PASSED, 5 SUBTYPE_MISMATCH, 2 STOCK_LIMITED, 1 NOT_ORDERABLE. Bỏ hẳn "2 rejected" và "Only 384 left" của bản cũ.

### 12b. Câu chef mới

Câu: **"1,000 litres of lactose-free milk by Monday, in 10-litre boxes if you can."** Kiểm trên door thật (bản `b134f073`, clock Fri
13/11 21:10, replay `replies_2026-11-16`, buyer `hotel-a`), chạy được ngay lần đầu, không cần thử cách viết khác.
- `/v1/interpret`, gửi hai lần: cả hai lần `status: draft`, **`packLitres: 10`**, `1000 l`, `FREE_FROM_LACTOSE`, `deliverBy 2026-11-16`,
  `unclear: []`, **`crossCheck: { model: gemma-4-31b-it, result: agreed }`**.
- Confirm với fill rỗng → `confirmed`, `packLitres 10`. Quote: 7 offer, 28 từ chối (20 `CUTOFF_PASSED`, 5 `SUBTYPE_MISMATCH`,
  2 `STOCK_LIMITED`, 1 `NOT_ORDERABLE`, giống mục 12). **Offer 0: 464306, 1,000 × 1 l, 1,010.00 € net (1,146.35 € gross),
  `changes: ["PACK_SIZE_CHANGED"]`.**
- Đặt offer 0 → **HELD** với `OVER_ORDER_AUTO`, `OVER_DAY_AUTO`, `PACK_SIZE_CHANGED`.
- Vì vậy chip "prefers 10 l" (0:31) và "Pack size changed" (0:46) khớp với câu này. Câu cũ ("Bulk boxes if you can.") để vế đó ở `unclear`
  là đúng: door hỏi thay vì đoán.
- Kiểm xong đã reset demo về clock `2026-11-13T21:10:00+02:00`, replay `replies_2026-11-16`.

## 14. Kịch bản v2.1 (một câu chuyện)

Thay cho mục 4–6. Một bếp (Hotel Aurora), một agent, thời gian chỉ đi tới: chiều Thứ Sáu → Thứ Hai. Mọi con số lấy từ mục 12, 12b, 13.

v2.1 (Kane, 14/11): đơn sữa đứng ngay sau khi dựng cổng, để cùng một yêu cầu thấy hỏng rồi thấy được giải quyết liền nhau. Để case gà AUTO vẫn đúng luật, luật của bếp có hai mức: **agent tự đặt tới 500 € một đơn và 1.500 € một ngày** (xem 14.6).

### 14.1 Mạch truyện

1. **Thứ Sáu 16:30, chưa có door.** Chef cần 1.000 l sữa cho Thứ Hai. Agent gọi thẳng API, đặt 50 thùng hộp 10 l (1.565,50 €). Bến từ chối: hạn đặt là Thứ Năm 15:00. Còn hai ngày, chưa có sữa.
2. **Tối Thứ Sáu.** Door được dựng, mang luật do chính bếp ký: agent tự đặt tới 500 € một đơn và 1.500 € một ngày, trên mức đó thì kitchen manager duyệt.
3. **21:10, cùng câu sữa đó.** Door đọc thành yêu cầu có kiểu, tra 35 loại, từ chối hộp 10 l kèm lý do, báo giá 1.010,00 € cố định.
4. **Vượt hạn mức một đơn của bếp.** Door giữ đơn và chính door gửi yêu cầu duyệt tới điện thoại của manager. Agent sốt ruột, tự duyệt: 403.
5. **Trong lúc sữa chờ duyệt, việc nhỏ.** Gà cho Thứ Hai, 190,92 €, trong cả hai hạn mức nên không cần người (tổng ngày 1.200,92 / 1.500 €). Agent của khách sạn khác tranh cùng 6 hộp: bên mình được 4, bên kia được báo còn 2.
6. **Vẫn tối Thứ Sáu.** Chef đặt gà "for Friday": Gemini và Gemma đọc ra hai Thứ Sáu khác nhau nên door hỏi lại.
7. **Sáng Thứ Bảy.** Manager duyệt trên điện thoại, đơn sữa ACCEPTED. Buổi chiều, một khách cần sữa yến mạch không gluten: hàng thay thế của Valio có gluten, door từ chối.
8. **Chủ nhật.** Chef thêm sữa, bơ, gà. Chia nhỏ cũng vô ích: phần đầu 303,00 € đã đẩy tổng ngày qua 1.500 €. Nên gửi một giỏ 666,00 €, một yêu cầu duyệt. Manager bấm lúc 17:05, trễ 5 phút: hết hạn, không giao.
9. **Thứ Hai.** Sữa và gà tới bếp, kèm biên nhận.

### 14.2 Ai gửi yêu cầu duyệt

Sự thật: Lazydoor gửi link duyệt vào hộp thư của người duyệt, theo luật trong mandate do bếp ký. Valio không duyệt gì. Agent không bao giờ cầm link.

Cách làm rõ:
- **Hình:** ở cảnh 2, một thẻ có chữ ký bay từ điện thoại của manager vào cổng. Từ đó Z2 có hai bảng cạnh nhau: "Valio's rule · cut-off Sun 17:00" và "Kitchen's rule · agent alone up to 500 € an order, 1,500 € a day · approver: Kitchen manager", kèm thanh đo tổng ngày.
- **Hình:** khi đơn bị giữ, một phong thư ghi "from Lazydoor" bay từ khe của cổng tới điện thoại của manager, đi vòng qua đầu agent. Agent đứng tay không, chỉ có chip "HELD".
- **Lời:** "the door holds it and sends the kitchen manager an approval request: the kitchen's rule, not Valio's."
- **Caption:** "Lazydoor sends the request to the kitchen manager. Not Valio. Not the agent."

**Đề xuất đổi quyết định 3 ở mục 11: thêm điện thoại của manager làm một vật riêng** (điện thoại trên quầy bếp, có cờ tên "Kitchen manager"; không cần nhân vật mới). Lý do:
- Chef vừa gõ yêu cầu vừa duyệt trên cùng một màn hình thì người xem không thấy ai gửi cho ai, đúng chỗ Kane đã hiểu nhầm.
- Phong thư cần một đích khác chỗ agent đỗ; nếu đích là màn hình bếp thì nó bay về đúng nơi agent đứng.
- Model đã có sẵn trạng thái `phone` (buzzing, approved, expired), và door thật cũng có trang duyệt cho điện thoại (`/approve/{token}`).
- Cảnh Chủ nhật cần "manager vắng mặt": điện thoại rung mà không ai cầm thì hiểu ngay.

Nếu Kane vẫn giữ chef làm người duyệt: phong thư "from Lazydoor" bay tới màn hình bếp có tiêu đề "Approver inbox · Kitchen manager", và cảnh Chủ nhật đổi thành chef ra về, màn hình rung không ai bấm.

### 14.3 Bảng cảnh

Vùng chữ Z1–Z7 và vùng cấm theo mục 3. Mỗi caption hiện ít nhất 3 s và không nhanh hơn 17 ký tự/giây.

| Mốc | Cảnh | Hình | Caption |
|---|---|---|---|
| 0:00 | 1 · Fri 16:30, chưa có door | Lịch FRI 13. Z2 chỉ ghi "Now Fri 16:30". Chef gõ câu yêu cầu, hiện dần ở Z3: "1,000 litres of lactose-free milk by Monday, in 10-litre boxes if you can." | Friday 16:30. Hotel Aurora's chef orders milk for Monday. |
| 0:04 | 1 | Robot đưa thư lấy thẻ, chạy tới mép kho. Phong thư bay theo đường cong xám tới kệ hộp 10 l. | No door: the agent calls Valio's API itself. |
| 0:07 | 1 | Z4 hiện reply thô, 3 dòng: `availableAmount 999999`, `availableDate Mon 16 Nov`, `closingTime Thu 12 Nov 15:00` (dòng ba mờ). | Raw reply for the 10 l box: 999999, Monday 16 Nov. |
| 0:10 | 1 | Z3: phiếu của agent "50 cases × 31.31 € = 1,565.50 €". Thùng trượt về bến. | It orders 50 cases: 1,565.50 €. No one is asked. |
| 0:13 | 1 | Thanh chắn bến không mở, đèn đỏ. Dòng `closingTime` sáng lên. Robot về tay không, chef nhún vai. | The same reply also said: closed Thu 12 Nov 15:00. |
| 0:16 | 2 · tối Thứ Sáu | Cổng hạ xuống từng phần, biển LAZYDOOR sáng. Thẻ có chữ ký bay từ điện thoại của manager vào cổng. Z2 hiện hai bảng luật và thanh đo "0 / 1,500 €" có vạch 500 € ghi "per order". | Friday evening: a door, carrying the kitchen's own signed rules. |
| 0:23 | 3 · Fri 21:10, cùng câu | Robot lấy lại đúng thẻ sữa từ chef, tới vạch quét, thả vào khe. | 21:10. Same agent, same sentence, now through the door. |
| 0:26 | 3 | Z3 đổi thành yêu cầu có kiểu: `milk · lactose-free · 1,000 l · by Mon 16 Nov · prefers 10 l`, chip "Gemini ✓ Gemma ✓". | Words become a typed request, read by two models. |
| 0:29 | 3 | Máy quét chạy. Z1: `search.done: 35 candidates`, `valio.called: availability`, `valio.called: price`. | 35 lactose-free milks: Valio is asked about these. |
| 0:32 | 3 | Hàng bị loại bật lại, ✕ trên bảng tên kệ. Z4: "✕ 463038 Valio 10 l box · CUTOFF_PASSED", "✕ 464179 Arla 10 l box · CUTOFF_PASSED", "+18 more closed for Monday", và câu của mã: "The order cut-off for this product has passed for the requested delivery." | 20 are past their cut-off. Each refusal has a reason code. |
| 0:36 | 3 | Phiếu báo giá ra khỏi khe. Z3: "464306 Valio Eila 1 l · 1,000 × 1.01 € = 1,010.00 € · fixed for 30 min · reliability 1 · CO₂e 1,100 kg (product-group average) · Stock unknown: Valio does not stock this product". | Best offer: 1 l cartons, 1,010.00 €, fixed for 30 minutes. |
| 0:40 | 4 · giữ đơn | Phiếu vượt vạch 500 € "per order", đổi vàng. Thanh đo ngày lên "1,010 / 1,500 €" (phần đang chờ kẻ sọc). Z5: dấu NEEDS APPROVAL, chip "Over 500 € per order (kitchen's own limit)" và "Pack size changed". Robot chỉ có chip "HELD". | Over the kitchen's own 500 € order limit: the door holds it. |
| 0:44 | 4 | Phong thư "from Lazydoor" bay từ khe cổng tới điện thoại của manager. Điện thoại rung, hiện "Approve order · Net 1,010.00 € · Gross 1,146.35 € · Decide within 43 h". Robot tay không. | Lazydoor sends the request to the kitchen manager. Not Valio. Not the agent. |
| 0:49 | 4 | Robot thả một phong thư ghi "approve" vào khe. Khe nháy đỏ "403". Chip vẫn là HELD. | The agent tries to approve its own order: 403. |
| 0:54 | 5 · trong lúc chờ | Robot thả một thẻ đơn có kiểu, không có câu chữ: "470746 · 20 kg · by Mon 16 Nov". Bảng tên kệ: "6 left". Một phong thư thứ hai bay vào từ mép trái, ghi "another hotel". | While the milk waits: 20 kg of chicken, by product code. |
| 0:58 | 5 | Hai phong thư tới khe cùng lúc. Dấu xanh "ACCEPTED 190.92 €" cho bên mình, dấu đỏ "STOCK_TAKEN · 2 left" cho bên kia. Z1: `stock.denied: 470746 · 2 left`. | Two agents, six boxes: ours wins, the other learns 2 are left. |
| 1:02 | 5 | Thanh đo lên "1,200.92 / 1,500 €", vẫn xanh. Một thùng gà ra pallet "Mon 16 Nov" ở bến. | 190.92 €: inside both limits. No human needed. |
| 1:06 | 6 · vẫn tối Thứ Sáu | Chef gõ: "40 kg of chicken breast fillet for Friday, Atria only." | The chef plans ahead: chicken "for Friday". |
| 1:10 | 6 | Hai chip ở Z3: "Gemini: Fri 13 Nov", "Gemma: Fri 20 Nov". Robot quay về chef với thẻ "?" ghi "deliverBy". | Gemini reads today, Gemma reads next week: the door asks, never guesses. |
| 1:15 | 7 · Sat 10:15 | Lịch SAT 14, Z2 "30 h 45 min". Ngón tay chạm Approve trên điện thoại. Phong thư "approved" bay về cổng. Z5 thêm chip "Approved by Kitchen manager". Thùng sữa ra pallet Thứ Hai. | Saturday 10:15: the manager approves on the phone. Accepted. |
| 1:20 | 7 · chiều Thứ Bảy | Thẻ đơn: "Oddlygood oat drink, gluten-free · 50 l". Kệ xám ghi "out of stock (simulated)". Thùng "Oatly Oat Drink Semi" bay tới máy quét rồi bật lại. Z4: "✕ 470863 · NEW_ALLERGEN · gluten (AW)". | Valio's substitute for a gluten-free oat drink has gluten: refused. |
| 1:26 | 8 · Sun 15:50 | Lịch SUN 15. Ba phong thư nhỏ "303.00 €", "132.00 €", "231.00 €" lơ lửng dưới thanh đo "1,200.92 / 1,500 €". Phong thư 303 € chạm thanh đo: thanh lên 1,503.92 €, đỏ. Ba phong thư nhập thành một phong thư giỏ. | Sunday 15:50. Splitting would not help: the day is counted. |
| 1:30 | 8 | Ba thùng ba màu qua máy quét. Phiếu "666.00 €". Một dấu vàng. Một phong thư "from Lazydoor" tới điện thoại; điện thoại rung, không ai cầm. | Milk, butter, chicken: one basket, 666.00 €, one request. |
| 1:34 | 8 · Sun 17:05 | Z2 chạy qua 17:00, đổi đỏ, dừng ở 17:05. Ngón tay chạm Approve. Điện thoại: "Expired". Z5: "APPROVAL_EXPIRED". Pallet không thêm thùng. | 17:05: the manager taps too late. Expired, nothing ships. |
| 1:38 | 9 · Mon 16 Nov | Lịch MON 16. Xe chất pallet (gà và sữa), chạy tới bếp, chef giơ ngón cái. Z6: biên nhận sữa "1,000 × 1 l · Fixed price 1.01 EUR/l · Net 1,010.00 EUR · Gross 1,146.35 EUR · Approved by Kitchen manager · Accepted (simulated)". | Monday 16 Nov: milk and chicken arrive. Receipt in plain words. |
| 1:44 | 10 · kết | Màn kết như mục 4 cảnh 9: hai phích OpenAPI và MCP; "49 acceptance cases pass on the deployed door. Every decision is a published rule: /v1/rules."; "Valio adds: an order endpoint and its allocation rule." | (không có) |

Hết ở 1:50.

### 14.4 Lời đọc

| # | Mốc | Thời lượng | Từ | Lời |
|---|---|---|---|---|
| 1 | 0:00 | 16 s | 36 | Friday afternoon. Hotel Aurora needs a thousand litres of lactose-free milk by Monday. Its agent asks Valio's API and orders fifty cases of ten-litre boxes. But ordering for Monday closed on Thursday. Nobody checked, nobody approved. |
| 2 | 0:16 | 7 s | 15 | That evening, a door goes up at the warehouse, carrying the kitchen's own signed rules. |
| 3 | 0:23 | 17 s | 37 | Same agent, same sentence. The door reads it as a typed request, finds thirty-five lactose-free milks, and asks Valio only about those. Boxes refused, with a reason. Best offer: one-litre cartons, one thousand and ten euros, fixed. |
| 4 | 0:40 | 14 s | 34 | That is over the kitchen's limit per order. So the door holds it and sends the kitchen manager an approval request: the kitchen's rule, not Valio's. The agent tries to approve it itself: refused. |
| 5 | 0:54 | 12 s | 30 | While the milk waits, a small errand: chicken, inside the limits, no human needed. Another hotel's agent wants the same six boxes; ours gets four, theirs learns two are left. |
| 6 | 1:06 | 9 s | 17 | The chef plans ahead: chicken 'for Friday'. Gemini and Gemma read different Fridays, so the door asks. |
| 7 | 1:15 | 5 s | 9 | Saturday morning, the manager approves on the phone. Accepted. |
| 8 | 1:20 | 6 s | 13 | That afternoon, a guest needs gluten-free oat drink. Valio's substitute contains gluten: refused. |
| 9 | 1:26 | 12 s | 30 | Sunday: the chef adds milk, butter and chicken. Splitting would not help, the day is counted: one basket, one request. But the manager taps five minutes past the cut-off: expired. |
| 10 | 1:38 | 6 s | 13 | Monday: the milk and the chicken arrive, with a receipt in plain words. |
| 11 | 1:44 | 6 s | 13 | One door for any agent. Lazy at the order, strict at the border. |
| | | **110 s** | **247** | |

247 từ là khoảng 99 s ở 150 từ/phút. Nếu giọng thu ra dài quá 1:50, cắt theo thứ tự: cảnh 6 (9 s), rồi cảnh 7 phần yến mạch (6 s).

### 14.5 Bảng phủ

| Đề bài / rubric | Cảnh | Mốc | Bằng chứng |
|---|---|---|---|
| Request | 1, 3 | 0:00, 0:23 | AC01; mục 12b |
| Lookup: sản phẩm | 3 | 0:29 | AC02; mục 12.2 (35 ứng viên) |
| Lookup: giá | 3 | 0:36 | mục 12.2 (1.010,00 €) |
| Lookup: tồn kho và cut-off | 1, 3 | 0:07, 0:13, 0:32 | bản ghi `463038`; AC03, AC05; mục 12.2 |
| Order ở giá cố định | 3, 9 | 0:36, 1:38 | AC04; biên nhận mục 12.5 |
| Quyền hạn và người duyệt | 2, 4, 7 | 0:16, 0:40–0:49, 1:15 | mục 12b (HELD), scenario 1 |
| Agent tự quyết trong quyền của nó | 5 | 0:58–1:02 | AC31 (đơn 190,92 € được nhận ở mức AUTO), AC13 |
| Bonus: độ tin cậy, bền vững | 3 | 0:36 | AC27; mục 12.3 |
| Bonus: hàng thay thế | 7 | 1:20 | AC17, scenario 9 |
| Bonus: ngoại lệ | 1, 3, 5, 6, 8 | 0:13, 0:32, 0:58, 1:10, 1:34 | AC05, AC31, AC20, kiểm Gemma (mục 12.4) |
| Bonus: giải thích cho người đọc | 3, 9 | 0:32, 1:38 | `/v1/reason-codes`; biên nhận mục 12.5 |
| "It is not a chatbot" | 3, 5 | 0:26, 0:54 | yêu cầu có kiểu; đơn theo mã sản phẩm |
| "Query the APIs only when needed" | 3 | 0:29 | AC02, AC03 |
| Valio: `closingTime` là cut-off | 1, 3 | 0:13, 0:32 | Tommi; AC05 |
| Valio: ≥ 999999 là "không biết tồn kho" | 1, 3 | 0:07, 0:36 | Tommi; `stockNote` (mục 12.3) |
| Valio: không có order API | 9 | 1:38 | biên nhận ghi "(simulated)" |
| Valio: hạn mức và người duyệt là luật của khách | 2, 4 | 0:16, 0:44 | README; mandate do bếp ký |
| Valio: 429 thì chờ 30 s | không có trong Story | — | README, mã `VALIO_RATE_LIMITED` |
| Chia đơn để né duyệt | 8 | 1:26 | AC30 (luật tính tổng ngày); xem 14.6 |
| Agent tự duyệt | 4 | 0:49 | AC29, scenario 6 |
| Duyệt trễ | 8 | 1:34 | AC20, scenario 10 |
| Giỏ nhiều món | 8 | 1:30 | AC36 |
| Hai model đọc khác nhau | 6 | 1:10 | mục 12.4 |
| Rubric: e2e (30) | 3, 4, 7, 9 | 0:23–0:49, 1:15, 1:38 | AC01, scenario 1 |
| Rubric: user need (20) | 1–5, 8, 9 | — | AC05, AC36 |
| Rubric: guardrails (20) | 2, 4, 5, 8 | — | AC31, AC29, AC30, AC20 |
| Rubric: exceptions (15) | 3, 5, 6, 7, 8 | — | AC05, AC17, AC31, AC20 |
| Rubric: openness (15) | 10 | 1:44 | AC26, AC47 |

### 14.6 Hạn mức của bếp, và điều cần chạy lại

Door tính tổng ngày theo **ngày giao** và tính cả đơn ACCEPTED lẫn HELD (`src/orders/store.ts`, `src/policy/decide.ts`). Mọi đơn trong bản ghi đều giao Thứ Hai 16/11, nên tổng ngày của Hotel Aurora chỉ tăng.

Với hạn mức mặc định (500 € một đơn, 500 € một ngày), gà đặt sau sữa sẽ bị giữ vì `OVER_DAY_AUTO`. Vì vậy v2.1 reset với hạn mức riêng, không cần sửa code (`POST /admin/reset` nhận `mandate.perOrder` và `mandate.perDay`, `src/http/admin.ts`):

```json
"mandate": { "perOrder": { "auto": 500, "hard": 5000 }, "perDay": { "auto": 1500, "hard": 10000 } }
```

Kết quả theo `decide()`, chưa đo trên door:
- Sữa 1.010,00 €: vượt 500 € một đơn → `OVER_ORDER_AUTO`; tổng ngày 1.010,00 ≤ 1.500 nên **không** có `OVER_DAY_AUTO`. Cùng `PACK_SIZE_CHANGED` → HELD.
- Gà 190,92 €: dưới 500 € một đơn; tổng ngày 1.010,00 (HELD) + 190,92 = 1.200,92 ≤ 1.500 → AUTO.
- Phần chia đầu 303,00 €: dưới 500 € một đơn; tổng ngày 1.503,92 > 1.500 → bị giữ. Cảnh 8 chỉ diễn bằng thanh đo, không đặt đơn này.
- Giỏ 666,00 €: `OVER_ORDER_AUTO` và `OVER_DAY_AUTO` (1.866,92 > 1.500) → HELD.

Trước khi dựng hình, cần chạy **một lần liền, không reset giữa chừng** trên door thật (reset một lần với clock `2026-11-13T21:10:00+02:00`, replay `replies_2026-11-16`, `replayVariant { 468465: out_of_stock }` và `mandate` như trên), rồi lấy event thật làm fixture cho Story:

| Bước | Lời gọi | Kết quả chờ đợi | Nguồn |
|---|---|---|---|
| 1 | câu sữa → báo giá → đặt offer 0 | HELD: `OVER_ORDER_AUTO`, `PACK_SIZE_CHANGED` | mục 12b, hạn mức mới |
| 2 | agent gọi approve bằng key của mình | 403, đơn vẫn HELD | AC29 |
| 3 | `hotel-a` rồi `hotel-b` cùng đặt `470746`, 20 kg | `hotel-a` ACCEPTED 190,92 € ở mức AUTO; `hotel-b` REJECTED `STOCK_TAKEN`, `available 2` | mục 12.4, hạn mức mới |
| 4 | câu "for Friday, Atria only" | `needs_input`, `missing: deliverBy`, 13/11 và 20/11 | mục 12.4 |
| 5 | clock Sat 10:15, người duyệt bấm | ACCEPTED; biên nhận Net 1.010,00 / Gross 1.146,35 | mục 12.5 |
| 6 | báo giá `468465`, 50 l, cho phép thay thế | `470863` `NEW_ALLERGEN` ("adds allergen AW"), 0 offer | mục 12.4 |
| 7 | clock Sun 15:50, giỏ 300 l + 20 kg + 30 kg | một đơn HELD 666,00 €: `OVER_ORDER_AUTO`, `OVER_DAY_AUTO` | mục 12.4, hạn mức mới |
| 8 | clock Sun 17:05, người duyệt bấm cho giỏ | `EXPIRED`, `APPROVAL_EXPIRED` | AC20 (đo với đơn sữa; với giỏ thì chưa đo) |

### 14.7 Hình cần thêm hoặc đổi

- Điện thoại của manager, có cờ tên (nếu Kane duyệt 14.2).
- Phong thư "from Lazydoor" đi từ cổng tới điện thoại, và phong thư "approved" đi ngược lại.
- Z2: hai bảng luật (Valio, bếp) và thanh đo tổng ngày tới 1.500 €, có vạch 500 € "per order"; phần đang chờ duyệt kẻ sọc.
- Pallet "Mon 16 Nov" ở bến: thùng được nhận nằm đó tới Thứ Hai mới lên xe.
- Phong thư thứ hai bay vào từ mép trái (agent của khách sạn khác), không cần robot thứ hai.
- Thẻ đơn có kiểu (mã sản phẩm, số lượng, ngày) cho cảnh 5 và 7.
- Cảnh 1: Z2 chỉ có giờ, chưa có đồng hồ cut-off; đồng hồ xuất hiện cùng lúc với cổng.

### 14.8 Câu cần Kane quyết

Đã quyết: sữa ngay sau khi dựng cổng (Kane, 14/11).

1. **Người duyệt:** thêm điện thoại của manager (đề xuất, lý do ở 14.2), vẽ hẳn một nhân vật manager, hay giữ chef?
2. **Hạn mức của bếp:** 500 € một đơn và 1.500 € một ngày (để gà vẫn AUTO sau sữa), hay bỏ case gà AUTO và giữ 500 € cho cả hai?
3. **Chia đơn:** chỉ kể bằng thanh đo (như 14.3), hay đặt thật phần 303,00 € để door giữ nó?
4. **Kết:** giỏ hàng hết hạn vì manager bấm trễ, Thứ Hai chỉ có sữa và gà. Giữ, hay để manager duyệt giỏ kịp và bỏ case duyệt trễ?
5. **Chạy liền một lần** (14.6) trên door thật trước khi dựng hình: cho session build làm không?
6. **Nếu giọng dài quá 1:50:** cắt cảnh 6 trước rồi phần yến mạch, như đề xuất?

## 15. Kane đã duyệt v2.1 (14/11)

- Duyệt v2.1: sữa ngay sau khi dựng cổng; luật của bếp **500 € một đơn, 1.500 € một ngày**.
- Các câu còn lại ở 14.8 đi theo đề xuất: (1) điện thoại của manager là một vật riêng trên quầy bếp, cờ tên "Kitchen manager"; (3) chia đơn chỉ kể bằng thanh đo; (4) giữ giỏ hết hạn; (5) session build chạy chuỗi 14.6 một lần liền trên door thật, event thật làm fixture; (6) giọng dài quá 1:50 thì cắt cảnh 6 trước, rồi phần yến mạch.
- Chưa quay story.mp4, chưa merge vào main cho tới khi Kane xem bản dựng.

## 16. Ba sửa của Kane cho v2.1 (14/11), chỉ hình và chữ trên màn hình

Giọng đọc (11 đoạn đã duyệt) và mốc `VOICE` giữ nguyên; Story vẫn 1:50.

1. **Hậu quả của đơn không qua door (cảnh 1).**
   - Lúc robot về tay không (0:13,2): lịch bếp lật sang MON 16 với dấu đỏ "NO MILK".
   - Thẻ Z3 đổi thành "The agent's order · never ships": "50 cases × 31.31 € = 1,565.50 €", "Past the Thu 15:00 cut-off", "Monday: no milk in the kitchen".
   - Caption 0:12,5 đổi thành "Closed Thu 15:00. Monday: no milk."
2. **Vì sao xe tải chỉ chạy cuối truyện.**
   - Từ lúc cổng dựng xong: cột cờ ở bến, ngay sau xe tải đang đỗ, ghi "Next delivery Mon 16 Nov"; Thứ Hai, khi xe nhận pallet, cờ đổi thành "Delivery day · Mon 16 Nov".
   - Gà được nhận (0:56): thẻ Z3 "Typed order · ACCEPTED", hai dòng "470746 · 4 × 5 kg = 190.92 €" và "Accepted Fri · ships Mon 16 Nov".
   - Caption 0:59 đổi thành "190.92 €: inside both limits, no human. On the pallet for Monday."
   - Sữa được nhận (1:15): thẻ Z3 "Milk · ACCEPTED", dòng "Accepted Sat · ships Mon 16 Nov".
3. **Một door ở Valio, mọi bếp dùng chung.**
   - Cảnh 2: trụ trước của cổng có giá thẻ ba khe. Thẻ luật có chữ ký của Kitchen B và Kitchen C bay vào từ mép trái, thẻ của Hotel Aurora bay từ điện thoại của manager. Khi đủ ba thẻ, thẻ Aurora sáng lên.
   - Thẻ Z3 "One door, each kitchen's own rules" nối tới giá thẻ.
   - Caption 0:15,7 đổi thành "One door at Valio. Each kitchen brings its own signed rules."
   - Đổi tên hai bảng: Z2 "Valio's rules · same for every buyer" (dòng dưới "Cut-off Sun 17:00 · now …"); bảng ở Z6 "Hotel Aurora's rules · signed by its kitchen".
   - Danh sách Z4 lúc khách sạn kia thua cuộc tranh hàng có thêm ghi chú "Another hotel: same door, its own rules."; tiêu đề gộp thành "470746 Chicken breast fillet 5 kg · 6 left" để thẻ vẫn nằm trên nóc thùng xe tải.
4. **Cảnh 1 nhảy tới Thứ Hai rồi tua về Thứ Sáu**. Cảnh 1 dài thêm 4 s (15,6 → 19,6 s), Story thành **1:54** (114,0 s). Các cảnh sau và mốc bắt đầu của `VOICE` lùi đúng 4 s; 11 file giọng và thứ tự không đổi.
   - 0:12,5: caption "The same reply also said: closed Thu 15:00."; thẻ Z3 "The agent's order · never ships".
   - 0:15: đồng hồ chạy tới **Mon 16 Nov 07:00** trong 0,9 s, lịch lật SAT → SUN → MON 16, Z2 ghi "Now Mon 16 Nov 07:00". Xe ở bến và pallet đều trống, chef nhún vai cạnh chỗ thùng sữa trống trên quầy, lịch có dấu đỏ "NO MILK".
   - 0:15,5: caption "Monday 07:00: no milk for breakfast."; thẻ Z3 "Monday 16 Nov · 07:00" với hai dòng "No milk: the 50 cases never shipped" và "Nobody checked, nobody approved".
   - 0:17,6: nhãn "◀◀ Rewind" giữa trời và cảnh nhạt màu. Đồng hồ tường quay ngược, lịch lật MON → SUN → SAT → FRI 13, Z2 chạy lùi về "Fri 13 Nov 16:30" (1,8 s).
   - 0:18,5: caption "Rewind to Friday. This time, there is a door."
   - Cảnh 2 bắt đầu với đồng hồ chạy tới Fri 19:40. Caption "One door at Valio. Each kitchen brings its own signed rules." dời tới 1,9 s sau đầu cảnh để caption tua ngược đủ 3 s. Không thêm lời đọc.
