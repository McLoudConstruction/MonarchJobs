import './globals.css';
import { ThemeProvider } from '@/lib/useTheme';
import ViewportLock from '@/components/ViewportLock';

export const metadata = {
  title: 'MonarchJobs',
  description: 'Job management for floor care and restoration',
  manifest: '/manifest.json',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // fixed zoom on phones: focusing a field must not zoom the page (inputs are also 16px on touch screens, see globals.css)
  maximumScale: 1,
  userScalable: false,
  themeColor: '#19181a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><ViewportLock /><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
