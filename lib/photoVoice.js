// Voice captions on photos: a spoken note kept with the photo, for the team only.
export const PHOTO_VOICE_BUCKET = 'photo-voice';
export const photoVoicePath = (jobId, photoId, ext) => `${jobId}/${photoId}_v.${String(ext || 'webm').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'webm'}`;
export const hasVoice = (p) => !!(p && p.voice_path);
