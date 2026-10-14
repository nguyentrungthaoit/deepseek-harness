# Danh sách field từ PDF local

[English](local-pdf-field-list.md) | [中文](local-pdf-field-list.zh.md) | Tiếng Việt

Model local lập một lần trích xuất và trả về `{prompt, fields}`. Chương trình bên ngoài phiên biên dịch `fields` thành `responseSchema` của Vertex và gọi `gemini-3.1-pro-preview`. Phiên không gọi Vertex.

Bốn file bên dưới giữ hợp đồng field. Trang này nói cách một phiên nạp chúng, và cách việc đó nằm trong cửa sổ context của model local.

## Các file

| File | Tên trong catalog | Việc nó giữ |
|---|---|---|
| [field-list](../../workspace/local-extract/rules/field-list.md) | `field-list` | JSON, kiểu, path, và các key cấm |
| [default-envelope](../../workspace/local-extract/rules/default-envelope.md) | `default-envelope` | `responseCode`, `responseDesc`, `ocrRate`, và tiền tố `data.response.` |
| [vertex-schema-limits](../../workspace/local-extract/rules/vertex-schema-limits.md) | `vertex-schema-limits` | Cách giữ schema sau khi biên dịch đủ nhỏ để nộp |
| [plan-from-pdf](../../workspace/local-extract/skills/plan-from-pdf.md) | `plan-from-pdf` | Đọc trang nào, giữ field nào, và lần nộp duy nhất |

## Đăng ký hai thư mục gốc

Cơ chế phát hiện nhận file `<name>.md` ngay ở tầng trên của một thư mục được quét. Nó bỏ qua `SKILL.md` nằm trong thư mục con. `workspace/local-extract/rules` và `workspace/local-extract/skills` tách khỏi hai gốc mặc định `.dsh/skills` và `.agents/skills`.

Đặt `customSkillDirs` trên plugin `@deepseek-ai/dsh-skill-filesystem`. Provider đưa mỗi mục vào `path.resolve`, nên dùng đường dẫn tuyệt đối. Field này nằm trong [README của skill filesystem](../../packages/skill/skill-filesystem/README.md).

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - <repo>/workspace/local-extract/rules
      - <repo>/workspace/local-extract/skills
```

Thay `<repo>` bằng đường dẫn tuyệt đối của repo này. Một mục catalog xuất hiện khi frontmatter `name` là kebab-case và có `description`. Bốn file này dùng tên file, không có đuôi, làm `name`.

## Model nhận được gì

Khi có skill mà model được gọi và tool `skill` đang hiện, phiên liệt kê từng `name` và `description` trước request đầu tiên. Model nạp skill đã liệt kê bằng tool `skill` và nhận nội dung file hiện tại. Tin nhắn người dùng tiêm một skill bằng `/plan-from-pdf`.

`catalogDescriptionMaxLength` trên `@deepseek-ai/dsh-tool-skill` mặc định là 500. Bốn description này nằm trong mức đó. Danh sách giữ ngắn. Phần thân của một skill chỉ được nạp khi model yêu cầu skill đó.

## Một lượt local

Trích text của PDF trước phiên và gửi text đó. Lớp text của 10 đến 30 trang vừa cửa sổ đã cấu hình khoảng 128k. Ảnh trang tiêu cửa sổ đó vào pixel.

Tin nhắn người dùng gồm rule nghiệp vụ, text các trang, và lệnh nạp `plan-from-pdf` rồi làm theo. Bốn file ở trên đĩa. Model nạp `plan-from-pdf`, rồi `field-list`, `default-envelope`, và `vertex-schema-limits`, nộp một JSON object, rồi dừng.

Model local không gọi Vertex và không có mã trạng thái để đọc. Regex, độ dài chuỗi và cận số ở ngoài `fields`. Chương trình bên ngoài kiểm tra chúng sau khi sinh.

## Sau JSON

Chương trình bên ngoài dựng `responseSchema` từ `fields` và gọi `gemini-3.1-pro-preview` với PDF và `prompt`. `prompt` nói nhiệm vụ và quy ước cách viết. Danh sách field nằm trong schema.

Khi Vertex trả `Request contains an invalid argument.`, chương trình bên ngoài tách field tài liệu theo đoạn path đầu tiên và gộp các object trả về. Mã trạng thái đó ở ngoài phiên local.

## Khi thiếu một tên

Một tên vắng trong catalog nghĩa là file không phải con trực tiếp của một gốc đã cấu hình, hoặc frontmatter `name` hay `description` bị từ chối. Sửa đường dẫn hoặc frontmatter. Provider theo dõi các gốc, nên sửa frontmatter tới catalog kế tiếp mà không cần khởi động lại tiến trình.
