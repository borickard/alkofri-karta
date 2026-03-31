import { Suspense } from 'react';
import Script from 'next/script';
import "./globals.css";

export const metadata = {
  title: 'Vad kostar nollan?',
  description: 'Hitta vad alkoholfri öl kostar på barer och restauranger i Sverige',
  // We ship this file as `web/public/site.webmanifest`.
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
        <Script src="https://plausible.io/js/pa-QGIsfj-z_AH_VAAhwJdPe.js" strategy="afterInteractive" />
        <Script id="plausible-init" strategy="afterInteractive">{`
          window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
          plausible.init()
        `}</Script>
      </body>
    </html>
  );
}