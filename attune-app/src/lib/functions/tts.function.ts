import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export interface FetchTTSParams {
  text: string;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

const DEEPGRAM_TTS_URL = "https://api.deepgram.com/v1/speak";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function formatFetchError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Text-to-speech request failed";
}

async function fetchTTSViaHttp({
  text,
  apiKey,
  model,
  signal,
}: FetchTTSParams): Promise<ArrayBuffer> {
  const params = new URLSearchParams({ model, encoding: "mp3" });
  const url = `${DEEPGRAM_TTS_URL}?${params.toString()}`;

  const response = await tauriFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok) {
    let errMsg = response.statusText;
    try {
      const errText = await response.text();
      try {
        const errObj = JSON.parse(errText);
        errMsg = errObj.message || errObj.err_msg || errText;
      } catch {
        errMsg = errText || errMsg;
      }
    } catch {
      // keep default
    }
    throw new Error(`TTS failed (${response.status}): ${errMsg}`);
  }

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) {
    throw new Error("Deepgram returned empty audio");
  }
  return buffer;
}

/**
 * Convert text to speech via Deepgram. Uses the Tauri backend (reqwest) first,
 * then falls back to the HTTP plugin if needed.
 */
export async function fetchTTS(params: FetchTTSParams): Promise<ArrayBuffer> {
  const trimmed = params.text.trim();
  if (!trimmed) {
    throw new Error("Text is required for text-to-speech");
  }
  if (!params.apiKey.trim()) {
    throw new Error("Deepgram API key is required for text-to-speech");
  }

  if (params.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  try {
    const base64 = await invoke<string>("deepgram_text_to_speech", {
      apiKey: params.apiKey.trim(),
      model: params.model,
      text: trimmed,
    });

    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return base64ToArrayBuffer(base64);
  } catch (rustErr) {
    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const rustMessage = formatFetchError(rustErr);
    if (
      rustMessage.includes("Deepgram API key") ||
      rustMessage.includes("Text is required")
    ) {
      throw new Error(rustMessage);
    }

    try {
      return await fetchTTSViaHttp({ ...params, text: trimmed });
    } catch (httpErr) {
      throw new Error(formatFetchError(httpErr) || rustMessage);
    }
  }
}
