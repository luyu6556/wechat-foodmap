import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "群聊美食地图",
  description: "和群友一起收藏好吃好玩的地方",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
