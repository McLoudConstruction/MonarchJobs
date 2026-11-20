// Receipt pictures kept on a purchase. Pure helpers (paths, checks); the upload itself lives in the Costs tab.
export const RECEIPT_BUCKET = 'purchase-receipts';
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export const receiptPathFor = (jobId, uuid) => `${jobId}/${uuid}.jpg`;

// The pathname must be a file in this job's folder, so a purchase can never point at another job's receipt.
export const receiptBelongsToJob = (path, jobId) => typeof path === 'string' && !!jobId && path.startsWith(`${jobId}/`) && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(path);

export function checkReceiptBlob(blob) {
  if (!blob || !blob.size) return 'The picture did not come through. Try again.';
  if (blob.size > RECEIPT_MAX_BYTES) return 'That picture is too large. Take it again a little farther away.';
  return null;
}
