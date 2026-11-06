import './globals.css';

export const metadata = {
  title: 'MonarchJobs',
  description: 'Job management for floor care and restoration',
  manifest: '/manifest.json',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1f3a5f',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
