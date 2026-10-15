# Đọc file Word, PDF và Excel

[English](read-document.md) | [中文](read-document.zh.md) | Tiếng Việt

## Tóm tắt

Nhờ model đọc chữ và bảng từ file Word, PDF hoặc Excel trong workspace, hoặc từ file bạn đính kèm ở ô nhập. Model dùng `read_document`. Công cụ chữ `read` từ chối các file này vì chúng là file nhị phân.

## Mục lục

- [Nhờ model đọc file](#ask-the-model)
- [File nào dùng được](#which-files)
- [Gắn tool](#mount-the-tool)
- [Giới hạn và lỗi](#limits-and-failures)
- [Đọc thêm](#further-exploration)

<a id="ask-the-model"></a>
## Nhờ model đọc file

Đặt file vào workspace đang chọn, hoặc đính kèm ở ô nhập. File đính kèm được lưu nguyên và model nhận một đường dẫn chỉ đọc. Nói nội dung cần đọc bằng lời thường.

Ví dụ: "Read report.docx and summarize the table in the first section."

Model gọi `read_document` với đường dẫn đó. Khi xong, hội thoại hiện một hàng tool tên `read_document`. Kết quả là chữ có số dòng. Đoạn và bảng Word thành từng dòng, ô trong bảng cách nhau bằng tab. Mỗi sheet Excel có một dòng tiêu đề, rồi các dòng cách nhau bằng tab. Chữ PDF có mốc cho từng trang có chữ.

File dài trả về một cửa sổ. Bảo model đọc tiếp, nó gọi `read_document` lần nữa với `offset` lớn hơn.

<a id="which-files"></a>
## File nào dùng được

Các đuôi này dùng được:

- `.docx` — đoạn văn và bảng.
- `.pdf` — lớp chữ. Trang scan không có chữ trả về một thông báo và không có chữ của trang đó.
- `.xlsx` — tên sheet và chữ trong ô. Ô công thức trả giá đã lưu trong file, hoặc chuỗi công thức khi file không lưu giá.

Các đuôi này không dùng được: `.doc`, `.xls`, `.ppt`, `.pptx`, và file chữ thường. File chữ vẫn dùng `read`.

<a id="mount-the-tool"></a>
## Gắn tool

Các preset Web đang phát hành chưa có tool này. Thêm một hàng vào preset mà phiên đang dùng. `standard`, `ptc` và `cordis` là các preset đã có tool file. `minimal` thì không.

```yaml
- id: tool-document
  name: '@deepseek-ai/dsh-tool-document'
```

Đặt hàng này cạnh `tool-fs`. Package đã có mọi giới hạn, nên `config` có thể bỏ. Profile Desktop và SDK không có hàng này.

<a id="limits-and-failures"></a>
## Giới hạn và lỗi

File lớn hơn 32 MiB thì lỗi và không bị cắt cụt. Gói Word hoặc Excel có hơn 2000 mục ZIP, hoặc kích thước khai báo khi giải nén hơn 32 MiB, thì lỗi trước khi đọc nội dung. Một lần đọc PDF dừng sau 50 trang. Một lần gọi trả tối đa 2000 dòng và 50 KiB của các dòng đó. Excel dừng sau 32 sheet và 5000 dòng dữ liệu mỗi sheet. Lần gọi chạy quá 30 giây thì bị dừng.

Không có sandbox thì lần gọi lỗi. Việc đọc không chạy tiếp trong process của máy chủ Web. File hỏng hoặc có mật khẩu làm lần gọi lỗi. PDF không có lớp chữ thì lần gọi thành công và báo model là không có chữ để đọc.

<a id="further-exploration"></a>
## Đọc thêm

- [Hợp đồng package](../../../packages/document/tool-document/README.md) — các field cấu hình và kết quả model nhận.
- [Dùng Web UI](./index.md) — khởi động máy chủ và chọn workspace.
- [Cấu hình custom skill](./custom-skills.vi.md) — gắn thư mục skill trên máy local và Docker.
