import "./globals.css";

export const metadata = {
  title: 'Alkoholfri öl-kartan',
  description: 'Hitta vad alkoholfri öl kostar på barer och restauranger i Sverige',
  // We ship this file as `web/public/site.webmanifest`.
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
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