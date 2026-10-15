# Cấu hình custom skill

## Làm theo 4 bước

1. Trên máy Windows, vào project sẽ mở trên Web. Tạo thư mục `.agents/skills` ngay trong project. Ví dụ project là `D:/Workspaces/my-app` thì thư mục là `D:/Workspaces/my-app/.agents/skills`.
2. Copy mọi file `.md` từ `workspace/local-extract/rules` và `workspace/local-extract/skills` vào thư mục vừa tạo. Mỗi file nằm thẳng trong `.agents/skills`, ví dụ `field-list.md`. Đừng để chúng trong thư mục con.
3. Trên Web, chọn đúng project đó. Mở một hội thoại mới. Chế độ là Standard, PTC hoặc Creator.
4. Trong ô nhập gõ `/field-list` rồi gửi.

Xong khi câu trả lời nói về danh sách field. Chưa xong khi model hỏi skill này là gì, hoặc coi `/field-list` như một câu chat.

`docker-compose.yml` giữ nguyên. Project đã vào container qua `DSH_WORKSPACE` trong `docker/compose.env`. Web hiện project đó dưới `/workspace`.

## Nếu gõ `/` mà không thấy tên

- Tên file là `field-list.md`, và dòng `name: field-list` nằm ở đầu file.
- File không nằm trong `rules` hay `skills` bên trong `.agents/skills`.
- Hội thoại mới mở sau khi copy, và thanh workspace đang chỉ đúng project.

Năm tên cần thấy: `field-list`, `default-envelope`, `vertex-schema-limits`, `plan-from-pdf`, `flatten-on-gemini-error`.

`/plan-from-pdf` dùng khi đã có PDF và rule nghiệp vụ. `/flatten-on-gemini-error` chỉ gửi sau khi Gemini báo lỗi schema.

## Dùng cho mọi project

Copy các file `.md` vào volume mà mọi hội thoại đều đọc. Container tên `dsh` phải đang chạy. Ở thư mục repo trên Windows:

```sh
docker cp workspace/local-extract/rules/. dsh:/data/dsh/skills/
docker cp workspace/local-extract/skills/. dsh:/data/dsh/skills/
```

Mở hội thoại mới và gửi `/field-list`. `/data/dsh` là volume `dsh-home` trong `docker-compose.yml`.

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
