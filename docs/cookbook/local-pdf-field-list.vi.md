# Danh sách field từ PDF local

[English](local-pdf-field-list.md) | [中文](local-pdf-field-list.zh.md) | Tiếng Việt

Một lượt đọc một PDF khoảng 10 đến 30 trang, cùng các file rule và skill. Model local sau đó trả về `{prompt, fields}`. Chương trình bên ngoài phiên biên dịch `fields` thành `responseSchema` của Vertex và gọi `gemini-3.1-pro-preview`. Phiên không gọi Vertex.

## 1. Nạp rule và skill

Model local đọc bốn file này trước khi chọn field. [plan-from-pdf](../../workspace/local-extract/skills/plan-from-pdf.md) là quy trình. Skill đó yêu cầu nạp [field-list](../../workspace/local-extract/rules/field-list.md), [default-envelope](../../workspace/local-extract/rules/default-envelope.md) và [vertex-schema-limits](../../workspace/local-extract/rules/vertex-schema-limits.md).

Trỏ `customSkillDirs` của `@deepseek-ai/dsh-skill-filesystem` vào hai thư mục dưới đây, bằng đường dẫn tuyệt đối. Field này nằm trong [README của skill filesystem](../../packages/skill/skill-filesystem/README.md).

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - <repo>/workspace/local-extract/rules
      - <repo>/workspace/local-extract/skills
```

Thay `<repo>` bằng đường dẫn tuyệt đối của repo này. Một tên xuất hiện trong catalog khi file là con trực tiếp của một trong hai thư mục và frontmatter `name` cùng `description` hợp lệ. Tin nhắn người dùng tiêm quy trình bằng `/plan-from-pdf`.

## 2. Gửi text PDF và rule nghiệp vụ

Trích lớp text trước lượt này và gửi text đó cùng rule nghiệp vụ. Lớp text của 10 đến 30 trang vừa cửa sổ đã cấu hình khoảng 128k. Ảnh trang tiêu cửa sổ đó vào pixel.

Rule nghiệp vụ nêu tên các field bên trong `data.response`. PDF cho biết file này có các field đó hay không và chúng nằm ở đâu. Ba field khung trong [default-envelope](../../workspace/local-extract/rules/default-envelope.md) là cố định và không lấy từ PDF.

## 3. Đọc các trang mà skill chỉ định

Khi phiên có `list_pages` và `read_pages`, đọc trang đầu, các trang có bảng, và các trang có tiêu đề khớp rule nghiệp vụ. Trang đã có text trong context thì không đọc lại.

Khi không có các tool đó, dùng text PDF đã nằm trong tin nhắn. Chỉ gọi tên tool có trong phiên. Không gọi Vertex.

## 4. Nộp một JSON object

Model đối chiếu bản nháp với ba rule, rồi nộp một lần. Object là `{prompt, fields}` theo [field-list](../../workspace/local-extract/rules/field-list.md). Tin nhắn chỉ chứa object đó.

`fields` bắt đầu bằng `responseCode`, `responseDesc` và `ocrRate`. Mọi path của field tài liệu bắt đầu bằng `data.response.`. `prompt` nói nhiệm vụ và quy ước cách viết. Danh sách field nằm trong `fields`.

## 5. Biên dịch schema ngoài phiên

Chương trình bên ngoài dựng `responseSchema` từ `fields` và gọi `gemini-3.1-pro-preview` với PDF đầy đủ và `prompt`. Regex, độ dài chuỗi và cận số ở ngoài `fields`. Chương trình đó kiểm tra chúng sau khi sinh.

## 6. Tách khi bị từ chối chung

Khi Vertex trả `Request contains an invalid argument.`, chương trình bên ngoài tách field tài liệu theo đoạn path đầu tiên và gộp các object trả về. Mã trạng thái đó ở ngoài phiên local.
