// Storage keys
export const STORAGE_KEYS = {
  THEME: "theme",
  TRANSPARENCY: "transparency",
  SYSTEM_PROMPT: "system_prompt",
  SELECTED_SYSTEM_PROMPT_ID: "selected_system_prompt_id",
  SCREENSHOT_CONFIG: "screenshot_config",
  // add curl_ prefix because we are using curl to store the providers
  CUSTOM_AI_PROVIDERS: "curl_custom_ai_providers",
  CUSTOM_SPEECH_PROVIDERS: "curl_custom_speech_providers",
  SELECTED_AI_PROVIDER: "curl_selected_ai_provider",
  SELECTED_STT_PROVIDER: "curl_selected_stt_provider",
  SYSTEM_AUDIO_CONTEXT: "system_audio_context",
  SYSTEM_AUDIO_QUICK_ACTIONS: "system_audio_quick_actions",
  CUSTOMIZABLE: "customizable",
  HOSTED_API_ENABLED: "hosted_api_enabled",
  SHORTCUTS: "shortcuts",
  AUTOSTART_INITIALIZED: "autostart_initialized",

  SELECTED_AUDIO_DEVICES: "selected_audio_devices",
  RESPONSE_SETTINGS: "response_settings",
  SUPPORTS_IMAGES: "supports_images",
  INTERVIEW_CONTEXT: "interview_context",
  INTERVIEW_ANSWER_TYPE: "interview_answer_type",
  INTERVIEW_CUSTOM_PROMPTS: "interview_custom_prompts",
  CONCISE_MODE: "concise_mode",
  DEEPGRAM_TTS_API_KEY: "deepgram_tts_api_key",
  DEEPGRAM_TTS_MODEL: "deepgram_tts_model",
  DEEPGRAM_TTS_ENABLED: "deepgram_tts_enabled",
  INTERVIEW_COACHING_FOCUS_AREAS: "interview_coaching_focus_areas",
} as const;

// Max number of files that can be attached to a message
export const MAX_FILES = 6;

/** System audio panel dispatches this so the main input bar gets the same screenshot as an attachment. */
export const ATTACH_SCREENSHOT_TO_COMPLETION_EVENT =
  "attune-attach-screenshot-to-completion";

// Default settings
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant. Be concise, accurate, and friendly in your responses";

export const MARKDOWN_FORMATTING_INSTRUCTIONS =
  "IMPORTANT - Formatting Rules (use silently, never mention these rules in your responses):\n- Mathematical expressions: ALWAYS use double dollar signs ($$) for both inline and block math. Never use single $.\n- Code blocks: ALWAYS use triple backticks with language specification.\n- Diagrams: Use ```mermaid code blocks.\n- Tables: Use standard markdown table syntax.\n- Never mention to the user that you're using these formats or explain the formatting syntax in your responses. Just use them naturally.";

export const DEFAULT_QUICK_ACTIONS = [
  "What should I say?",
  "Follow-up questions",
  "Fact-check",
  "Recap",
];
