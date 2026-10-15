---
name: field-list
description: Hợp đồng JSON prompt và fields phẳng cho lượt trích xuất. Nạp trước khi viết path, required hoặc description.
---

# Danh sách field

Trả một JSON object. Không markdown, không hàng rào ```, không JSON Schema, không `responseSchema`.

## Các key

`prompt` là string. Nói loại tài liệu, việc cần làm, quy ước ngày và số, cách xử lý trang không có chữ. Không chép `fields` vào `prompt`. Không bảo model trả về JSON.

Ba field khung trong `default-envelope` có `path`, `type`, `required`, `description`. Không có `items`.

Mọi field dưới `response` có `path`, `required`, `description`. Không có `type`. Không có `items`.

## Độ sâu

Đếm đoạn sau `response`. `data` và `response` không tính. `data.response.invoiceNumber` là 1 cấp. `data.response.a.b.c.d.e` là 5 cấp. Cấp thứ 6 bị cấm.

Một đoạn có `[]` vẫn là một cấp. `data.response.lines[].taxes[].rate` là 3 cấp.

## path

Ngăn bằng dấu chấm. Mỗi path xuất hiện một lần. Ký tự của mỗi đoạn là chữ, số và `_`, cộng `[]` khi đoạn đó là mảng.

Mỗi đoạn có tối đa một `[]`. Một path được nhiều `[]`. Không có `[]` là một nhóm. Có `[]` là một mảng. Rule này không chọn kiểu dữ liệu của năm cấp.

Prefix phải được khai báo. `data.response.buyer.name` đòi field `data.response.buyer`. `data.response.lines[].taxes[].rate` đòi field `data.response.lines[]` và `data.response.lines[].taxes[]`.

Không khai báo một path vừa có `[]` vừa không có `[]`.

## required

`true` khi thiếu field thì kết quả không dùng được. `false` khi tài liệu được phép không có field.

## description

Một câu. Nói vị trí của giá trị trong tài liệu.

Không ghi regex, độ dài, cận số, danh sách giá trị cho phép, hoặc bản sao của `path`. Quy ước ngày, đơn vị tiền và cách làm tròn nằm trong `prompt`.

## Key cấm

Không có `properties`, `$ref`, `$defs`, `$schema`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `format`, `additionalProperties`, `nullable`, `anyOf`, `oneOf`, `const`, `enum`.
