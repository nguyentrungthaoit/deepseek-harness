---
name: vertex-schema-limits
description: Cách giữ danh sách field đủ nhỏ cho responseSchema của gemini-3.1-pro-preview. Nạp cùng field-list trước khi nộp fields.
---

# Giới hạn schema

Phiên này không gọi Vertex và không nhận mã 400. Viết `fields` đủ nhỏ ngay từ đầu. Chương trình ngoài phiên dịch `fields` thành `responseSchema`.

Schema hợp lệ vẫn bị từ chối khi có tên dài, description dài, nhiều field optional, enum nhiều giá trị, cận số, hoặc `format` kiểu ngày. Không đưa các thứ đó vào `fields`.

Dưới `response` được lồng tối đa 5 cấp. Mảng được nằm trong mảng, ví dụ `data.response.lines[].taxes[].rate`. Cấp thứ 6 bị cấm.

Khi Gemini thực tế trả lỗi schema, làm theo `flatten-on-gemini-error`. Mỗi lần bỏ một nhóm hoặc lùi một mảng một cấp. Lỗi tiếp theo mới lùi mảng đó thêm một cấp. Tên mới có prefix camelCase của node cha và giữ `[]`.

`path` ngắn. Bỏ field chỉ để chú thích, số trang, hoặc độ tin cậy, trừ khi rule nghiệp vụ bắt buộc giữ field đó.

Không thêm field mà rule nghiệp vụ không nêu. Rule bảo lấy mọi cột của một bảng thì mỗi cột là một field con của mảng đó.
