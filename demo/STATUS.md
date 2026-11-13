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
