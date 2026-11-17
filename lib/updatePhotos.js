// A progress update is written for the customer, with photos. A photo taken on a phone with no signal is saved on that phone
// first and reaches the job later, so an update can name a photo the server does not have yet. Such an update must not go to
// the customer until every one of its photos has arrived (the customer page would show a gap).
// Pure, so the tab, the send route and the tests agree.

// ids: the photo ids an update names. have: ids the job has. Returns the ids still missing, in the update's order.
export function photosStillMissing(ids, have) {
  const got = have instanceof Set ? have : new Set(have || []);
  return (Array.isArray(ids) ? ids : []).filter((i) => !got.has(i));
}

export const waitingPhotosText = (n) => `${n} photo${n === 1 ? ' is' : 's are'} still uploading`;

// What to tell the person who tapped Send.
export function sendBlockedText(missing) {
  const n = missing.length;
  return `This update can not be sent yet: ${waitingPhotosText(n)}. It can go as soon as ${n === 1 ? 'it has' : 'they have'} arrived. Open the app on the phone that took ${n === 1 ? 'it' : 'them'} and give it a moment with signal.`;
}
