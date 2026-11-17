'use client';

import BrandLogo from '@/components/BrandLogo';

// The branded centered card used by every stand-alone screen (notices, gates, unavailable links):
// the business logo on top, then whatever the screen needs. Headings use className="auth-welcome",
// short explanations className="hint auth-sub".
export default function CenterCard({ children, maxWidth }) {
  return (
    <div className="center-wrap">
      <div className="card compact" style={maxWidth ? { maxWidth } : undefined}>
        <BrandLogo />
        {children}
      </div>
    </div>
  );
}
