import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTTS } from "@/lib/functions/tts.function";

export interface UseTTSConfig {
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface SpeakOptions {
  onEnd?: () => void;
}

function formatError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "";
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Text-to-speech failed";
}

export function useTTS(config: UseTTSConfig) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onEndRef = useRef<(() => void) | undefined>(undefined);
  const configRef = useRef(config);
  const unlockedRef = useRef(false);

  configRef.current = config;

  const unlockAudio = useCallback(() => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    try {
      const ctx = new AudioContext();
      void ctx.resume();
      ctx.close();
    } catch {
      // best-effort unlock for autoplay policies
    }
  }, []);

  const revokeBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
    }
    audioRef.current = null;

    revokeBlobUrl();
    setIsSpeaking(false);
    setIsLoading(false);
  }, [revokeBlobUrl]);

  const cancel = useCallback(() => {
    const onEnd = onEndRef.current;
    onEndRef.current = undefined;
    stop();
    return onEnd;
  }, [stop]);

  const speak = useCallback(
    async (text: string, options?: SpeakOptions): Promise<void> => {
      const { apiKey, model, enabled } = configRef.current;
      if (!enabled) {
        options?.onEnd?.();
        return;
      }

      if (!apiKey.trim()) {
        const message = "Add your Deepgram API key to enable the conversational interviewer.";
        setError(message);
        options?.onEnd?.();
        return;
      }

      unlockAudio();
      cancel();
      onEndRef.current = options?.onEnd;
      setError(null);
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const audioBuffer = await fetchTTS({
          text,
          apiKey,
          model,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        revokeBlobUrl();
        const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          setIsSpeaking(false);
          setIsLoading(false);
          revokeBlobUrl();
          audioRef.current = null;
          abortRef.current = null;
          const onEnd = onEndRef.current;
          onEndRef.current = undefined;
          onEnd?.();
        };

        audio.onerror = () => {
          setError("Failed to play interviewer audio");
          setIsSpeaking(false);
          setIsLoading(false);
          revokeBlobUrl();
          audioRef.current = null;
          abortRef.current = null;
          const onEnd = onEndRef.current;
          onEndRef.current = undefined;
          onEnd?.();
        };

        setIsLoading(false);
        setIsSpeaking(true);
        try {
          await audio.play();
        } catch (playErr) {
          throw new Error(
            playErr instanceof Error
              ? `Could not play audio: ${playErr.message}`
              : "Could not play audio. Check your system volume and audio output device."
          );
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = formatError(err);
        if (!message) return;
        setError(message);
        setIsSpeaking(false);
        setIsLoading(false);
        const onEnd = onEndRef.current;
        onEndRef.current = undefined;
        onEnd?.();
      }
    },
    [cancel, revokeBlobUrl, unlockAudio]
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.onended = null;
        audio.onerror = null;
      }
      revokeBlobUrl();
    };
  }, [revokeBlobUrl]);

  return {
    speak,
    stop,
    cancel,
    unlockAudio,
    isSpeaking,
    isLoading,
    error,
  };
}
