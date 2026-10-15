---
name: default-envelope
description: Ba field cố định responseCode, responseDesc, ocrRate và tiền tố data.response cho nội dung OCR. Nạp cùng field-list khi lập danh sách field.
---

# Khung mặc định

Ba field sau luôn đứng đầu `fields`. Không lấy từ PDF. Không đổi `path` hoặc `type`.

- `responseCode`, `string`, `required: true`. Description là `Mã kết quả, ghi 00 khi trích xuất được.`
- `responseDesc`, `string`, `required: true`. Description là `Mô tả kết quả, ghi Trích xuất thành công khi mã là 00.`
- `ocrRate`, `number`, `required: true`. Description là `Tỷ lệ OCR ước lượng.`

`prompt` nói `ocrRate` là số từ 0 đến 100. Không ghi cận đó vào `description`. `98.5` chỉ là ví dụ giá trị, không phải hằng số.

Mọi field lấy từ tài liệu có path bắt đầu bằng `data.response.`. Không khai báo path đúng bằng `data` hoặc `data.response`.

Ví dụ đủ khung:

```json
{
  "prompt": "Trích hóa đơn. Ngày ghi YYYY-MM-DD. ocrRate là số từ 0 đến 100.",
  "fields": [
    {
      "path": "responseCode",
      "type": "string",
      "required": true,
      "description": "Mã kết quả, ghi 00 khi trích xuất được."
    },
    {
      "path": "responseDesc",
      "type": "string",
      "required": true,
      "description": "Mô tả kết quả, ghi Trích xuất thành công khi mã là 00."
    },
    {
      "path": "ocrRate",
      "type": "number",
      "required": true,
      "description": "Tỷ lệ OCR ước lượng."
    },
    {
      "path": "data.response.invoiceNumber",
      "required": true,
      "description": "Số hóa đơn ở góc phải trang đầu."
    }
  ]
}
```

JSON dịch ra có `responseCode`, `responseDesc`, `ocrRate` và `data.response` chứa các field tài liệu. `data.response` có ít nhất một field.
