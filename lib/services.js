// Which tools a job shows, by the kind of work it is. Pure, so the screens, the server and the tests agree.
//
// Four services. Mitigation includes extraction (a drying job crosses over into extraction work), so every feature that
// extraction has, mitigation has too. A job with no service (an "other" job, or one made before services existed and not
// matched) shows everything, so nothing is ever hidden by accident.

export const SERVICES = {
  carpet: 'Carpet',
  extraction: 'Extraction',
  mitigation: 'Mitigation',
  remediation: 'Remediation',
};
export const SERVICE_KEYS = Object.keys(SERVICES);
export const SERVICE_HINTS = {
  carpet: 'Floor cleaning',
  extraction: 'Remove standing water, usually by the hour',
  mitigation: 'Dry out and stop further damage (includes extraction)',
  remediation: 'Mold, sewage, fire and other cleanup',
};

// The older three-way field the rest of the app still reads. The database keeps it in step with the service.
export const JOB_TYPE_FOR_SERVICE = {
  carpet: 'floor_cleaning',
  extraction: 'water_restoration',
  mitigation: 'water_restoration',
  remediation: 'water_restoration',
};

const RESTORATION = ['extraction', 'mitigation', 'remediation'];

// feature -> the services that have it. Features not listed here are for every job.
export const FEATURES = {
  // job tabs and buttons
  moistureTab: ['mitigation'],
  inspectionTab: ['carpet'],
  // the multi-family eval sheet (one per unit) is a carpet tool
  evalSheet: ['carpet'],
  progressUpdates: RESTORATION,
  recheck: ['mitigation'],
  moveToMoisture: ['mitigation'],
  // the customer care page, care messages, plans and mailing lists are carpet-only
  customerPage: ['carpet'],
  // sketch tools
  affectedAreas: RESTORATION,
  moldSmoke: ['remediation'],
  ceilingHeight: ['mitigation'],
  quoteFromSketch: ['carpet', 'extraction', 'mitigation'],
  // estimate options (Good / Better / Best, optional add-ons)
  estimateOptions: ['carpet'],
  // internal note categories
  moistureNotes: ['mitigation'],
  insuranceNotes: RESTORATION,
};

// Is this feature shown on a job with this service? `service` is a SERVICES key, or empty for "show everything".
export function hasFeature(service, feature) {
  if (!service || !SERVICES[service]) return true;
  const list = FEATURES[feature];
  if (!list) return true;
  return list.includes(service);
}

// A job object ({ service }) or a lead object ({ restoration_type, job_type }) as a service key, or '' when unknown.
export function serviceOf(row) {
  if (!row) return '';
  if (SERVICES[row.service]) return row.service;
  if (SERVICES[row.restoration_type]) return row.restoration_type;
  if (row.job_type === 'floor_cleaning') return 'carpet';
  if (row.job_type === 'water_restoration') return 'mitigation';
  return '';
}

export const serviceLabel = (service) => SERVICES[service] || '';

// "Carpet", "Restoration · Extraction" (what lists and headers show)
export function serviceTitle(service) {
  if (!SERVICES[service]) return '';
  return service === 'carpet' ? 'Carpet' : `Restoration · ${SERVICES[service]}`;
}

// Internal note categories, with the ones that belong to other kinds of work taken out.
export const MOISTURE_CATEGORIES = ['Moisture / drying', 'Equipment'];
export const INSURANCE_CATEGORIES = ['Insurance / adjuster'];
export function noteCategories(all, service, current = '') {
  return all.filter((c) => {
    if (c === current) return true; // a note already saved in a category keeps it
    if (MOISTURE_CATEGORIES.includes(c)) return hasFeature(service, 'moistureNotes');
    if (INSURANCE_CATEGORIES.includes(c)) return hasFeature(service, 'insuranceNotes');
    return true;
  });
}

// The job tabs that apply to a service, in order. `tabs` is [[key, label], ...].
const TAB_FEATURE = { moisture: 'moistureTab', inspection: 'inspectionTab', evalsheet: 'evalSheet', updates: null };
export function tabsFor(tabs, service) {
  return tabs.filter(([k]) => {
    const f = TAB_FEATURE[k];
    return f ? hasFeature(service, f) : true;
  });
}

// Which area kinds the Affected areas tool offers: water and source for restoration, growth and smoke for remediation.
export function areaKindsFor(service, order) {
  if (!hasFeature(service, 'affectedAreas')) return [];
  return order.filter((k) => (k === 'growth' || k === 'smoke' ? hasFeature(service, 'moldSmoke') : true));
}
