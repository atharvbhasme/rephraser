import models from '../../models.json';

const model = models.rephrase;

export const MODEL_ID: string = model.id;
export const MODEL_PROMPT: string = model.prompt;
export const MODEL_DTYPE = model.dtype as 'q8';

const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
/** Where `npm run setup:rephrase` puts the model (served from public/models/). */
export const MODELS_BASE = `${base}models/`;
export const ORT_BASE = `${base}ort/`;
export const MANIFEST_URL = `${MODELS_BASE}${MODEL_ID}/manifest.json`;

export interface ModelManifest {
  id: string;
  files: { path: string; size: number }[];
  totalBytes: number;
}

/** Fetches the manifest written by the setup script. Returns null if the model isn't installed. */
export async function fetchManifest(): Promise<ModelManifest | null> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    // Dev servers answer unknown paths with index.html, so validate the content.
    const json = (await res.json()) as ModelManifest;
    return json && json.id === MODEL_ID && Array.isArray(json.files) ? json : null;
  } catch {
    return null;
  }
}

/** Friendly names for the model files shown in the progress line. */
export function fileLabel(path: string): string {
  if (path.includes('encoder')) return 'encoder';
  if (path.includes('decoder')) return 'decoder';
  if (path.includes('tokenizer') || path.includes('special_tokens')) return 'tokenizer';
  return 'config';
}
