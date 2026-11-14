# Lazydoor: trạng thái build (gửi Kane)

Phiên build tự động, bắt đầu Thứ Bảy 14/11/2026. Mỗi bước xong là một mục mới ở cuối file, mới nhất ở dưới.

## Cần Kane quyết định

Hiện không có gì. (Quyền Hyperdrive đã được thêm; Aiven + Gemma đã deploy, xem C3 ở cuối file.)

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

### B12. Ba sửa theo câu trả lời của Valio trên Discord (Tommi, Thứ Bảy 09:35 / 09:40)
- **429**: Valio trả 429 → chặn 30 s (hoặc theo `Retry-After`, kẹp trong 1–300 s), trong lúc chặn không gọi Valio; door trả **503
  `VALIO_RATE_LIMITED`** kèm header `Retry-After`; không báo giá / không đặt hàng khi không có giá mới. Agent tham chiếu chờ (≤ 60 s) rồi
  thử lại đúng một lần. Trạng thái chặn để trong bộ nhớ từng isolate (D1 đang hết hạn mức ghi). Commit `0d6b9ba`, `9206da1`.
- **≥ 999999 = "không biết tồn kho"**, không phải "vô hạn" (vẫn cho đặt mọi số lượng như logic của Valio). Nhãn hiện trên dòng báo giá
  và trang duyệt: "Stock unknown: Valio does not stock this product". `/v1/rules`, README, spec/plan đã đổi chữ. Commit `7d07d42`.
- **README**: hạn mức và người duyệt là luật của chính khách hàng (trong mandate họ ký), Valio không đặt; "chỉ quản lý được đặt hàng"
  không còn đủ khi agent đặt thay; người duyệt khi vượt hạn mức khớp với điều Valio nói là cần lúc này. Commit `84c8ccf`.
- Review Opus: đạt, một lỗi quan trọng (Retry-After không có trần) đã sửa, re-review sạch.
- Kiểm chứng local: vitest **315/315**, nghiệm thu **49/49** (2 lần), scenarios **11/11**. Đã push `9206da1` và **deploy** (phiên bản
  `a9222b44`): `/health`, `/v1/reason-codes`, `/v1/rules` trên URL thật trả nội dung mới. Kiểm thử có ghi trên URL thật vẫn chờ hạn mức D1
  reset lúc 00:00 UTC (mục đầu file).

### C1. Phần ghi chuyển sang Aiven PostgreSQL (code xong, deploy chờ quyền Hyperdrive)
- **Ruling (thiết kế):**
  1. Mọi bảng ghi sang Postgres: `settings` (đồng hồ, replay), `api_keys`, `buyer_keys`, `approver_keys`, `mandates`, `drafts`, `quotes`,
     `baskets`, `orders`, `order_lines`, `events`, `rate_limits`. Danh mục (`products`, `product_gtins`, `category_names`,
     `valio_replies`) ở lại D1, chỉ đọc; không chạy lại `index:load:remote`.
  2. Hyperdrive đứng trước Aiven, **tắt cache** (đọc luôn thấy lần ghi cuối), giới hạn kết nối tới origin 10 (Aiven cho tối đa 15).
     Driver `postgres` 3.4.9 (bản 4.x mới ra 2 tuần, chưa dùng), bật `nodejs_compat`. Mỗi request có client riêng (`src/index.ts` copy
     `env`), tối đa 3 socket/request để còn chỗ cho Valio và Gemini (Worker giới hạn 6 kết nối mở).
  3. `src/db.ts`: lớp mỏng mang dạng D1 (`prepare/bind/first/all/run/batch`), đổi `?` → `$n`; các store giữ nguyên lời gọi, chỉ đổi SQL
     của SQLite (json_each → jsonb, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `rowid` → cột `id`).
  4. Kho cho đơn ACCEPTED vẫn là một lần commit nguyên khối: mỗi `batch` là **một transaction** và lấy trước `pg_advisory_xact_lock(1)`,
     nên hai lần commit sổ kho không bao giờ xen nhau (giống D1 vốn ghi tuần tự). Giới hạn: mọi commit đi một hàng; nâng cấp = khoá
     theo (sản phẩm, ngày) nếu có hàng đợi.
  5. Event: insert lấy `pg_advisory_xact_lock(2)` để seq commit đúng thứ tự, nên client đọc `seq > since` không bỏ sót event.
  6. Schema là `CREATE TABLE IF NOT EXISTS`, chạy ở `/admin/reset`, `/admin/judge-key` và lúc setup test; không cần script migrate riêng.
  7. `/health` thêm `store`: `aiven-postgres` khi server có extension `aiven_extras`, ngược lại `postgres`.
  8. Test: Postgres 18 trong Docker (`pnpm pg:local`, cổng 54329, mật khẩu dev công khai `lazydoor`); setup tạo bảng và TRUNCATE mỗi file
     test, các file chạy tuần tự (dùng chung một Postgres). Đường test thật sự đi qua binding Hyperdrive của miniflare → Postgres.
- Kiểm chứng local: vitest **319/319** (thêm `test/db.test.ts`; các test race 20 đơn/6 đơn vị, hai lần duyệt cùng token, idempotency giờ
  chạy đồng thời thật trên Postgres), `wrangler dev` + Postgres 18: nghiệm thu **49/49**, scenarios **11/11**; `check-secrets` OK
  (nó quét cả `~/.config/junction2026/aiven.env`, đã chạy thử).
- Ghi chú: mở Docker Desktop để chạy Postgres local làm vài container cũ của Kane (restart policy) tự chạy lại; mình không đụng tới chúng.
- README có mục "Aiven PostgreSQL holds every write": sổ kho một transaction, audit log thứ tự chặt, không còn hạn mức ghi theo dòng.
- Review Opus cho C1: không có lỗi nghiêm trọng (sổ kho, idempotency, thứ tự event đều đúng). Hai lỗi đã sửa ở `9677a8e`:
  `net_cents`/`gross_cents` phải là BIGINT (SQLite INTEGER là 64-bit; tồn kho "không biết" cho phép báo giá vượt 2^31 cent → trước đây 500);
  `since` > 2^31 trả trang rỗng thay vì 500, và SSE đóng stream khi đọc lỗi thay vì treo. Rủi ro deploy reviewer nêu (cache Hyperdrive bật
  mặc định) đã nằm trong cách tạo: tắt cache; sau deploy sẽ thử đổi `/admin/clock` rồi xem `/health` thấy ngay.

### C2. Gemma 4 đọc lại mỗi yêu cầu (xong local, commit `b94bd60`)
- **Ruling:**
  1. Model: lấy từ `models.list` của key AI Studio: có `gemma-4-26b-a4b-it` và `gemma-4-31b-it`. Chọn **`gemma-4-31b-it`**: nhận đúng
     prompt hệ thống + JSON schema, trả lời 3–5 s; bản 26B-A4B treo quá 300 s không trả lời. Đặt ở biến `GEMMA_MODEL` (wrangler vars).
  2. Gemma đọc **độc lập, song song** với Gemini, cùng prompt và schema; cả hai bản đọc qua cùng bộ luật `validate`, rồi so từng trường
     (claims so như tập hợp, tên brand không phân biệt hoa thường). Khác nhau ở bất kỳ trường nào → `needs_input`: trường đó bị bỏ
     khỏi draft, ghi trong `missing` và `disagreement` (mỗi model đọc ra gì); người mua điền ở `confirm_draft`. Door không chọn bên nào.
  3. `confirm_draft` nhận draft `needs_input` chỉ khi fill có đủ mọi trường trong `missing` (`needs` không bao giờ điền được, nên yêu cầu
     không có loại hàng vẫn bị từ chối như trước).
  4. Gemma không trả lời (lỗi, quá 20 s, hết quota) → draft giữ nguyên như Gemini đọc, ghi `crossCheck.result = "unavailable"`; không
     chặn việc đặt hàng. Lý do: quota Gemma của key chỉ ~15k token/phút (prompt ~4k token; đo được: 8 lời gọi ngắn liên tiếp OK, ~4 lời
     gọi đầy đủ trong một phút thì 429). Muốn chặt hơn (fail closed) chỉ cần đổi một chỗ.
  5. Gemma đôi khi bọc JSON trong khối Markdown ``` → đọc phần `{...}` ngoài cùng.
  6. **Đổi schema event (thêm, không phá):** `draft.created` có thêm `crossCheck: { model, result, fields }`; đã ghi vào `docs/events.md`.
- Ví dụ thật (đo trên API): "We need 40 kg of chicken breast fillet for Friday, Atria only" gửi Thứ Sáu 13/11: Gemini đọc 13/11, Gemma
  đọc 20/11 → giờ door hỏi lại người mua thay vì đoán. Với AC01/AC24/AC44 hai model đọc giống nhau.
- Key không vào repo: test dùng stub; `check-secrets` vẫn chạy trước mỗi commit.
- Kiểm chứng local: vitest **325/325**; nghiệm thu **49/49** với Gemini + Gemma thật (AC01, AC24, AC44 PASS); scenarios **11/11**.
- Codex: không dùng, nên không ghi vào bài nộp.
- Review Opus cho commit Gemma: không có lỗi nghiêm trọng hay quan trọng; 6 điểm nhỏ đã sửa (commit sau `b94bd60`): claims so như tập
  hợp thật (bỏ trùng); điền `packLitres` sai (chuỗi, 0, âm) giờ bị giữ lại là unclear thay vì lặng lẽ bỏ; khi Gemini không thấy loại hàng
  thì draft vẫn là `needs_input` thường, không kèm disagreement không thể giải; `readings` hiện đúng chữ mỗi model viết; Gemini lỗi thì
  huỷ luôn lời gọi Gemma (đỡ tốn quota); mô tả OpenAPI cập nhật. Vitest **328/328**.
- Lưu ý demo: quota Gemma ~4 lời gọi đầy đủ/phút cho cả Worker, nên khi nhiều agent cùng chạy thì `crossCheck` sẽ hay là
  `unavailable` (đã thiết kế để không chặn đặt hàng). Muốn chắc chắn Gemma luôn đọc thì cần quota cao hơn (gắn billing cho key) hoặc
  rút gọn danh mục trong prompt của Gemma.
- Deploy cả hai phần chờ quyền Hyperdrive (mục đầu file).

### C3. Deploy Aiven + Gemma (xong)
- Kane thêm quyền Hyperdrive cho token. Upload CA của Aiven vẫn 403 (token chưa có quyền SSL and Certificates), nên Hyperdrive dùng
  `sslmode=require`: kết nối vẫn mã hoá, chỉ không kiểm CA riêng của Aiven.
- Hyperdrive `lazydoor-pg` (id `21b9cce92554495198bb02c3d2cb226b`, tắt cache, tối đa 10 kết nối tới Aiven); tạo qua API bằng script
  đọc URL từ `aiven.env` ngay trong tiến trình, không in ra, không đi qua dòng lệnh. Không cần secret mới cho Worker.
- Deploy phiên bản **`b134f073-d863-4998-a66b-1019cbd10aa1`** ở https://lazydoor.lazydoor.workers.dev.
- Kiểm trên URL thật:
  - `/health`: `"store":"aiven-postgres"`; đổi `/admin/clock` rồi đọc `/health` thấy giờ mới ngay (Hyperdrive không cache).
  - Nghiệm thu **49/49**, scenarios **11/11** (gồm hai agent tranh 6 đơn vị: một ACCEPTED, một STOCK_TAKEN, chạy trên Aiven).
  - Gemma thật: "1,000 litres of lactose-free milk by Monday" → `crossCheck: agreed`; "40 kg of chicken breast fillet for Friday,
    Atria only" → `needs_input`, `missing: ["deliverBy"]`, Gemini đọc 13/11, Gemma đọc 20/11. Event `draft.created` mang `crossCheck`.
- Trạng thái demo cuối: reset với clock `2026-11-13T21:10:00+02:00`, replay `replies_2026-11-16` (`/health`: `replay: true`).
- Judge key đã mint (vai judge, buyer hotel-b, đọc được mọi event: thử `/v1/events` → 200). Key nằm ở
  `.data/valio/keys/judge-key.json` (gitignore, quyền 600), không in ra.
- D1 giờ chỉ còn danh mục, chỉ đọc; hạn mức ghi D1 không còn ảnh hưởng demo.
- Giới hạn đã biết (chưa sửa, theo quyết định): agent tham chiếu `agent/plan.ts` `fillUnclear` chỉ tự điền khi `unclear` chứa đúng chữ
  `packLitres`; Gemini ghi unclear bằng chữ tự do (vd. "bulk boxes"), nên agent không tự confirm được câu kiểu "Bulk boxes if you can."
  Door để vế đó ở `unclear` là đúng ("asks, never guesses"). Câu chef của video đổi thành "…, in 10-litre boxes if you can." (ra
  `packLitres 10`, Gemma agreed; xem `demo/SCRIPT.md` mục 12b ở nhánh demo).


### C4. Chạy liền chuỗi Story v2.1 trên door thật (xong)
- Reset một lần (clock Thứ Sáu 21:10, replay `replies_2026-11-16`, `468465` hết hàng, hạn mức bếp 500 € một đơn và 1.500 € một
  ngày), rồi chạy 8 bước của `demo/SCRIPT.md` mục 14.6 liền, không reset giữa chừng. **8/8 đúng như chờ đợi:**
  1. Sữa: HELD, `OVER_ORDER_AUTO` + `PACK_SIZE_CHANGED`, **không** có `OVER_DAY_AUTO`; Gemma agreed, `packLitres 10`.
  2. Agent tự duyệt: 403 `AGENT_CANNOT_APPROVE`, đơn vẫn HELD.
  3. Gà `470746` 20 kg: hotel-a ACCEPTED 190,92 € ở mức AUTO; hotel-b REJECTED `STOCK_TAKEN`, `available 2`.
  4. "for Friday, Atria only": `needs_input`, `missing: deliverBy`, Gemini 13/11, Gemma 20/11.
  5. Thứ Bảy 10:15 duyệt sữa: ACCEPTED, biên nhận Net 1.010,00 / Gross 1.146,35 EUR.
  6. Yến mạch `468465`: 0 offer, `470863` `NEW_ALLERGEN` ("adds allergen AW").
  7. Chủ nhật 15:50 giỏ 3 dòng: một đơn HELD 666,00 € (gross 755,91), `OVER_ORDER_AUTO` + `OVER_DAY_AUTO`.
  8. Chủ nhật 17:05 duyệt giỏ: `EXPIRED`, `APPROVAL_EXPIRED` (lần đầu đo trên giỏ).
- Mọi request, response và 52 event lưu ở `.data/story-v2.1-run.json` (gitignore, quyền 600, đã thay mọi key và token bằng nhãn).
- Sau đó reset về trạng thái demo chuẩn; `/health`: Thứ Sáu 21:10, replay, `aiven-postgres`. Judge key vẫn dùng được.

### C5. Event log đọc được không cần key trên door demo (xong)
- Kane duyệt: khi `DEMO_MODE=1`, `GET /v1/events` và `GET /v1/events/stream` trả lời cả request **không có header
  Authorization**, như judge key (mọi buyer, chỉ đọc), để chế độ Live của trang demo xem được door. Có key thì như cũ (agent key
  chỉ buyer của mình, hỏi buyer khác 403). Key sai hoặc header rỗng vẫn 401, không lùi về chế độ không key. `DEMO_MODE` tắt thì
  không key vẫn 401. Các route `/v1` khác không đổi.
- Code: `keylessDemo` trong `src/http/auth.ts`, dùng ở middleware `authenticate` và `scope` của `src/http/events.ts`. Đã cập nhật
  OpenAPI summary của hai route, README và `docs/events.md`.
- Đã kiểm mọi chỗ gọi `logEvent` (18 chỗ) và 52 event thật của lần chạy v2.1: không event nào mang approval token hay link, API
  key hay chữ ký mandate. Ai cũng đọc được: câu yêu cầu của buyer (`draft.created.text`), mã sản phẩm, số lượng, giá Valio
  (`netCents`, `netCentsPerSalesUnit`) và mã lý do.
- Giới hạn đã biết: đọc không key chưa có rate limit (mỗi request một query có index; mỗi stream đang mở một query mỗi giây trong
  khoảng 60 s). Nếu trang công khai có nhiều người xem thì thêm giới hạn theo IP.
- Test: 329/329 (thêm case không key; cập nhật hai case cũ). Deploy phiên bản **`88244083-c195-487c-8a17-65c2fc37ac9a`**. Kiểm trên URL
  thật: không key → 200 kèm event, stream không key → 200 `text/event-stream`, key sai → 401. Nghiệm thu **49/49**, scenarios
  **11/11**. Đã reset demo về trạng thái chuẩn (Thứ Sáu 21:10, replay, mandate mặc định); judge key vẫn dùng được.

### Quy ước reset demo chuẩn (từ 14/11, sau khi quay Live)
- Từ giờ "reset demo chuẩn" là: clock `2026-11-13T21:10:00+02:00`, replay `replies_2026-11-16`, **và mandate của bếp v2.1**
  `{"perOrder":{"auto":500,"hard":5000},"perDay":{"auto":1500,"hard":10000}}`, không dùng mặc định 500/500 nữa. Bảng luật của
  trang Live hiển thị 500 € một đơn và 1.500 € một ngày, nên door phải khớp. Door hiện ở đúng trạng thái này (session tổng đã reset).
- Lưu ý: `pnpm agent` (không có `AGENT_KEY`) tự reset với mandate **mặc định** 500/500 (`agent/buyer.ts`, `main`). Sau khi chạy
  agent, reset lại theo quy ước trên.
- Sửa lỗi nhỏ của agent: dòng HELD in `PACK_SIZE_CHANGED: undefined` vì lý do loại thay đổi offer không có `detail` (trường này
  vốn là tuỳ chọn, `src/policy/decide.ts`). Giờ agent chỉ in mã khi không có detail. Không cần deploy (agent chạy ở máy).

### C6. Merge nhánh demo và phục vụ trang demo ở /demo (xong, **chưa push**)
- Kane duyệt "Merge và phục vụ /demo". Đã merge `origin/demo-animation` (`a475c58`) vào main bằng merge commit `266b073`; không
  đụng worktree demo.
- **Kane dặn: không push gì lên GitHub cho tới khi Kane cho phép** (giấu bản mới với các đội khác tới sát giờ pitch). Merge và
  commit này chỉ nằm ở máy. `origin/main` vẫn ở `827cac8`. Nhánh `origin/demo-animation` (`a475c58`) do session demo push từ trước.
- Phục vụ bằng Workers static assets: `scripts/build-demo.mjs` chép đúng các file trang demo cần (index.html, css, các .mjs,
  `kit/`, `fixtures/`, `assets/`) vào `dist/assets/demo/` (đã gitignore). Wrangler chạy script đó trước mỗi lần deploy,
  `pnpm test` cũng vậy. Không publish `demo/dev/`, `demo/test/`, `demo/shots/`, SCRIPT.md, STATUS.md, `story.mp4`.
- Worker chạy trước mọi asset (`run_worker_first`), nên không asset nào che được route API. `/demo` trả 301 về `/demo/`, còn
  `/demo/*` lấy file từ binding `ASSETS`. Lớp assets trả 200 cho request có Range (đã kiểm trong miniflare), nên Worker tự cắt
  đoạn và trả 206 để audio player tua được.
- Test: 334/334 (thêm `test/demo.test.ts`, viết trước cho đỏ). Lúc chạy test, Docker đã tắt (máy từng crash vì RAM). Mình bật
  Docker chỉ để chạy test rồi tắt lại ngay.
- Deploy phiên bản **`bf69c1ea-eaba-4a85-8bb9-6303d2238156`**. Kiểm live bằng curl:
  - `/demo` → 301 về `/demo/`; `/demo/` → 200 `text/html`; `/demo/main.mjs` → 200 `text/javascript`;
  - `assets/voice/01.mp3` với `Range: bytes=0-99` → 206, `bytes 0-99/117548`;
  - `dev/`, `SCRIPT.md`, `story.mp4`, `shots/` → 404;
  - `/v1/events` không key → 200; `/health` → `aiven-postgres`.
- Nghiệm thu trên door: **49/49**. Sau đó reset demo chuẩn (Thứ Sáu 21:10, replay, mandate bếp 500/1.500).
- Trang demo công khai: https://lazydoor.lazydoor.workers.dev/demo/

### C7. Audit log băm nối chuỗi, quote và biên nhận có chữ ký, tài liệu discovery (xong, **chưa push**)
Kane duyệt cả 3 phần ("làm cả 3, k cần lo thời gian, làm cho tốt là đc"). Làm theo TDD; chỉ commit ở máy.

**Phần 1. Event log băm nối chuỗi trên Aiven**
- Mỗi event có thêm `prevHash` và `hash`:
  - `hash` = sha256 của (`prevHash` + JSON chuẩn RFC 8785 của event, bỏ hai trường hash).
  - Event đầu tiên nối vào 64 số 0. `/admin/reset` bắt đầu chuỗi mới; seq vẫn tăng tiếp qua các lần reset.
- Chuỗi được tính trong cùng transaction và cùng advisory lock 2 với lúc ghi event:
  - Câu lệnh lấy lock tách riêng, nên câu lệnh đọc hash trước đó thấy mọi event đã commit.
  - Vì vậy chuỗi luôn thẳng, và người đọc không bao giờ thấy một hash đổi về sau.
  - Có test 25 event ghi song song.
- `GET /v1/audit/verify` (công khai, tối đa 30 lần/phút cho mỗi địa chỉ):
  - Tính lại toàn chuỗi trong một snapshot REPEATABLE READ.
  - Trả `{count, firstSeq, headSeq, headHash, valid, firstBadSeq?, checkedAt}` cùng một JWS ký bằng khoá của door.
- `POST /admin/tamper` (chỉ demo, cần admin key) sửa data của một event mà không đổi hash, để verify chỉ ra đúng seq đó.
- `scripts/verify-audit.mjs` kiểm từ bên ngoài, chỉ cần Node:
  - Tính lại chuỗi và kiểm head đã ký với JWKS.
  - `--head seq:hash` phát hiện event bị cắt ở cuối.

**Phần 2. Quote và biên nhận có chữ ký**
- Door có khoá Ed25519 riêng:
  - Khoá được tạo ở máy, lưu ở `~/.config/junction2026/door-signing.jwk` (quyền 600, chưa từng in ra) và trong Worker secret `DOOR_SIGNING_JWK`.
  - Khoá công khai ở `/.well-known/jwks.json`, kid `6W6BP7gnqzLnA09LygvL0SPEyt_BZcdh_msRvMUL9HU` (thumbprint RFC 7638).
- Mỗi offer mang `jws` ký các trường ràng buộc: quote, offer, buyer, ngày giao, từng dòng, tổng, tiền tệ, `validUntil`, `iat`, `aud`.
- Đơn hàng có thể gửi kèm `quoteJws` (cả từng selection của giỏ). Door đặt đơn chỉ khi chữ ký đúng và mọi trường khớp offer đã lưu; nếu không thì trả 422 `QUOTE_SIGNATURE_INVALID` và không tạo đơn nào.
- Đơn cuối (ACCEPTED/REJECTED/EXPIRED) mang `jws` biên nhận, có `approvedBy` và `decidedAt`. Đơn HELD chỉ có biên nhận sau khi người duyệt quyết.
- Agent tham chiếu kiểm JWS với JWKS trước khi đặt, in "quote signature verified". Không có chữ ký khớp thì không đặt.

**Phần 3. Discovery**
- `GET /.well-known/agent-gateway.json` liệt kê: API, MCP, rules, reason codes, events, audit, JWKS, mô hình duyệt (agent nhận 403), `/demo/`, repo.
- `/openapi.json` có link tới tài liệu này.

**Review độc lập (Opus, chỉ đọc diff)**
- Không có lỗi critical.
- Đã sửa 8 điểm:
  1. Migration: áp `SCHEMA` lên Aiven trước khi deploy, có ghi trong README.
  2. Thiếu khoá ký: door từ chối quote và đơn trước khi ghi hay đặt bất cứ gì.
  3. verify: thêm rate limit.
  4. Agent: không đặt nếu thiếu chữ ký khớp, và so mọi trường ràng buộc.
  5. Secret hỏng: thông báo lỗi không lộ phần nào của khoá.
  6. verify đọc toàn bộ trong một snapshot.
  7. Script kiểm ngoài: sửa dòng hướng dẫn và thêm `--head`.
  8. `approvedBy` lấy theo approval token.
- Giữ lại làm giới hạn đã biết:
  - Hash của event buyer khác (`prevHash`) cho phép đoán dữ liệu entropy thấp của buyer đó.
  - Lock event giữ lâu hơn (3 lượt round trip).
  - Chưa có đường xoay khoá (nhưng đã có kid).
  - `/admin/tamper` trả 401 khi thiếu admin key, giống các route admin khác.
  - Đơn HELD hết hạn mà không ai bấm thì vẫn HELD, chưa có biên nhận.

**Kết quả**
- Test 368/368, tsc sạch, check-secrets OK.
- Commit `f968b38`. Deploy phiên bản **`5a8bf688-7202-4695-8d85-13be93e2e8ab`**.
- Trên door thật:
  - Nghiệm thu **55/55** (thêm AC50–AC55), scenarios **11/11**.
  - JWKS, discovery, verify `valid:true` đều đúng.
  - JWS của offer kiểm đúng với JWKS. JWS đã đổi giá bị 422. JWS thật cho ra ACCEPTED, có biên nhận ký.
  - Tamper thì verify chỉ ra seq 1625, và `verify-audit.mjs` cũng báo cùng seq (exit 1).
- Đã reset demo chuẩn (Thứ Sáu 21:10, replay, mandate 500/1.500).

### C8. Merge tab "Inside" của demo và phục vụ ở /demo/ (xong, **chưa push**)
- Đã merge commit demo `fd4408a` vào main (merge `8f4857a`). Commit này thêm tab Inside, hai dòng Compare, chip audit ở Live và `demo/assets/proof/agent-run.mp4`.
- `scripts/build-demo.mjs` publish thêm `inside.mjs`, `inside-view.mjs` và `proof.json`. Video nằm sẵn trong `assets/`, nên đã được publish cùng thư mục.
- `demo/proof.json` đã điền số đo thật, bỏ dấu "pending":
  - Nghiệm thu 55/55 và scenarios 11/11, đo trên `5a8bf688` ngày 14/11.
  - 369 unit test.
  - Thêm trường `measuredOn`; tab Inside hiện chưa hiển thị trường này.
- Commit `1bb6f65`. Deploy phiên bản **`31a7294d-77cb-4c02-ac24-49c3b3bb23a3`**; code của door không đổi so với `5a8bf688`.
- Kiểm live:
  - `/demo/?mode=inside` 200; `inside*.mjs` 200; `proof.json` 200 JSON.
  - `agent-run.mp4` với Range trả 206, `bytes 0-1023/2740023`.
  - Các API mà tab Inside gọi đều 200.
  - `demo/test/` vẫn 404.
- Đã reset demo chuẩn. Đã tắt lại Docker (chỉ bật để chạy test).
- **Quy ước reset chuẩn hiện tại:** Thứ Sáu 21:10, replay `replies_2026-11-16`, mandate 500 € một đơn và 1.500 € một ngày.
- Bổ sung: đã merge thêm commit demo `a4f7e8c` (sửa CSS: mũi tên của flow trong tab Inside nằm trên các thẻ), merge `0f53c3d`.
  Deploy phiên bản **`880c48c0-ab8e-4a31-8426-08e653ab42c7`**. CSS mới đã lên live. `/demo/?mode=inside` 200, `proof.json` 200,
  video với Range trả 206. Test demo 55 pass, 0 fail. Chỉ CSS đổi nên không chạy lại bộ test Worker (Docker vẫn tắt). Đã reset demo chuẩn.

### C9. Try it: bếp sandbox không cần key trên door demo (xong, **chưa push**)
**Route**
- `POST /v1/try` chỉ có khi `DEMO_MODE=1`; nếu không thì trả 404 trước mọi bước validate. Route không cần key.
- Lần gọi đầu mở một bếp sandbox:
  - buyer `visitor-<8 hex>`, mandate của bếp (tự đặt tới 500 € một đơn và 1.500 € một ngày), người duyệt "You (kitchen manager)";
  - trả token `visitor` (24 byte ngẫu nhiên, chỉ lưu sha256).
- Door chạy đúng đường của agent tham chiếu, không có model nào chọn:
  - interpret (Gemini, Gemma đọc lại) → confirm với mặc định của profile → quote → đặt offer 0 kèm JWS.
  - Còn trường nào mở thì trả `needs_input` kèm câu hỏi. Khách trả lời bằng `{visitor, draftId, answer}`.
  - Đơn HELD trả kèm approval token, vì khách là người duyệt của chính bếp sandbox đó.
- `POST /v1/try/decision` duyệt hoặc từ chối qua đường duyệt bình thường, có kiểm lại.
  - Token của buyer khác: 404. Agent key: 403.

**Giới hạn**
- 3 lần/phút cho mỗi địa chỉ (IPv6 tính theo /64).
- 12 lần/phút cho mọi khách gộp lại; chỉ tính những lần sắp gọi model.
- Tối đa 50 sandbox, mỗi địa chỉ tối đa 3. Sandbox để yên 30 phút thì được giải phóng.
- Body tối đa 4 KB.
- Lần gọi đầu bị lỗi thì sandbox của lần đó được giải phóng luôn.

**Thế giới kho riêng**
- Đơn sandbox chỉ tính với đơn sandbox khác, nên khách không bao giờ lấy kho mà hotel-a/hotel-b dùng.
- Tách bằng `sameWorld` trong cả 4 chỗ đọc sổ kho, vẫn trong cùng câu lệnh và lock 1.

**Review độc lập (Opus)**
- Không có lỗ hổng giữa các tenant.
- Đã sửa:
  1. Thế giới kho riêng.
  2. Lần gọi đầu bị lỗi không chiếm slot.
  3. Ngân sách chung chỉ tính lần gọi model.
  4. IPv6 tính theo /64.
  5. Mỗi địa chỉ tối đa 3 sandbox; sandbox để yên 30 phút được giải phóng.
  6. Hỏi tiếp khi vẫn còn trường mở, không rơi vào ngõ cụt 409.
  7. Giới hạn body 4 KB.
  8. Seed mandate trước khi chèn sandbox (an toàn khi reset chen vào).
  9. Discovery và rules chỉ liệt kê Try it trên door demo.
- Giới hạn đã biết:
  - Try it dùng chung quota Gemini/Gemma với hai hotel. Khi Try bận, Gemma có thể `unavailable` cho cả draft của hotel.
  - Gửi lại một câu text là đặt đơn mới.
  - Chữ của khách hiện trên Live ticker (qua textContent, không có XSS).

**Kết quả**
- Test 390/390, tsc sạch, check-secrets OK.
- Đã thêm bảng `try_visitors` lên Aiven trước khi deploy.
- Deploy `eec84341-0152-43f5-bd99-2a080b83ad11`. Nghiệm thu **60/60** (thêm AC56–AC60), scenarios **11/11**.
- Kiểm live:
  - Đơn nhỏ ACCEPTED; câu sữa của chef HELD, khách duyệt thì ACCEPTED; event của sandbox hiện ở log không cần key.
  - Lần gọi thứ 4 trong một phút trả 429 kèm `Retry-After`; text 201 ký tự trả 400.
- `proof.json` cập nhật 60/60, 11/11, 390 test trên `eec84341`; deploy lại assets thành **`bc85188d`**.
- Commit `075f486`, `50a6c67`. Đã reset demo chuẩn.

### C10. Merge bản thiết kế lại của demo (Try it, Inside, Compare) và deploy (xong, **chưa push**)
- Đã merge demo `c13c2ae` (gồm panel Try it `b7a4398`), merge `06fe9b6`. `proof.json` tự merge sạch: giữ số đã xác nhận
  (60/60, 11/11, 390 test, `eec84341`, 14/11) cùng trường `poster` mới. Không còn trường nào `confirmed: false`, nên chip
  "pending final deploy" không còn hiện.
- Số cũ "49 acceptance cases" nằm ở ba chỗ: thẻ kết của Story, footer Compare và dòng connect. Giờ cả ba đọc từ `proof.json`
  qua `data-proof` (giá trị dự phòng 60). Không file đã publish nào còn ghi 49 hay 55.
- `build-demo.mjs` publish thêm `try.mjs` và `try-view.mjs`. Ảnh tĩnh, logo và poster mới nằm sẵn trong `assets/`.
  `dev/`, `test/`, `shots/`, ghi chú và `story.mp4` vẫn 404.
- Test demo 58 pass, 0 fail; tsc sạch; check-secrets OK. Bộ test Worker không chạy lại vì chỉ đổi file demo và Docker đang tắt;
  file đã publish được kiểm live bằng curl.
- Commit `1d1dfbf`. Deploy **`1a601ae5-1fe0-49e9-b2c1-9fa415e808b3`**. Kiểm live:
  - `?mode=inside`, `?mode=compare`, `?mode=live` đều 200.
  - 4 ảnh tĩnh, 3 logo, poster, `try*.mjs` và `proof.json` đều 200. Vài giây đầu sau deploy có hai file trả 404, sau đó 200.
  - `/v1/try` cho ra `decided` / ACCEPTED.
- Đã reset demo chuẩn.

### C11. Sẵn sàng cho nhiều người thử cùng lúc (xong, **chưa push**)

**Reset cho vòng tiếp theo (một dòng, chạy ở thư mục repo):** `node scripts/demo-admin.mjs reset`. Lệnh này đưa door về
trạng thái chuẩn: Thứ Sáu 21:10, replay, mandate 500 €/1.500 €, Try it bật; đồng thời xoá đơn, event và sandbox.
Tắt Try it ngay lập tức: `node scripts/demo-admin.mjs try-off`. Bật lại: `try-on`.

**Thay đổi**
- Try it giới hạn theo token của khách: 3 lần/phút. Theo địa chỉ chỉ còn để chống flood: 60 lần/phút (IPv6 tính theo /64).
  Free text (có gọi model) tối đa 6 lần/phút cho mọi khách gộp lại. Tất cả lời gọi tối đa 240 lần/phút.
- Không bao giờ từ chối khách mới vì hết chỗ. Sandbox để yên 20 phút bị xoá cùng đơn, quote và draft; event vẫn giữ để
  chuỗi hash còn nguyên. Quá 500 sandbox, hoặc quá 200 cho một địa chỉ, thì sandbox ít dùng gần đây nhất bị thu hồi.
- 4 câu ví dụ trên trang dùng bản đọc thật đã ghi sẵn của Gemini và Gemma (`src/try/recorded.ts`), gắn `cached: true`,
  nên không gọi model. Câu "for Friday" vẫn giữ chỗ hai model đọc khác nhau (13/11 và 20/11).
- Gemini hết quota thì trả 503 `MODELS_BUSY` kèm retryAfter và gợi ý dùng câu ví dụ.
- Khách trả lời bằng chữ (`answer: { text }`) thì door đọc lại "<câu đầu>. <câu trả lời>" và gộp vào draft đang chờ.
  Mọi câu hỏi `needs_input` có `question.text`.
- Kill switch `/admin/try`; reset bật lại Try it.
- Event có một "tail" chung cho mỗi isolate (làm mới tối đa mỗi 1,5 s). SSE đọc tail mỗi 2 s.
- Đã merge demo `fc907ef` và `e855ed6`.

**Gói Cloudflare**
- Trước khi Kane nâng cấp, tài khoản đang ở **Workers Free**: tối đa 10 ms CPU cho mỗi request.
  - Bằng chứng: `wrangler tail` ghi nhận 28 request `exceededCpu` ở mức 10–13 ms CPU.
  - Hậu quả: lần chạy nghiệm thu đầu trên `99f64397` chỉ được 32/63; cả 31 ca hỏng đều là 503 do CPU, không phải sai logic.
- Kane đã nâng lên **Workers Paid**. `wrangler.jsonc` giờ đặt `limits.cpu_ms: 30000`; tài khoản Free sẽ từ chối deploy có
  trường này, nên việc deploy được đã chứng minh gói Paid. Settings của script đọc lại đúng giá trị này.
- Sau nâng cấp, tail cho thấy 0 `exceededCpu` trong toàn bộ lần chạy nghiệm thu, scenarios và load test.

**Bảng giới hạn**

| Thứ | Giới hạn | Mình dùng (đo được) | Dư khi 100 người xem + 30 lần thử/phút |
|---|---|---|---|
| Workers Paid: CPU mỗi request | 30 s (tối đa 5 phút) | Try p50 64 ms, max 147 ms; quote ~30 ms | rất dư |
| Workers Paid: request mỗi ngày | không giới hạn | 1 load test ~1k request | rất dư |
| Subrequest mỗi request | 10.000 | vài chục | rất dư |
| Kết nối đồng thời mỗi request | 6 | postgres max 3 | đủ |
| Hyperdrive → Aiven | config 10 (Paid cho tới ~100) | 10 lúc tải | đủ; có thể nâng nếu cần |
| Aiven `max_connections` | 100 (không phải 15) | 12 lúc tải | dư |
| Aiven giao dịch/giây | — | trước: 95 tps với 100 người xem; sau: p50 32, max 42 tps cho cả tải | giảm khoảng 3 lần |
| Gemma | khoảng 4 lần gọi đầy đủ/phút | free text bị giới hạn 6/phút | câu ví dụ không gọi model |
| Gemini | API không cho đọc quota | — | 503 `MODELS_BUSY` khi hết |

**Load test** (`scripts/load-test.mjs`: 100 người xem SSE, 30 lần thử câu ví dụ/phút từ một IP, 5 free text,
20 lần duyệt/từ chối, 3 phút; trên `32795cea`, gói Paid)

| route | n | p50 | p95 | lỗi |
|---|---|---|---|---|
| GET /v1/events (backlog) | 100 | 416 ms | 667 ms | 0 |
| mở GET /v1/events/stream | 300 | 25 ms | 98 ms | 0 |
| POST /v1/try (câu ví dụ) | 90 | 6,0 s | 7,5 s | 0 |
| POST /v1/try (free text) | 4 | 12,6 s | 14,6 s | 0 |
| POST /v1/try/decision | 20 | 2,8 s | 4,0 s | 0 |

**Kiểm**
- Test 406/406. Nghiệm thu **63/63**, scenarios **11/11** trên `32795cea`.
- Ca beans live:
  - "200 cans of beans" → câu hỏi "When should it arrive?";
  - trả lời "next tuesday" → cùng draft, giữ sản phẩm (21594) và 200 pcs, `deliverBy` 2026-11-17;
  - kết quả `no_offer` (54 lời từ chối). Đó là câu trả lời của catalogue cho 200 lon, không phải do mất trí nhớ.
- `proof.json` ghi 63/63, 11/11, 406 trên `32795cea`, ngày 2026-11-15; đã deploy assets thành `e48a8c55`. Đã reset chuẩn.

**Còn lo**
- Một lần Try it mất khoảng 6 s, phần lớn là chờ khoảng 40 lượt đi-về tới Aiven qua Hyperdrive và hai advisory lock, chứ
  không phải CPU. Trang nên hiện tiến trình.
- Gemma chỉ khoảng 4 lần/phút. Khi đông người, draft của hotel cũng có thể chỉ có Gemini đọc (`unavailable`).
- Quota của Gemini chưa rõ (API không cho đọc).

**Sơ suất của mình**
- Trong lúc chẩn đoán 503, mình đã lỡ in ra một lần phản hồi reset, gồm các agent key và approver key demo vừa tạo.
- Mình đã reset ngay để thu hồi chúng. Đó chỉ là key demo tạm, không phải secret của Worker.
