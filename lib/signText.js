// The words a customer signs for a water loss. Plain language, no assignment of insurance benefits (that is state-specific
// and belongs in a template the owner's attorney approves). The company name and address come from Settings and the job.
// NOTE FOR THE OWNER: have the client's attorney review this wording before it is used with customers.

export const SIGN_KINDS = {
  authorization: { title: 'Work authorization', button: 'Authorize and sign' },
  certificate: { title: 'Certificate of completion', button: 'Confirm and sign' },
};

export function signText(kind, { business = 'the company', address = 'the property', customer = '' } = {}) {
  if (kind === 'certificate') {
    return [
      `I confirm that ${business} has finished the drying work at ${address}, that the equipment has been picked up, and that I have been told how the work was done and what was found.`,
      'By signing I agree the work was completed to my satisfaction. Anything I think is still wrong, I will tell the company so they can come back.',
    ];
  }
  return [
    `I, ${customer || 'the customer'}, am the owner of the property at ${address}, or I am allowed to approve work on it. I ask ${business} to begin emergency water damage work there now. This can include removing standing water, removing wet materials, applying treatment, and placing and running drying equipment.`,
    'I understand the work is done at the prices on the estimate, and that prices can change if more work is found. I agree to pay for the work. If I have insurance, I allow the company to talk to my insurance company about this loss and to give them the records of the work.',
    'I understand that equipment stays on site until the drying is done, and I will not unplug it or move it. I give permission to take photos of the loss and the work, for the record and for the insurance claim.',
  ];
}

// the safe public view of a sign request: never a staff name, price or note
export const signKindOk = (k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(SIGN_KINDS, k);
