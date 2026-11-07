export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDay(d) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

const pad = (n) => String(n).padStart(2, '0');

// <input type="datetime-local"> value in the browser's local time zone
export function toLocalInput(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v) {
  return new Date(v).toISOString();
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function money(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export const JOB_STATUS = {
  booked: 'Booked',
  on_the_way: 'On the way',
  in_progress: 'In progress',
  completed: 'Completed',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const JOB_TYPES = {
  floor_cleaning: 'Floor cleaning',
  water_restoration: 'Water restoration',
  other: 'Other',
};

export const UNIT_LABELS = { sqft: 'per sq ft', room: 'per room', flat: 'flat', hour: 'per hour', each: 'each' };

export function addressLine(a) {
  if (!a) return '';
  return [a.street, a.unit, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export const LEAD_STATUS = {
  new: 'New',
  quoted: 'Quoted',
  accepted: 'Ready to schedule',
  booked: 'Work order',
  lost: 'Lost',
};

export const CUSTOMER_TYPES = { residential: 'Residential', commercial: 'Commercial', multifamily: 'Multifamily' };

// Appointments have a start time and a length. No end time is ever entered or shown.
export const DURATION_CHOICES = [30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];

export function fmtDuration(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h} hr`;
  return `${h} hr ${r} min`;
}

// "Tue, Nov 10, 9:00 AM for 2 hr"
export function fmtStartDuration(iso, minutes) {
  return `${fmtDateTime(iso)} for ${fmtDuration(minutes)}`;
}

// "9:00 AM, 2 hr"
export function fmtTimeDuration(iso, minutes) {
  return `${fmtTime(iso)}, ${fmtDuration(minutes)}`;
}

export function leadDisplayName(l) {
  if (!l) return '';
  return l.company_name?.trim() || [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || l.name || '';
}
