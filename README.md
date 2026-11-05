# Karaoke cùng nhau

Phòng karaoke online: chọn nhạc YouTube, cả phòng nghe đồng bộ, chỉ người đang hát mới mở mic.

## Cách hoạt động
- **Nhạc:** mỗi máy tự phát YouTube, đồng bộ theo mốc thời gian chung (không truyền nhạc qua mic).
- **Giọng hát:** truyền qua LiveKit (WebRTC). Chỉ người đến lượt được cấp quyền publish; người nghe không bao giờ xin quyền mic.
- **Hàng chờ và bài đang hát:** lưu trong metadata phòng LiveKit, nên không cần database.

## Phòng, ghế và chat
- 4 phòng có sẵn, mỗi phòng một giao diện: Hoàng Gia (tím vàng), VIP 1 (đỏ neon), VIP 2 (xanh đại dương), VIP 3 (xanh rừng). Cũng có thể nhập mã phòng riêng.
- Mỗi phòng tối đa 30 ghế. Mọi người ngồi theo thứ tự vào phòng, người đang hát đứng trên sân khấu.
- Chat hiện thành bong bóng trên đầu người gửi trong 6 giây, kèm danh sách tin nhắn gần đây.
- Gõ tên bài vào ô Chọn bài để tìm karaoke. Cần `YOUTUBE_API_KEY`; hạn mức miễn phí khoảng 100 lượt tìm mỗi ngày, kết quả được lưu 1 ngày để tiết kiệm.

## Chấm điểm và bảng xếp hạng
- Hát xong, mọi người (trừ người hát) có 10 giây chấm từ 1 đến 10. Bấm Bỏ qua bài thì không chấm.
- Điểm bài = trung bình các phiếu. Bảng xếp hạng cộng điểm các bài đã hát theo tên người hát, kèm điểm trung bình.
- Bảng xếp hạng nằm trong metadata phòng, nên mất khi phòng trống quá 10 phút.

## Cài đặt
1. Tạo project miễn phí tại https://cloud.livekit.io, lấy `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
2. (Tùy chọn) Tạo `YOUTUBE_API_KEY` trong Google Cloud (YouTube Data API v3) để tìm bài. Không có thì dán link YouTube.
3. Chạy thử: `cp .env.example .env.local`, điền khóa, rồi `npm install && npm run dev`.

## Đưa lên GitHub và Vercel
1. `git init && git add . && git commit -m "karaoke" ` rồi push lên repo GitHub.
2. Vào vercel.com, Add New Project, chọn repo, thêm 3 (hoặc 4) biến môi trường ở trên, bấm Deploy.
3. Chia sẻ link dạng `https://ten-app.vercel.app/?r=ma-phong`.

## Lưu ý
- Người hát nên dùng tai nghe, không thì mic thu lại tiếng nhạc từ loa.
- Điện thoại khóa màn hình hoặc chạy nền có thể làm YouTube tạm dừng (hạn chế của iOS và một số trình duyệt).
- Nếu hai người thêm bài cùng một giây, một bài có thể bị mất (không có database nên chưa khóa ghi).
