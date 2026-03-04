import type { Metadata } from "next";
import "./globals.css";

export const metadata = {
  title: 'Alkoholfri öl-kartan',
  description: 'Hitta vad alkoholfri öl kostar på barer och restauranger i Sverige',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv">
      <body>
        {children}
      </body>
    </html>
  );
}