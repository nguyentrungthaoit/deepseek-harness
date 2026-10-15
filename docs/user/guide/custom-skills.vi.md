# Cấu hình custom skill

## Tóm tắt

Custom skill là file hướng dẫn nằm trên đĩa. Bạn trỏ `customSkillDirs` của `@deepseek-ai/dsh-skill-filesystem` vào thư mục chứa chúng. Preset web `standard`, `ptc` và `cordis` đã có plugin này và tool `skill`. Preset `minimal` không có, nên không nạp skill.

## Skill hợp lệ

Mỗi skill là một file `<tên>.md` ngay trong thư mục gốc, hoặc một thư mục `<tên>/SKILL.md`. File nằm sâu hơn không được nhận. File bắt đầu bằng frontmatter YAML. `name` và `description` là bắt buộc.

```yaml
---
name: plan-from-pdf
description: Lập prompt và danh sách field từ PDF và rule nghiệp vụ.
---
```

`name` là tên gọi trong hội thoại. Thiếu frontmatter hoặc `name` sai thì skill bị bỏ qua kèm cảnh báo. Model không thấy lý do nó vắng mặt.

## Gắn thư mục

Đường dẫn phải là đường dẫn tuyệt đối mà process `dsh` đọc được. Với bản Docker, đó là đường dẫn trong container, không phải ổ `D:` của Windows.

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - /opt/local-extract/rules
      - /opt/local-extract/skills
```

Các thư mục này đứng sau skill của project (`.dsh/skills`, `.agents/skills`) và trước skill của người dùng. Sửa file skill không cần khởi động lại server. Thêm hoặc xóa file cũng vậy, vì thư mục đang được theo dõi.

Trang cài đặt Agent presets lưu đè hàng plugin theo `id` vào `$DSH_HOME/profiles/web/cordis.patch.yml`. Trên Docker, `$DSH_HOME` là `/data/dsh`.

## Bản Docker công ty

Image không chứa `workspace/local-extract`. Mount thư mục đó vào container, rồi dùng đường dẫn mount trong `customSkillDirs`.

```sh
-v d:/Workspaces/AI/deepseek-harness/deepseek-harness/workspace/local-extract:/opt/local-extract:ro
```

Đổi mount thì tạo lại container. Volume `dsh-home` giữ file profile, nên cấu hình `customSkillDirs` còn sau khi tạo lại.

## Gọi skill

Trong ô nhập, gõ `/` cộng `name` trong frontmatter, ví dụ `/plan-from-pdf`. Model cũng có thể tự nạp skill bằng tool `skill` khi skill có trong catalog.

Lần lập field đầu nạp `/field-list`, `/default-envelope` và `/vertex-schema-limits`. `/flatten-on-gemini-error` chỉ dùng sau khi một lần gọi Gemini thực tế trả lỗi schema.

## Đọc thêm

- [Đọc file Word, PDF và Excel](./read-document.vi.md) — tool `read_document` trên web. Image `0.2.1-alpha.4` có package này; preset web chưa gắn sẵn, thêm dòng plugin trong hướng dẫn đó.
- [Hợp đồng skill filesystem](../../../packages/skill/skill-filesystem/README.md) — thứ tự thư mục và các field cấu hình.
