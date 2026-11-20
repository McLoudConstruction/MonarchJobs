// Big line icons for the Quick Action Screen's main row. 48x48, stroke-based, currentColor.
const common = { width: 44, height: 44, viewBox: '0 0 48 48', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

// A car driving right, with puffs of exhaust trailing behind it.
export function CarIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M17 31v-5.5l3.2-6.5h10.6l4.2 6.5 4.5 1.3V31" />
      <path d="M17 31h-1M36.5 31h2.5M25 31h6" />
      <path d="M22 25.5h12.5M27.5 19v6.5" />
      <circle cx="22" cy="32" r="3.2" />
      <circle cx="35" cy="32" r="3.2" />
      <circle cx="11" cy="26.5" r="2.6" />
      <circle cx="6.2" cy="29.5" r="1.7" />
      <circle cx="9.5" cy="33" r="1.2" />
    </svg>
  );
}

// A stopwatch: start the job, start the clock.
export function StopwatchIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="24" cy="27" r="14" />
      <path d="M20 6h8M24 6v7M36 15l3-3" />
      <path d="M24 27l6-6" />
      <path d="M24 27v-8" strokeWidth="1.6" />
    </svg>
  );
}

// A checkered finish flag on a pole.
export function FinishFlagIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M12 42V7" />
      <path d="M12 8c6-3 10 3 16 0s8 0 8 0v16s-2-3-8 0-10-3-16 0" />
      <path d="M20 6.2v15.6M28 8.5v15.6M12 16h24" strokeWidth="1.6" />
      <path d="M12 8h8v8h-8zM28 16h8v8h-8z" fill="currentColor" stroke="none" opacity=".85" />
    </svg>
  );
}

export function ChatBubbleIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M8 11a3 3 0 0 1 3-3h26a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H23l-8 7v-7h-4a3 3 0 0 1-3-3z" />
      <path d="M15 17h18M15 23h11" />
    </svg>
  );
}

// A clock face with an arrow going in: clock in.
export function ClockInIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="29" cy="24" r="13" />
      <path d="M29 16v8l5 3" />
      <path d="M4 24h15M14 18l6 6-6 6" />
    </svg>
  );
}

// A clock face with an arrow going out: clock out.
export function ClockOutIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="19" cy="24" r="13" />
      <path d="M19 16v8l5 3" />
      <path d="M31 24h15M40 18l6 6-6 6" />
    </svg>
  );
}

// A cup with steam: start or end a break.
export function BreakIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M10 20h22v10a8 8 0 0 1-8 8h-6a8 8 0 0 1-8-8z" />
      <path d="M32 23h3a4 4 0 0 1 0 8h-3" />
      <path d="M16 8c-2 3 2 4 0 7M24 8c-2 3 2 4 0 7" />
    </svg>
  );
}
