---
name: plan-from-pdf
description: Lập prompt và danh sách field phẳng từ một PDF khoảng 10 đến 30 trang cộng rule nghiệp vụ. Nạp skill này trước khi chọn field. Kết quả là một JSON theo field-list và default-envelope.
---

# Lập kế hoạch trích xuất

Nạp `field-list`, `default-envelope` và `vertex-schema-limits` trước khi viết field. Ba file đó là hợp đồng. Skill này chỉ nói thứ tự làm.

## Đọc tài liệu

Dùng tool trang khi phiên có `list_pages` và `read_pages`. Đọc trang đầu, trang có bảng, và trang mà tiêu đề khớp field trong rule nghiệp vụ. Không đọc lại trang đã có trong context.

Không có các tool đó thì dùng phần PDF đã nằm trong hội thoại. Không gọi tên tool không có trong phiên. Không gọi Vertex.

## Chọn field

Lấy ba field khung từ `default-envelope`.

Field trong `data.response` chỉ gồm field mà rule nghiệp vụ nêu. PDF cho biết giá trị nằm ở đâu.

Rule đánh field là bắt buộc thì khai báo `required: true` dù các trang đã đọc không chứa giá trị. `description` nói vị trí thường gặp.

Rule đánh field là tùy chọn mà các trang đã đọc không chứa giá trị thì bỏ field đó.

Một bảng là `type: "array"`, `items: "object"`, mỗi cột là một field con. Một nhóm không lặp là `type: "object"`.

## Nộp

Đối chiếu bản nháp với cả ba rule. Sửa mọi chỗ lệch trước khi nộp.

Nộp một lần, đúng một JSON object của `field-list`. Không thêm lời dẫn.
