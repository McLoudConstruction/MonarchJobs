// Rules for the tech's status buttons on a visit. Pure logic so it can be tested; the server
// route applies the result to the database.

export const MINUTE_CHOICES = [10, 20, 30, 40, 50, 60];

const ALLOWED_FROM = {
  on_the_way: ['scheduled', 'on_the_way'], // pressing again updates the ETA ("running late")
  started: ['scheduled', 'on_the_way'],
  finished: ['started'],
};

// Returns { error } or { visitPatch, jobPatch, eventKind, eventDetails }.
// othersActive: number of other visits on the job that are still scheduled / under way.
export function planTransition({ visit, action, minutes, othersActive = 0, now = new Date() }) {
  if (!ALLOWED_FROM[action]) return { error: 'Unknown action.' };
  if (!ALLOWED_FROM[action].includes(visit.status)) {
    return { error: `A visit that is ${visit.status.replace(/_/g, ' ')} cannot be set to ${action.replace(/_/g, ' ')}.` };
  }
  const ts = now.toISOString();

  if (action === 'on_the_way') {
    if (!MINUTE_CHOICES.includes(Number(minutes))) return { error: 'Choose 10, 20, 30, 40, 50 or 60 minutes.' };
    return {
      visitPatch: { status: 'on_the_way', minutes_out: Number(minutes), on_the_way_at: ts },
      jobPatch: { status: 'on_the_way' },
      eventKind: 'visit_on_the_way',
      eventDetails: { visit_id: visit.id, minutes: Number(minutes) },
    };
  }

  if (action === 'started') {
    return {
      visitPatch: { status: 'started', started_at: ts },
      jobPatch: { status: 'in_progress' },
      eventKind: 'visit_started',
      eventDetails: { visit_id: visit.id },
    };
  }

  // finished: the job is complete unless another visit is still planned (a return visit)
  const complete = othersActive === 0;
  return {
    visitPatch: { status: 'finished', finished_at: ts },
    jobPatch: complete ? { status: 'completed', completed_at: ts } : { status: 'booked' },
    eventKind: 'visit_finished',
    eventDetails: { visit_id: visit.id, job_completed: complete },
    touchCustomerLastVisit: ts,
  };
}
