import { Suspense } from 'react';
import "./globals.css";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vadkostarnollan.se'),
  title: 'Vad kostar nollan?',
  description: 'Hitta vad alkoholfri öl kostar på barer och restauranger i Sverige',
  openGraph: {
    title: 'Vad kostar nollan?',
    description: 'Hitta vad alkoholfri öl kostar på barer och restauranger i Sverige',
    url: '/',
    siteName: 'Vad kostar nollan?',
    images: [{ url: '/vadkostarnollan.jpg', width: 1200, height: 630 }],
    locale: 'sv_SE',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vad kostar nollan?',
    description: 'Hitta vad alkoholfri öl kostar på barer och restauranger i Sverige',
    images: ['/vadkostarnollan.jpg'],
  },
  // We ship this file as `web/public/site.webmanifest`.
  verification: { google: 'E1lTNdKO9u6axEj8qXcZCggHSnFGofsEjwl3fAaXBI8' },
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
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
        <Suspense>{children}</Suspense>
      </body>
    </html>
  );
}