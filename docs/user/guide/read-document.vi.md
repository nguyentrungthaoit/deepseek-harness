# Đọc file Word, PDF và Excel

[English](read-document.md) | [中文](read-document.zh.md) | Tiếng Việt

## Kiểm tra tool đã có chưa

1. Mở Web. Vào **Settings → Agent presets**.
2. Chọn preset đang dùng, thường là Standard. Bấm **View configuration**.
3. Tìm chữ `tool-document`.

Có chữ đó thì tool đã gắn. Mở hội thoại mới, đưa một file `.docx` vào workspace, nhắn "Đọc file này". Hội thoại phải có một hàng tên `read_document` và có đoạn chữ đọc được.

Không thấy `tool-document` thì phiên chưa có tool. Làm mục dưới.

## Gắn tool

Tag image nằm ở `DSH_IMAGE_TAG` trong `docker/compose.env`. Giá trị cần là `0.2.1-alpha.4`. Tag cũ hơn không chứa package, nên gắn plugin cũng không gọi được.

Trong container, file preset là `/data/dsh/profiles/web/cordis.patch.yml`. Volume `dsh-home` giữ file này. Trong danh sách plugin của preset `standard`, `ptc` hoặc `cordis`, thêm hàng sau cạnh `tool-fs`:

```yaml
- id: tool-document
  name: '@deepseek-ai/dsh-tool-document'
```

Giữ các hàng plugin khác của preset. Lưu file, mở hội thoại mới, rồi làm lại bước tìm `tool-document`.

Preset Minimal không có tool file. Desktop và SDK không có hàng này.

## Nhờ model đọc

Đặt file vào workspace, hoặc đính kèm ở ô nhập. Nói việc cần làm bằng lời thường, ví dụ "Đọc report.docx và tóm tắt bảng đầu".

Kết quả là chữ có số dòng. Bảng Word và ô Excel cách nhau bằng tab. Mỗi sheet Excel có một dòng tiêu đề. PDF có mốc từng trang còn chữ. File dài thì bảo model đọc tiếp.

Đuôi dùng được: `.docx`, `.pdf` có lớp chữ, `.xlsx`. PDF scan không có chữ thì lần gọi vẫn xong và báo không có chữ. Đuôi `.doc`, `.xls`, `.ppt`, `.pptx` không dùng tool này. File chữ thường vẫn dùng `read`.

Một lần gọi nhận file tối đa 32 MiB, PDF tối đa 50 trang, và dừng sau 30 giây. File hỏng hoặc có mật khẩu thì lần gọi lỗi.

## Đọc thêm

- [Hợp đồng package](../../../packages/document/tool-document/README.md) — các field cấu hình và kết quả model nhận.
- [Cấu hình custom skill](./custom-skills.vi.md) — đặt file skill và thử bằng `/field-list`.
