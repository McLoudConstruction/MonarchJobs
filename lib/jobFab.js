// Which buttons the phone's floating action button shows on a job. Pure logic so it can be tested.
//   hasSketch:    the job has at least one sketch
//   visitStatus:  status of the visit the tech can act on (scheduled | on_the_way | started), or null
//   docsMissing:  the sketch / update tables are not set up yet (migration 007)
// Order is the order on screen. On The Way shows while the visit is waiting or already on the way (it then updates the ETA).
// Start Job turns into Complete Job once the visit has started. Internal Update is always there.

export const FAB_HIDDEN_TABS = ['sketch', 'moisture']; // the floorplan has its own controls along the edges

export function fabActions({ hasSketch = false, visitStatus = null, docsMissing = false } = {}) {
  const out = [];
  if (!docsMissing && hasSketch) out.push('recheck');
  if (!docsMissing && !hasSketch) out.push('sketch');
  if (visitStatus === 'started') { if (!docsMissing) out.push('complete'); }
  else if (visitStatus === 'scheduled' || visitStatus === 'on_the_way') out.push('otw', 'start');
  if (!docsMissing) out.push('internal');
  return out;
}

export const FAB_LABELS = {
  recheck: 'Start Recheck',
  sketch: 'Start Sketch',
  otw: 'On The Way',
  start: 'Start Job',
  complete: 'Complete Job',
  internal: 'Send Internal Update',
};
