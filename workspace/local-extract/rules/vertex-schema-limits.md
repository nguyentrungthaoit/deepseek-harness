---
name: vertex-schema-limits
description: Cách giữ danh sách field đủ nhỏ cho responseSchema của gemini-3.1-pro-preview. Nạp cùng field-list trước khi nộp fields.
---

# Giới hạn schema

Phiên này không gọi Vertex và không nhận mã 400. Viết `fields` đủ nhỏ ngay từ đầu. Chương trình ngoài phiên dịch `fields` thành `responseSchema`.

Schema hợp lệ vẫn bị từ chối khi có tên dài, description dài, nhiều field optional, enum nhiều giá trị, mảng object lồng mảng object, cận số, hoặc `format` kiểu ngày. Không đưa các thứ đó vào `fields`.

Giữ một tầng mảng object, ví dụ `data.response.lines[].amount`. Không dùng path có hai `[]`, ví dụ `data.response.lines[].taxes[].rate`. Phần lặp thứ hai là một mảng cùng cấp, ví dụ `data.response.taxes[].amount`.

`path` ngắn. Bỏ field chỉ để chú thích, số trang, hoặc độ tin cậy, trừ khi rule nghiệp vụ bắt buộc giữ field đó.

Không thêm field mà rule nghiệp vụ không nêu. Rule bảo lấy mọi cột của một bảng thì mỗi cột là một field con của mảng đó.
