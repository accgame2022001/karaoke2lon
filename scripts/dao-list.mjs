// Quét thư mục public/dao và ghi danh sách ảnh vào public/dao/index.json.
// Chạy tự động trước khi dev và build, nên chỉ cần chép ảnh vào public/dao rồi push lên GitHub.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";

const dir = "public/dao";
mkdirSync(dir, { recursive: true });
const ok = /\.(jpe?g|png|webp|gif|avif|svg)$/i;
const images = readdirSync(dir)
  .filter((f) => ok.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
writeFileSync(dir + "/index.json", JSON.stringify({ images }, null, 2) + "\n");
console.log(`public/dao: ${images.length} ảnh`);
