// Thin wrapper over the ElevenLabs voice-cloning APIs — Instant Voice Clone
// (the default pipeline: one multipart call, usable immediately) and the
// heavier Professional Voice Clone kept for when a voice deserves it. Every
// endpoint lives HERE and nowhere else, and every failure surfaces the raw
// ElevenLabs response text — some PVC paths are SDK-inferred in their docs,
// so if a path drifted, the studio UI shows exactly what to fix.

const BASE = "https://api.elevenlabs.io";

// Baked into every clone we create — these are Singlish personas and the
// model renders noticeably better when the accent is declared up front.
const ACCENT_LABELS = { accent: "Singaporean English", language: "en" };
const ACCENT_NOTE =
  "Singaporean English (Singlish) speaker — colloquial, high-energy delivery.";

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY not configured");
  return k;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `ElevenLabs ${res.status}: ${text.slice(0, 500)}`;
}

/** Instant Voice Clone — one multipart call with the sample audio, and the
 *  returned voice_id is usable straight away. No captcha, no training. */
export async function ivcCreate(
  name: string,
  files: { name: string; data: Buffer; mime: string }[]
): Promise<string> {
  const form = new FormData();
  form.append("name", name);
  form.append("description", ACCENT_NOTE);
  form.append("labels", JSON.stringify(ACCENT_LABELS));
  form.append("remove_background_noise", "false");
  for (const f of files) {
    form.append("files", new Blob([new Uint8Array(f.data)], { type: f.mime }), f.name);
  }
  const res = await fetch(`${BASE}/v1/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": key() },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) throw new Error(`ElevenLabs add returned no voice_id: ${JSON.stringify(data)}`);
  return data.voice_id;
}

/** Remove a voice — used before re-cloning so re-submits don't pile up. */
export async function voiceDelete(voiceId: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/voices/${voiceId}`, {
    method: "DELETE",
    headers: { "xi-api-key": key() },
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Create the PVC voice; returns its voice_id. */
export async function pvcCreate(name: string, language = "en"): Promise<string> {
  const res = await fetch(`${BASE}/v1/voices/pvc`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      language,
      description: `${ACCENT_NOTE} Studio clone: ${name}`,
      labels: ACCENT_LABELS,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) throw new Error(`ElevenLabs create returned no voice_id: ${JSON.stringify(data)}`);
  return data.voice_id;
}

/** Upload one batch of sample files (name + mp3 bytes). */
export async function pvcUploadSamples(
  voiceId: string,
  files: { name: string; data: Buffer }[]
): Promise<void> {
  const form = new FormData();
  for (const f of files) {
    form.append("files", new Blob([new Uint8Array(f.data)], { type: "audio/mpeg" }), f.name);
  }
  const res = await fetch(`${BASE}/v1/voices/pvc/${voiceId}/samples`, {
    method: "POST",
    headers: { "xi-api-key": key() },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** The verification captcha — an image of the lines the actor must read. */
export async function pvcGetCaptcha(voiceId: string): Promise<{ data: Buffer; type: string }> {
  const res = await fetch(`${BASE}/v1/voices/pvc/${voiceId}/captcha`, {
    headers: { "xi-api-key": key() },
  });
  if (!res.ok) throw new Error(await readError(res));
  return {
    data: Buffer.from(await res.arrayBuffer()),
    type: res.headers.get("content-type") ?? "image/png",
  };
}

/** Submit the actor's captcha recording (mp3 bytes). */
export async function pvcVerifyCaptcha(voiceId: string, recording: Buffer): Promise<void> {
  const form = new FormData();
  form.append(
    "recording",
    new Blob([new Uint8Array(recording)], { type: "audio/mpeg" }),
    "verification.mp3"
  );
  const res = await fetch(`${BASE}/v1/voices/pvc/${voiceId}/captcha`, {
    method: "POST",
    headers: { "xi-api-key": key() },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Fall back to human review when the captcha runs out of attempts. */
export async function pvcRequestManualVerification(voiceId: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/voices/pvc/${voiceId}/verification`, {
    method: "POST",
    headers: { "xi-api-key": key() },
    body: new FormData(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Kick off fine-tuning once verification passes. */
export async function pvcTrain(voiceId: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/voices/pvc/${voiceId}/train`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Render one line with a freshly cloned voice — the studio's ear check
 *  before the voice_id goes anywhere near an env var. Same model and
 *  settings shape as the live phrase renderer. */
export async function ttsPreview(voiceId: string, text: string): Promise<Buffer> {
  const res = await fetch(
    `${BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6 },
      }),
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return Buffer.from(await res.arrayBuffer());
}

/** Raw voice record — fine_tuning state/progress lives in here. */
export async function pvcStatus(voiceId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/v1/voices/${voiceId}`, {
    headers: { "xi-api-key": key() },
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
