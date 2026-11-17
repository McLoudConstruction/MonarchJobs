'use client';

import { SunIcon, MoonIcon } from '@/components/icons';
import './themeswitch.css';

// "Dark mode" row with a slide switch. variant "menu" fits the account menu, "sheet" the phone More sheet.
export default function ThemeSwitch({ theme, setTheme, variant = 'menu' }) {
  const dark = theme === 'dark';
  const Icon = dark ? MoonIcon : SunIcon;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      className={variant === 'sheet' ? 'more-sheet-link' : 'shell-account-item'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <Icon className={variant === 'sheet' ? 'more-sheet-icon' : 'shell-account-icon'} />
      <span>Dark mode</span>
      <span className={`tsw${variant === 'sheet' ? ' lg' : ''}`} aria-hidden="true"><span className="tsw-knob" /></span>
    </button>
  );
}
