---
name: field-list
description: Hợp đồng JSON prompt và fields phẳng cho lượt trích xuất. Nạp trước khi viết path, type, items hoặc description.
---

# Danh sách field

Trả một JSON object. Không markdown, không hàng rào ```, không JSON Schema, không `responseSchema`.

## Các key

`prompt` là string. Nói loại tài liệu, việc cần làm, quy ước ngày và số, cách xử lý trang không có chữ. Không chép `fields` vào `prompt`. Không bảo model trả về JSON.

`fields` là mảng. Mỗi phần tử có `path`, `type`, `required`, `description`. Field `array` thêm `items`. Field khác không có `items`.

## type

`type` là một trong `string`, `integer`, `number`, `boolean`, `array`, `object`.

`items` của `array` là một trong `string`, `integer`, `number`, `boolean`, `object`.

`array` và `items` scalar không có field con. Path không chứa `[]`.

`array` và `items: "object"` có ít nhất một field con. Path của field `array` không chứa `[]`. Path con là `path[].ten`.

`object` không có `items` và có ít nhất một field con. Path không kết thúc bằng `[]`. Path con là `path.ten`. Object nằm trong một mảng thì path chứa đúng `[]` của mảng đó, ví dụ `lines[].buyer` và `lines[].buyer.name`.

Mỗi path chứa tối đa một `[]`.

Một giá trị liệt kê dùng `string`. Nhiều giá trị scalar dùng `array` với `items` đúng kiểu. Nhiều object dùng `array` với `items: "object"`. Một nhóm không lặp dùng `object`.

## path

Ngăn bằng dấu chấm. Mỗi path xuất hiện một lần. Ký tự của mỗi đoạn là chữ, số và `_`.

Prefix phải được khai báo. `buyer.name` đòi field `buyer` kiểu `object`. `lines[].amount` đòi field `lines` kiểu `array`, `items: "object"`.

Không dùng một path vừa là scalar vừa là object hoặc array.

## required

`true` khi thiếu field thì kết quả không dùng được. `false` khi tài liệu được phép không có field.

## description

Một câu. Nói vị trí của giá trị trong tài liệu.

Không ghi regex, độ dài, cận số, danh sách giá trị cho phép, hoặc bản sao của `path`. Quy ước ngày, đơn vị tiền và cách làm tròn nằm trong `prompt`.

## Key cấm

Không có `properties`, `$ref`, `$defs`, `$schema`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `format`, `additionalProperties`, `nullable`, `anyOf`, `oneOf`, `const`, `enum`.
