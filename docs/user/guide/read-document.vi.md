# Đọc file Word, PDF và Excel

[English](read-document.md) | [中文](read-document.zh.md) | Tiếng Việt

## Kiểm tra tool đã có chưa

1. Mở Web. Vào **Settings → Agent presets**.
2. Chọn preset đang dùng, thường là Standard. Bấm **View configuration**.
3. Tìm chữ `tool-document`.

Có chữ đó thì tool đã gắn. Mở hội thoại mới, đưa một file `.docx` vào workspace, nhắn "Đọc file này". Hội thoại phải có một hàng tên `read_document` và có đoạn chữ đọc được.

Không thấy `tool-document` thì phiên chưa có tool. Đọc mục "Chưa có tool".

## Chưa có tool

Preset Standard, PTC và Cordis đã có `read_document`. Preset Minimal không có.

Trong Docker, preset gốc có tool từ image `0.2.1-alpha.6`. Tag nằm ở `DSH_IMAGE_TAG` trong `docker/compose.env`. Image `0.2.1-alpha.4` và `0.2.1-alpha.5` có package nhưng preset gốc không có tool; chỉ hàng thêm tay theo guide cũ mới bật được. Image trước `0.2.1-alpha.4` không chứa package, nên không cấu hình nào thêm được tool.

Desktop và SDK không có tool này.

## Đã thêm hàng theo guide cũ

Guide cũ bảo thêm khối `tool-document` vào `/data/dsh/profiles/web/cordis.patch.yml`. Khối đó thay cả danh sách plugin của preset, nên preset gốc mới không tới máy bạn. Tool vẫn chạy. Chọn một:

1. Giữ khối. Không đổi gì, nhưng không nhận thay đổi preset sau này.
2. Xóa đúng khối đã thêm, rồi khởi động lại container để dùng preset gốc. Chỉnh sửa khác trong cùng khối cũng mất. Chỉ làm vậy với image `0.2.1-alpha.6` trở lên. Trên `0.2.1-alpha.4` và `0.2.1-alpha.5`, preset gốc không có tool, nên xóa khối là mất tool.

## Nhờ model đọc

Đặt file vào workspace, hoặc đính kèm ở ô nhập. Nói việc cần làm bằng lời thường, ví dụ "Đọc report.docx và tóm tắt bảng đầu".

Kết quả là chữ có số dòng. Bảng Word và ô Excel cách nhau bằng tab. Mỗi sheet Excel có một dòng tiêu đề. PDF có mốc từng trang còn chữ. File dài thì bảo model đọc tiếp.

Đuôi dùng được: `.docx`, `.pdf` có lớp chữ, `.xlsx`. PDF scan không có chữ thì lần gọi vẫn xong và báo không có chữ. Đuôi `.doc`, `.xls`, `.ppt`, `.pptx` không dùng tool này. File chữ thường vẫn dùng `read`.

## Trần và lỗi

Một lần gọi nhận file tối đa 32 MiB và dừng sau 30 giây. Thời gian chờ lượt không tính.

Đọc dừng ở trần: 50 trang PDF, 32 sheet, 5000 dòng có dữ liệu mỗi sheet (tính cả hàng tiêu đề cột), hoặc 1.000.000 ký tự. Kết quả đánh dấu bị cắt và có thông báo, ví dụ `Extraction stopped at maxPages (50 of 212 pages).` Phần đã đọc vẫn được trả.

Cùng lúc đọc tối đa 2 file, 8 file khác được chờ. Quá số đó thì lỗi `read_document is busy; retry after the running reads finish`. Đợi lượt đang chạy xong rồi thử lại.

File quá nặng thì lỗi `read_document ran out of memory; the file is too large to extract`.

Máy không có sandbox thì lỗi `read_document cannot run because no sandbox is available on this host; do not retry`. Đừng thử lại.

File hỏng hoặc có mật khẩu thì lần gọi lỗi.

## Đọc thêm

- [Hợp đồng package](../../../packages/document/tool-document/README.md) — các field cấu hình và kết quả model nhận.
- [Cấu hình custom skill](./custom-skills.vi.md) — đặt file skill và thử bằng `/field-list`.
