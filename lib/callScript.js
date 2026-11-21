// Call script shown beside the new-lead form (push 1A, #3). The owner writes one prompt per line in Settings;
// a line starting with "# " is a heading that groups the prompts under it. Blank lines are ignored.

export const MAX_SCRIPT_CHARS = 4000;

// Text -> [{ id, type: 'heading' | 'prompt', text }]
export function parseScript(text) {
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (/^#\s*\S/.test(line)) out.push({ id: `h${out.length}`, type: 'heading', text: line.replace(/^#\s*/, '') });
    else out.push({ id: `p${out.length}`, type: 'prompt', text: line.replace(/^[-*•]\s+/, '') });
  });
  return out;
}

export const promptCount = (items) => items.filter((i) => i.type === 'prompt').length;

export function scriptFor(settings, kind) {
  const text = kind === 'restoration' ? settings?.call_script_restoration : kind === 'carpet' ? settings?.call_script_carpet : '';
  return parseScript(text);
}

// Starting points the owner can load and rewrite. The client's own script replaces these once they send it.
export const STARTER_SCRIPTS = {
  carpet: [
    '# Greeting',
    'Thank the caller and give the business name.',
    'Get their name and the best phone number.',
    '# The job',
    'Which rooms or areas need cleaning?',
    'About how big, and what kind of floor is it?',
    'Any stains, pet odors or other problem spots?',
    '# Booking',
    'Confirm the service address and any gate code.',
    'Offer a day and time that works.',
    'Tell them what happens next and when they will hear from us.',
  ].join('\n'),
  restoration: [
    '# First, stay calm and reassure',
    'Get their name and a phone number we can reach right now.',
    'Is anyone hurt or in danger? Is water still running or the power on near it?',
    '# The loss',
    'What happened, and when did it start?',
    'Which rooms are affected, and how far has the water spread?',
    'Is the source stopped?',
    '# Insurance',
    'Are they filing a claim? Carrier, claim number and adjuster if they have them.',
    'Who is paying for the work?',
    '# Next steps',
    'Confirm the address, gate code and who will be on site.',
    'Tell them when a technician can arrive.',
  ].join('\n'),
};
