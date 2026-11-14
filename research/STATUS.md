# Lazydoor: trạng thái build (gửi Kane)

Phiên build tự động, bắt đầu Thứ Bảy 14/11/2026. Mỗi bước xong là một mục mới ở cuối file, mới nhất ở dưới.

## Cần Kane quyết định

**1. Deploy đang bị chặn bởi giới hạn ghi D1 miễn phí (quyết định mua là của Kane).**
- Worker đã chạy ở **https://lazydoor.lazydoor.workers.dev** (`/health` OK), nhưng mọi thao tác ghi trả 500 với
  `D1_ERROR: Your account has exceeded D1's free tier daily row write limit`. Nguyên nhân: nạp dữ liệu lên D1 từ xa (17.546 sản phẩm +
  35.881 GTIN + replay + tên nhóm, cộng các dòng index) đã dùng hết hạn mức 100.000 dòng ghi/ngày của account hackathon (gói Free).
- Hạn mức tự reset lúc **00:00 UTC = 02:00 sáng Chủ nhật 15/11 giờ Helsinki**. Sau đó demo chỉ ghi vài trăm–vài nghìn dòng mỗi lần, dư sức.
- Lựa chọn: (a) **chờ tới 02:00 Chủ nhật** rồi chạy 3 lệnh dưới (khuyên dùng; miễn phí); (b) nâng account hackathon lên **Workers Paid
  (5 USD/tháng)** để ghi được ngay — đây là mua hàng nên mình không tự làm.
- Sau khi ghi được lại (từ thư mục repo; key chỉ đọc từ file, không in ra):
  ```
  export GATEWAY_URL=https://lazydoor.lazydoor.workers.dev ADMIN_KEY="$(cat .data/valio/keys/deploy-admin.key)"
  pnpm acceptance && pnpm scenarios
  curl -s -X POST $GATEWAY_URL/admin/reset -H "Authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' -d '{"clock":"2026-11-13T21:10:00+02:00","replay":"replies_2026-11-16"}' > /dev/null
  curl -s -X POST $GATEWAY_URL/admin/judge-key -H "Authorization: Bearer $ADMIN_KEY"   # judge key cho giám khảo / trang demo
  ```
  Đừng chạy lại `index:load:remote` (chính nó tốn hạn mức). Bản local (`wrangler dev`) không bị ảnh hưởng: 49/49, scenarios 11/11.

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

### B5. Đơn hàng, sổ kho, duyệt, biên nhận (xong)
- Task 7 (`ee83c76`, `9b46491`): policy (hạn mức đơn/ngày, D1), sổ kho chỉ đơn ACCEPTED, commit một batch D1, giỏ hàng, token duyệt chỉ ở
  hộp thư người duyệt, duyệt lại (hết giờ / giá đổi / hết kho). Chứng minh bằng test đua thật: 20 đơn cùng lúc trên 6 đơn vị → đúng 1
  ACCEPTED; xoá guard thì test đỏ. Review Opus (kiểm SQL sổ kho trên SQLite): an toàn; 1 lỗi quan trọng (key idempotency có thể kẹt 409
  sau khi đã commit → dễ sinh đơn trùng) đã sửa; agent không thể duyệt (role bắt buộc).
- Task 8 (`15dad49`, `7f1da7a`): biên nhận văn bản (đúng "1,010.00", "1,146.35", "Kitchen manager"), trang duyệt trên điện thoại, hộp thư
  người duyệt có QR. Review: quy tắc "còn bao nhiêu hàng" bị lặp ở trang → gộp về một helper.
- Đang chạy: Task 10a (HTTP API, khoá API, route admin, OpenAPI) → sau đó chạy 49 case nghiệm thu thật lần đầu.

### B6. HTTP API (Task 10a, `680d872`) — lần chạy nghiệm thu thật đầu tiên
- Chạy 49 case với `wrangler dev` (replay bản ghi Thứ Sáu, Gemini thật): **43 PASS / 6 FAIL / 0 BLOCKED**. AC01, AC24, AC44 (cần model) đã
  PASS với `gemini-3.8-flash`. 6 FAIL đều là route chưa làm: resolve (AC41–43), families (AC45), rules (AC47), MCP (AC26).
- Đang chạy: review Opus cho 10a (bảo mật route), và Task 10b (resolve, families, rules, event stream cho trang demo).

### B7. Resolve / families / rules / events + MCP (xong, đang review)
- Task 10b (`b5e5f80`, `73a5958`): resolve (GTIN, tên trùng, thương hiệu không có → không tự sửa), families + tìm theo dịp, `/v1/rules`,
  `/v1/reason-codes`, `GET /v1/events` + SSE `/v1/events/stream` đúng `docs/events.md`. Review: sạch sau 1 vòng sửa.
- Task 11 (`34a9781`): MCP server `lazydoor`, 9 tool, cùng schema với HTTP.
- **Nghiệm thu với `wrangler dev`: 49/49 PASS, 0 BLOCKED** (3 lần chạy; một lần trước đó 48/49 chưa rõ case nào → mình sẽ chạy lặp để bắt).
- Đang chạy: sửa review Task 10a (JSON hỏng trả 500 thay vì 400; chuyển xác thực thành middleware), review Task 11.
- Còn lại: Task 13 (agent mua hàng Gemini + kịch bản demo), README (Task 14a), review toàn nhánh (Opus), deploy (Task 14b).

### B8. Agent mua hàng, kịch bản demo, README
- Task 13 (`67a576b`): agent Gemini (`pnpm agent`) gọi 9 tool MCP; chạy thật ví dụ của đề bài: chọn 464306, 1.010,00 € → HELD chờ "Kitchen
  manager" → duyệt qua hộp thư → ACCEPTED. Agent không bao giờ thấy link/khoá duyệt. `pnpm scenarios`: 11/11 PASS (không cần model).
- README (`bafc7cf`, `bdf5421`) + `docs/reason-codes.md` (sinh từ code). Review: không có câu sai.
- Task 10a xong sau 2 vòng sửa (JSON hỏng → 400; xác thực thành middleware; reset kiểm đồng hồ trước khi xoá).
- **Lỗi thật tìm được khi chạy nghiệm thu lặp lại**: `interpret` (gemini-3.8-flash) ~2/15 lần trả về thiếu `claims`/số lượng/ngày. Số lượng
  và ngày rơi vào `unclear` (an toàn), nhưng mất "lactose-free" thì KHÔNG bị báo → agent có thể đặt sữa thường. Đang sửa: bắt buộc mọi
  trường trong schema (nullable), và một luật cố định: câu có "lactose-free/laktoositon" mà draft thiếu claim → đưa `claims` vào `unclear`.
- Đang chạy: sửa MCP (lỗi trả về không khớp outputSchema làm SDK client ném lỗi; lỗi lạ lộ message).

### B9. Sửa xong lỗi `interpret` + mọi task đã qua review
- Nguyên nhân: schema trả về của Gemini để các trường là tuỳ chọn → model đôi khi bỏ trống. Sửa: mọi trường bắt buộc (nullable),
  luật cố định cho từ claim (EN + FI, kể cả "laktoosittoman"): câu nói "lactose-free" mà draft thiếu claim → `claims` vào `unclear`, kể cả
  lúc confirm (agent không xoá được yêu cầu). Mẫu 20 lần: trước 17/20 đầy đủ, sau 20/20 (2 lần).
- Kiểm tra cuối: **nghiệm thu 8 lần liên tiếp 49/49** (Gemini thật), **vitest 291/291**. Đã push `62463f4`.
- MCP: lỗi trả về không còn làm SDK client ném lỗi; lỗi lạ bị che. Agent mua hàng vẫn đọc được lỗi.
- Đang chạy: review toàn nhánh (Opus, cổng cuối). Sau đó: một đợt sửa (nếu có) → deploy lên account Cloudflare hackathon.

### B10. Review toàn nhánh (Opus, cổng cuối) + chuẩn bị deploy
- Kết luận: **không có lỗi Critical**; tiền/kho/token/policy giữ đúng dưới đua song song. 8 lỗi Important đang được sửa trong một đợt:
  hàng thay thế thiếu dữ liệu dị ứng không bị cảnh báo; guard secret bỏ sót dòng `export` (cf.env); chưa có judge key; agent bỏ cuộc khi
  REJECTED (spec nói phải thử lại); đồng hồ đếm ngược trên điện thoại dùng giờ máy; `/v1/rules` lệch với code; thiếu script deploy; trình
  duyệt không gửi được header cho SSE.
- **Thay đổi hợp đồng event cho trang demo** (`docs/events.md`): sẽ thêm CORS cho `GET /v1/events*` và hướng dẫn trình duyệt dùng `fetch()`
  kèm header `Authorization` (EventSource không gửi được header); thêm `POST /admin/judge-key` để trang demo/giám khảo không cần admin key.
  Schema event không đổi.
- D1 trên account Cloudflare hackathon đã tạo và nạp dữ liệu (17.546 sản phẩm, 1.078 dòng replay, 349 tên nhóm). Worker deploy sau đợt sửa.

### B11. Deploy (Task 14b)
- Đợt sửa cuối (`eb4ba96`..`40aee70`, 9 commit) qua re-review Opus: "ready to deploy". vitest 297/297, nghiệm thu 49/49, scenarios 11/11
  (local). `docs/events.md` thêm: CORS chỉ cho `GET /v1/events*`, trình duyệt dùng `fetch()` + header; `since` sai → 400.
- Worker `lazydoor` đã deploy lên account Cloudflare hackathon (token trong `cf.env`, không dùng login mặc định):
  **https://lazydoor.lazydoor.workers.dev** — subdomain workers.dev mới tạo nên đang chờ chứng chỉ TLS (vài phút). Secrets
  `VALIO_API_KEY`, `GEMINI_API_KEY`, `ADMIN_KEY` (ngẫu nhiên, chỉ lưu ở `.data/valio/keys/deploy-admin.key`) đã đặt.

### Tổng kết phiên build (Thứ Bảy 14/11, ~03:00)
- **Xong**: Phase A (spec/plan/49 case/đổi tên) + Phase B (Task 0–13, 14a) trên `main`, mọi task qua review Opus (hoặc Sonnet cho phần nhỏ)
  với vòng sửa; review toàn nhánh (Opus) không có lỗi Critical; một đợt sửa cuối đã re-review sạch.
- **Kiểm chứng local** (`wrangler dev`, replay bản ghi Thứ Sáu, Gemini thật): nghiệm thu **49/49** (9 lần chạy liên tiếp sau lần sửa
  interpret), **vitest 297/297**, **scenarios 11/11**, agent Gemini chạy thật ví dụ đề bài tới ACCEPTED sau khi người duyệt bấm.
- **Deploy**: Worker đã lên, nhưng kiểm chứng trên URL bị chặn bởi hạn mức ghi D1 miễn phí — xem mục "Cần Kane quyết định" ở đầu file.
- Chưa làm: phục vụ `/demo` (chờ nhánh `demo-animation` merge); các lỗi nhỏ đã hoãn có danh sách trong ledger local
  (`.superpowers/sdd/.../progress.md`, không commit).

### Các quyết định mình tự đưa ra thay Kane (sai thì tốn gì)
1. Làm thẳng trên `main` (task yêu cầu push `main`) — sai: phải tách nhánh sau.
2. Một review Opus mỗi task, implementer Sonnet, cổng cuối Opus; review Sonnet cho 12b, 10b, README (phần nhỏ, không có tiền/bảo mật).
3. Gộp 12a (subtype đã review cho sữa/gà/bơ, không dùng model) vào Task 2; gộp Task 4 vào Task 3; tách Task 10 thành 10a/10b.
4. Quote không lọc thương hiệu ở bước search mà từ chối có mã (BRAND_EXCLUDED) để "mọi ứng viên được tính đúng một lần" (AC46).
5. Thứ tự mã từ chối: NEW_ALLERGEN trước CLAIM_MISSING (AC17 cần) — spec đã sửa cho khớp.
6. Giỏ/tham chiếu thiếu hàng: lấy hết hàng của sản phẩm tham chiếu trước, rồi mới hàng thay thế rẻ nhất.
7. Replay chỉ có thể bật cưỡng bức, không tắt được sau CN 17:00 (khi đó live cũng không bán gì).
8. Ký lại mandate làm token duyệt đang chờ hết hiệu lực (409).
9. Dòng hàng không còn đặt được lúc commit → STOCK_TAKEN, available 0.
10. Xác thực là middleware chung cho `/v1/*` (chỉ `/v1/rules`, `/v1/reason-codes` công khai).
11. Câu có từ claim bị phủ định ("not lactose-free") thì không confirm được nếu thiếu claim — an toàn, buyer phải viết lại.
12. Không retry Gemini trong request (một đợt lỗi giống rate-limit; agent nhận 503 và tự thử lại).
13. Bản deploy giữ `DEMO_MODE=1` (cần đặt đồng hồ/replay cho demo), admin route chỉ mở với `ADMIN_KEY` ngẫu nhiên dài.
14. Judge key: `POST /admin/judge-key`, role judge gắn với hotel-b, sống qua reset — trang demo/giám khảo không cần admin key.
15. CORS chỉ cho `GET /v1/events*` (origin *, header Bearer, không nhận key qua query string).
16. Hoãn: `reliability.tri` của quote theo sàn mặc định 0.9 (policy vẫn dùng sàn trong mandate); quét cả bảng ở resolve/families (đủ cho demo);
    guard secret có thể bỏ sót biến tên kiểu `exportADMIN_KEY` (không tồn tại).
