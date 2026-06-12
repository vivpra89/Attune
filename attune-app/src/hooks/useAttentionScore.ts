import { useAttune } from "@/contexts/attune.context";

/** Subscribes to Vision attention samples and exposes score for UI/dim control. */
export function useAttentionScore() {
  const { attentionScore, facePresent } = useAttune();
  return { score: attentionScore, facePresent };
}
