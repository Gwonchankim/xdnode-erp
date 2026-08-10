import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const ogImage = `${protocol}://${host}/og.png`;

  return {
    title: "XD NODE ERP · 통합 운영 관리",
    description: "재무회계, 영업, HR을 하나의 흐름으로 연결하는 XD NODE 통합 ERP",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "XD NODE ERP",
      description: "재무 · 영업 · HR, 하나의 운영 흐름",
      images: [{ url: ogImage, width: 1731, height: 909, alt: "XD NODE ERP" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "XD NODE ERP",
      description: "재무 · 영업 · HR, 하나의 운영 흐름",
      images: [ogImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
