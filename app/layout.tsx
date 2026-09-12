import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'نظام استلام المبالغ',
  description: 'تسجيل وإرسال عمليات استلام المبالغ',
  manifest: '/manifest.webmanifest',
  applicationName: 'نظام استلام المبالغ',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'نظام استلام المبالغ' },
  icons: { icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }], apple: '/icon-192.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
