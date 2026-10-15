---
name: flatten-on-gemini-error
description: Làm phẳng một cấp nhóm hoặc lùi một cấp mảng khi Gemini thực tế trả lỗi schema. Nạp sau lỗi đó, trước khi nộp lại fields.
---

# Làm phẳng sau lỗi Gemini

Lần nộp đầu giữ cây tới 5 cấp. Chỉ làm phẳng khi một lần gọi Gemini thực tế trả lỗi schema, kể cả `Request contains an invalid argument.`

Mỗi lần lỗi chỉ đổi một cấp. Hết nhóm thì tới mảng. Không gộp các phần tử của mảng thành một giá trị.

Nhóm là node không có `[]`. Chọn nhóm sâu nhất. Node cha là nhóm bị bỏ. Đi xuống một cấp. Mỗi node con chuyển lên chỗ của node cha.

Mảng là node có `[]`. Khi không còn nhóm để bỏ, lùi mảng sâu nhất đúng một cấp. Mảng và các con của nó chuyển lên chỗ của node cha. `[]` vẫn ở trên mảng. Lỗi kế tiếp thì lùi mảng đó thêm một cấp nữa. Không lùi hai cấp trong một lần sửa.

Tên mới là tên node cha nối với tên node được đưa lên, theo camelCase. Viết hoa chữ cái đầu của tên node được đưa lên. Giữ `[]` nếu node đó là mảng.

`buyer` và `name` thành `buyerName`. `lines` và `taxes[]` thành `linesTaxes[]`. `invoice` và `linesTaxes[]` thành `invoiceLinesTaxes[]`.

`data.response.buyer.address.city` làm phẳng `address` thành `data.response.buyer.addressCity`. `data.response.invoice.lines[].taxes[].rate` lùi mảng `taxes` một cấp thành `data.response.invoice.linesTaxes[].rate`. Lỗi tiếp theo lùi mảng đó thêm một cấp thành `data.response.invoiceLinesTaxes[].rate`. `[]` còn trên mảng.

Xóa path của node cha sau khi các con đã lên. Khai báo prefix của path mới. Không thêm field. Không đổi `required` và `description`. Không thêm `type`.

Nếu tên node con đã bắt đầu bằng tên node cha thì giữ nguyên tên đó. Không nối hai lần.

Nộp lại một JSON của `field-list`. Hết lỗi thì dừng. Còn lỗi thì làm phẳng một cấp sâu nhất còn lại.
