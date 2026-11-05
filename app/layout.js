import "./globals.css";
export const metadata = { title: "Karaoke cùng nhau", description: "Phòng karaoke online, nhạc YouTube đồng bộ cho cả phòng" };
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#111211" };
export default function RootLayout({ children }) {
  return (<html lang="vi"><body>{children}</body></html>);
}
