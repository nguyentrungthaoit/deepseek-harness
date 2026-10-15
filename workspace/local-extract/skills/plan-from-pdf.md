---
name: plan-from-pdf
description: Lập prompt và danh sách field phẳng từ một PDF khoảng 10 đến 30 trang cộng rule nghiệp vụ. Nạp skill này trước khi chọn field. Kết quả là một JSON theo field-list và default-envelope.
---

# Lập kế hoạch trích xuất

Nạp `field-list`, `default-envelope` và `vertex-schema-limits` trước khi viết field. Ba file đó là hợp đồng của lần nộp đầu. Skill này chỉ nói thứ tự làm. `flatten-on-gemini-error` chỉ nạp sau khi một lần gọi Gemini thực tế trả lỗi schema.

## Đọc tài liệu

Dùng tool trang khi phiên có `list_pages` và `read_pages`. Đọc trang đầu, trang có bảng, và trang mà tiêu đề khớp field trong rule nghiệp vụ. Không đọc lại trang đã có trong context.

Không có các tool đó thì dùng phần PDF đã nằm trong hội thoại. Không gọi tên tool không có trong phiên. Không gọi Vertex.

## Chọn field

Lấy ba field khung từ `default-envelope`.

Field trong `data.response` chỉ gồm field mà rule nghiệp vụ nêu. PDF cho biết giá trị nằm ở đâu.

Rule đánh field là bắt buộc thì khai báo `required: true` dù các trang đã đọc không chứa giá trị. `description` nói vị trí thường gặp.

Rule đánh field là tùy chọn mà các trang đã đọc không chứa giá trị thì bỏ field đó.

Một bảng là path có `[]`, mỗi cột là một field con. Một nhóm không lặp là path không có `[]`. Lồng tối đa 5 cấp sau `response`. Không ghi `type` cho các cấp đó.

## Nộp

Đối chiếu bản nháp với cả ba rule. Sửa mọi chỗ lệch trước khi nộp.

Nộp một lần, đúng một JSON object của `field-list`. Không thêm lời dẫn.

## Khi Gemini lỗi

Khi một lần gọi Gemini thực tế trả lỗi schema, nạp `flatten-on-gemini-error`. Mỗi lần chỉ đổi một cấp. Hết nhóm thì lùi mảng sâu nhất một cấp, lần lỗi sau lùi thêm một cấp. Tên node được đưa lên có prefix tên node cha theo camelCase. Giữ `[]`. Nộp lại `fields`.
