export const DEFAULT_DEEPGRAM_TTS_MODEL = "aura-2-orion-en";

export const DEEPGRAM_TTS_VOICES = [
  { id: "aura-2-orion-en", label: "Orion", description: "Male, professional" },
  { id: "aura-2-athena-en", label: "Athena", description: "Female, professional" },
  { id: "aura-2-arcas-en", label: "Arcas", description: "Male, deep" },
  { id: "aura-2-luna-en", label: "Luna", description: "Female, warm" },
  { id: "aura-2-zeus-en", label: "Zeus", description: "Male, authoritative" },
  { id: "aura-2-asteria-en", label: "Asteria", description: "Female, friendly" },
] as const;

export const TTS_TEST_PHRASE =
  "Hello, I'm your interview coach. Let's begin with your first question.";
