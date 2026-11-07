import './globals.css';
import { ThemeProvider } from '@/lib/useTheme';

export const metadata = {
  title: 'MonarchJobs',
  description: 'Job management for floor care and restoration',
  manifest: '/manifest.json',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#19181a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
