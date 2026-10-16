# Cấu hình custom skill

## Làm theo 4 bước

1. Trên Web, chọn project sẽ dùng skill. Mở một hội thoại mới. Chế độ là Standard, PTC hoặc Creator.
2. Mở tab Rules and skills ở sidebar bên phải. Tạo skill: tên dạng kebab-case, một description, và nội dung markdown.
3. Bấm Use in chat. Ô nhập nhận `/field-list ` gồm dấu `/`, tên, và một khoảng trắng ở cuối.
4. Gửi tin nhắn.

Xong khi câu trả lời nói về danh sách field. Chưa xong khi model hỏi skill này là gì, hoặc coi `/field-list` như một câu chat.

`docker-compose.yml` giữ nguyên. Project đã vào container qua `DSH_WORKSPACE` trong `docker/compose.env`. Web hiện project đó dưới `/workspace`.

## Nếu gõ `/` mà không thấy tên

- Đầu file có `name: field-list` và `description`.
- Hội thoại đang mở đúng project. Tab Rules and skills liệt kê skill của project đó.
- Skill tạo từ panel là một file phẳng `<name>.md` trong `.agents/skills`.

Năm tên cần thấy: `field-list`, `default-envelope`, `vertex-schema-limits`, `plan-from-pdf`, `flatten-on-gemini-error`.

`/plan-from-pdf` dùng khi đã có PDF và rule nghiệp vụ. `/flatten-on-gemini-error` chỉ gửi sau khi Gemini báo lỗi schema.

## Dùng cho mọi project

Mỗi project giữ `.agents/skills` của chính nó. Mở từng project và tạo skill trên tab Rules and skills của project đó. Skill chỉ đọc hiện nguồn và chỉ có Use in chat.

## Đầu file skill

```yaml
---
name: field-list
description: Hợp đồng danh sách field cho lần lập schema.
---
```

`name` là chữ đứng sau dấu `/`. Thiếu `name` hoặc `description` thì tên đó không hiện.

## Đọc thêm

- [Đọc file Word, PDF và Excel](./read-document.vi.md) — kiểm tra `read_document` đã có trong phiên chưa.
- [Hợp đồng skill filesystem](../../../packages/skill/skill-filesystem/README.md) — thứ tự thư mục và các field cấu hình.
