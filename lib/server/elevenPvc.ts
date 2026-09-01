// Thin wrapper over the ElevenLabs Professional Voice Cloning API. Every
// endpoint lives HERE and nowhere else, and every failure surfaces the raw
// ElevenLabs response text — their docs mark some PVC paths as SDK-inferred,
// so if a path drifted, the studio UI shows exactly what to fix.

const BASE = "https://api.elevenlabs.io";

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY not configured");
  return k;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `ElevenLabs ${res.status}: ${text.slice(0, 500)}`;
}

/** Create the PVC voice; returns its voice_id. */
export async function pvcCreate(name: string, language = "en"): Promise<string> {
  const res = await fetch(`${BASE}/v1/voices/pvc`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      language,
      description: `Run Buddy studio clone: ${name}`,
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

/** Raw voice record — fine_tuning state/progress lives in here. */
export async function pvcStatus(voiceId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/v1/voices/${voiceId}`, {
    headers: { "xi-api-key": key() },
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
