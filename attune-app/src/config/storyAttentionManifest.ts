export interface StoryScene {
  id: string;
  start_sec: number;
  duration_sec: number;
  theme: string;
  character_gaze: "center" | "left" | "right";
}

export interface StoryProbe {
  probe_index: number;
  at_sec: number;
  cue_side: "left" | "right";
  scene_id: string;
}

export interface StoryAttentionManifest {
  version: string;
  duration_sec: number;
  instruction: string;
  scenes: StoryScene[];
  probes: StoryProbe[];
}

export const STORY_MANIFEST: StoryAttentionManifest = {
  version: "1.0",
  duration_sec: 80,
  instruction: "Watch the story. When the character looks somewhere, look there too.",
  scenes: [
    { id: "s1", start_sec: 0, duration_sec: 20, theme: "meadow", character_gaze: "center" },
    { id: "s2", start_sec: 20, duration_sec: 20, theme: "forest", character_gaze: "center" },
    { id: "s3", start_sec: 40, duration_sec: 20, theme: "pond", character_gaze: "center" },
    { id: "s4", start_sec: 60, duration_sec: 20, theme: "sunset", character_gaze: "center" },
  ],
  probes: [
    { probe_index: 0, at_sec: 28, cue_side: "left", scene_id: "s2" },
    { probe_index: 1, at_sec: 52, cue_side: "right", scene_id: "s3" },
    { probe_index: 2, at_sec: 68, cue_side: "left", scene_id: "s4" },
  ],
};
