// Stage 1 of the Restoration and Carpet workflows: what the office asks on the first call.
// Option lists, step lists and the small bits of logic (suggested priority, tech summary) live here so
// the new-lead flow and the lead page use the same words, and so they can be tested without a browser.

export const KINDS = { restoration: 'Restoration', carpet: 'Carpet' };

export const RESTORATION_TYPES = {
  extraction: { label: 'Extraction', hint: 'Remove standing water' },
  mitigation: { label: 'Mitigation', hint: 'Dry out and stop further damage' },
  remediation: { label: 'Remediation', hint: 'Mold, sewage, fire and other cleanup' },
};

export const PRIORITIES = { emergency: 'Emergency', urgent: 'Urgent', standard: 'Standard' };

// leads.job_type is the older three-way field the rest of the app already reads.
export const JOB_TYPE_FOR_KIND = { restoration: 'water_restoration', carpet: 'floor_cleaning' };

// Which flow a saved lead belongs to. Leads made before intake existed fall back on job_type.
export function kindOf(lead) {
  if (!lead) return '';
  if (lead.restoration_type || lead.job_type === 'water_restoration') return 'restoration';
  if (lead.job_type === 'floor_cleaning') return 'carpet';
  return '';
}

export const STEPS = {
  restoration: ['Customer', 'Loss', 'Safety & site', 'Insurance', 'Schedule'],
  carpet: ['Customer', 'Service', 'Condition', 'Timing', 'Schedule'],
};

// ---------------------------------------------------------------- shared option lists
const list = (...items) => items.map((x) => (Array.isArray(x) ? { value: x[0], label: x[1] } : { value: x, label: x }));

export const YES_NO = list(['no', 'No'], ['yes', 'Yes']);
export const YES_NO_UNSURE = list(['no', 'No'], ['yes', 'Yes'], ['unsure', 'Not sure']);

export const RELATIONSHIPS = list('Owner', 'Tenant', 'Landlord', 'Property manager', 'Adjuster', 'Agent', 'Other');
export const CARPET_RELATIONSHIPS = list('Owner', 'Tenant', 'Landlord', 'Property manager');
export const HEARD_ABOUT_RESTORATION = list('Insurance referral', 'Plumber', 'Agent', 'Google', 'Repeat customer', 'Property manager', 'Other');
export const HEARD_ABOUT_CARPET = list('Google', 'Referral', 'Repeat customer', 'Property manager', 'Realtor', 'Facebook', 'Door hanger', 'Other');
export const PROPERTY_TYPES = list('Single-family', 'Multi-family', 'Condo', 'Apartment', 'Business');

// ---------------------------------------------------------------- restoration
export const LOSS_TYPES = list(
  'Burst pipe', 'Supply line', 'Appliance leak', 'Toilet overflow', 'Sewage backup', 'Roof leak', 'Storm or flood', 'Fire', 'Other',
);
export const WATER_SOURCES = list(
  ['clean', 'Clean (supply line)'], ['gray', 'Gray (dishwasher, washer, sink)'], ['black', 'Black (sewage, floodwater)'], ['unknown', 'Not sure'],
);
// Time since the loss drives drying class and mold risk, and the 24 / 48 hour lines drive priority.
export const LOSS_AGE = list(
  ['under24', 'Under 24 hours ago'], ['24to48', '24 to 48 hours ago'], ['over48', 'More than 48 hours ago'], ['unknown', 'Not sure'],
);
export const WATER_FLOW = list(['running', 'Still running'], ['off', 'Shut off'], ['unknown', 'Not sure']);
export const STANDING_WATER = list(['none', 'None'], ['under1', 'Under 1 inch'], ['1to6', '1 to 6 inches'], ['over6', 'Over 6 inches']);
export const WATER_SPREAD = list('Ceilings', 'Walls', 'Between floors');
export const MATERIALS_WET = list(
  'Carpet and pad', 'Hardwood', 'Laminate', 'Vinyl', 'Tile', 'Drywall', 'Insulation', 'Cabinets', 'Furniture', 'Contents',
);

export const ELECTRICAL = list(
  ['none', 'No hazard'], ['hazard_on', 'Water near power, still on'], ['hazard_off', 'Water near power, shut off at breaker'], ['unknown', 'Not sure'],
);
export const SITE_HAZARDS = list('Gas smell', 'Sparking', 'Sagging ceiling or structure', 'Sewage', 'Mold', 'Biohazard');
export const VULNERABLE = list('Children', 'Elderly', 'Pets', 'Respiratory issues');
export const HABITABLE = list(['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']);
export const HOME_AGE = list(['pre1980', 'Built before 1980'], ['1980plus', 'Built 1980 or later'], ['unknown', 'Not sure']);
export const SITE_POWER = list(['dedicated', 'Dedicated circuits'], ['limited', 'Limited'], ['none', 'No power'], ['unknown', 'Not sure']);

export const PAYERS = list(['owner', 'Owner'], ['insurance', 'Insurance'], ['both', 'Both'], ['unknown', 'Not sure']);
export const CLAIM_PROGRAM = list(['direct', 'Direct pay'], ['tpa', 'TPA program'], ['unknown', 'Not sure']);

// ---------------------------------------------------------------- carpet
export const CLEAN_ITEMS = list('Carpet', 'Area rugs', 'Upholstery', 'Tile and grout', 'Hardwood', 'Vinyl', 'Mattresses', 'Other');
export const CLEAN_EXTRAS = list('Hallways', 'Closets', 'Stairs', 'Landings');
export const CLEAN_TYPES = list(['routine', 'Routine clean'], ['deep', 'Deep clean'], ['move', 'Move-in or move-out'], ['problem', 'Problem-specific']);
export const FIBERS = list('Nylon', 'Polyester', 'Wool', 'Olefin', 'Triexta', 'Berber', 'Plush', 'Frieze', 'Not sure');
export const CARPET_AGE = list(['under2', 'Under 2 years'], ['2to5', '2 to 5 years'], ['5to10', '5 to 10 years'], ['over10', 'Over 10 years'], ['unknown', 'Not sure']);
export const WARRANTY = list(['no', 'No'], ['yes', 'Yes, requires a specific method'], ['unsure', 'Not sure']);
export const PRIOR_DAMAGE = list('Burns', 'Pulls', 'Seams lifting', 'Wrinkles', 'Bleach spots', 'Fading');
export const STAINS = list('Pet', 'Coffee', 'Wine', 'Ink', 'Grease', 'Blood', 'Rust', 'Paint', 'Unknown');
export const SOILING = list(['none', 'None'], ['lanes', 'Traffic lanes'], ['heavy', 'Heavy soiling'], ['both', 'Both']);
export const LAST_CLEANED = list(['never', 'Never'], ['under6', 'Under 6 months ago'], ['6to12', '6 to 12 months ago'], ['1to2', '1 to 2 years ago'], ['over2', 'Over 2 years ago'], ['unknown', 'Not sure']);
export const CARPET_ACCESS = list(['home', 'Someone will be home'], ['key', 'Lockbox or key'], ['other', 'Other arrangement']);
export const OCCUPANCY = list(['occupied', 'Occupied'], ['vacant', 'Vacant']);
export const FURNISHING = list(['furnished', 'Furnished'], ['empty', 'Empty']);
export const CONTACT_METHODS = list(['call', 'Call'], ['text', 'Text'], ['email', 'Email']);
export const QUOTE_TYPES = list(
  ['phone', 'Quick quote by phone (standard rooms, no special issues)'],
  ['onsite', 'On-site estimate needed (large, heavy damage, odor, commercial, unknown materials)'],
);

// ---------------------------------------------------------------- blank state and logic
export const BLANK_INTAKE = {};

const label = (options, value) => options.find((o) => o.value === value)?.label || '';

// Emergency: water still running, a safety hazard, or a loss under 24 hours old.
// Urgent: a loss between 24 and 48 hours old. Standard: older losses, estimates only. The office can change it.
export function suggestPriority(intake = {}) {
  const hazards = intake.site_hazards || [];
  if (intake.water_flow === 'running') return 'emergency';
  if (intake.injuries === 'yes' || intake.electrical === 'hazard_on' || hazards.length > 0) return 'emergency';
  if (intake.loss_started === 'under24' || intake.loss_discovered === 'under24') return 'emergency';
  if (intake.loss_started === '24to48' || intake.loss_discovered === '24to48') return 'urgent';
  return 'standard';
}

const lower = (s) => (s || '').toLowerCase();

// The short blurb a tech reads before the visit, built from the answers. The office can overwrite it.
export function buildLossSummary(kind, restorationType, intake = {}) {
  const bits = [];
  if (kind === 'restoration') {
    const water = { clean: 'clean water', gray: 'gray water', black: 'black water' }[intake.water_source];
    bits.push([RESTORATION_TYPES[restorationType]?.label, lower(intake.loss_type)].filter(Boolean).join(': '));
    if (water) bits.push(water);
    const age = { under24: 'under 24 hours old', '24to48': '24 to 48 hours old', over48: 'over 48 hours old' }[intake.loss_started];
    if (age) bits.push(age);
    if (intake.water_flow === 'running') bits.push('water still running');
    if (intake.affected_rooms) bits.push(intake.affected_rooms);
    if (intake.affected_sqft) bits.push(`about ${intake.affected_sqft} sq ft`);
    const standing = { under1: 'under 1 inch standing', '1to6': '1 to 6 inches standing', over6: 'over 6 inches standing' }[intake.standing_water];
    if (standing) bits.push(standing);
    if ((intake.materials_wet || []).length) bits.push(`wet: ${intake.materials_wet.map(lower).join(', ')}`);
    if (intake.home_age === 'pre1980') bits.push('built before 1980');
    if (intake.electrical === 'hazard_on') bits.push('ELECTRICAL HAZARD, power on');
    if ((intake.site_hazards || []).length) bits.push(`hazards: ${intake.site_hazards.map(lower).join(', ')}`);
  } else if (kind === 'carpet') {
    bits.push((intake.clean_items || []).map(lower).join(', ') || 'cleaning');
    if (intake.clean_type) bits.push(lower(label(CLEAN_TYPES, intake.clean_type)));
    if (intake.area_count) bits.push(`${intake.area_count} rooms or areas`);
    if (intake.sqft) bits.push(`about ${intake.sqft} sq ft`);
    if ((intake.stains || []).length) bits.push(`stains: ${intake.stains.map(lower).join(', ')}`);
    if (intake.pet_odor === 'yes') bits.push('pet odor');
    if (intake.soiling && intake.soiling !== 'none') bits.push(lower(label(SOILING, intake.soiling)));
  }
  return bits.filter(Boolean).join(', ');
}

// What the lead list shows under the name.
export function buildServiceRequested(kind, restorationType, intake = {}) {
  if (kind === 'restoration') {
    return [RESTORATION_TYPES[restorationType]?.label, intake.loss_type].filter(Boolean).join(' · ');
  }
  if (kind === 'carpet') {
    return (intake.clean_items || []).join(', ');
  }
  return '';
}

// Carpet answers that mean water or mold: the restoration flow should look at this job.
export function needsRestorationReview(intake = {}) {
  return intake.recent_water === 'yes' || intake.mold_smell === 'yes';
}

// Fields written when a lead is saved: kind decides job_type, and priority / summary fall back on the answers.
export function finishLead(form, kind) {
  const intake = form.intake || {};
  const out = { ...form, job_type: JOB_TYPE_FOR_KIND[kind] || form.job_type };
  if (kind === 'restoration') {
    out.priority = form.priority || suggestPriority(intake);
  } else {
    out.restoration_type = null;
    out.priority = form.priority || null;
  }
  // The service line is derived from the answers, so it follows them when they change.
  const requested = buildServiceRequested(kind, form.restoration_type, intake);
  if (requested) out.service_requested = requested;
  if (!(out.loss_summary || '').trim()) out.loss_summary = buildLossSummary(kind, form.restoration_type, intake);
  if (kind === 'carpet') out.intake = { ...intake, restoration_review: needsRestorationReview(intake) };
  return out;
}

// Answers worth showing on the lead's overview: [label, text] pairs, empty ones left out.
export function intakeHighlights(kind, lead) {
  const i = lead.intake || {};
  const rows = [];
  const add = (l, v) => { if (v && String(v).trim()) rows.push([l, String(v)]); };
  if (kind === 'restoration') {
    add('Loss', [i.loss_type, label(WATER_SOURCES, i.water_source)].filter(Boolean).join(' · '));
    add('Started', label(LOSS_AGE, i.loss_started));
    add('Water', label(WATER_FLOW, i.water_flow));
    add('Affected', [i.affected_rooms, i.affected_sqft && `${i.affected_sqft} sq ft`].filter(Boolean).join(' · '));
    add('Wet materials', (i.materials_wet || []).join(', '));
    add('Safety', [i.injuries === 'yes' && 'Injuries', i.electrical === 'hazard_on' && 'Power still on near water', ...(i.site_hazards || [])].filter(Boolean).join(', '));
    add('Claim', i.claim === 'yes' ? [i.carrier, i.claim_number && `claim ${i.claim_number}`, i.adjuster_name && `adjuster ${i.adjuster_name}`].filter(Boolean).join(' · ') || 'Yes' : '');
    add('On site', i.onsite_contact);
  } else if (kind === 'carpet') {
    add('Cleaning', [(i.clean_items || []).join(', '), label(CLEAN_TYPES, i.clean_type)].filter(Boolean).join(' · '));
    add('Size', [i.area_count && `${i.area_count} areas`, i.sqft && `${i.sqft} sq ft`].filter(Boolean).join(' · '));
    add('Problems', [...(i.stains || []), i.pet_odor === 'yes' && 'pet odor', i.soiling && i.soiling !== 'none' && label(SOILING, i.soiling)].filter(Boolean).join(', '));
    add('Needed by', i.needed_by);
    add('Quote', label(QUOTE_TYPES, i.quote_type).split(' (')[0]);
  }
  return rows;
}
