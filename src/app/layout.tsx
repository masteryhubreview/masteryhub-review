import type { Metadata, Viewport } from 'next';
import StudentDeviceGuard from '@/components/StudentDeviceGuard';
import './globals.css';

export const metadata: Metadata = {
  title: 'ReviewHub',
  description: 'Learn. Practice. Improve.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <StudentDeviceGuard />
        {children}
      </body>
    </html>
  );
}