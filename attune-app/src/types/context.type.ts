import { Dispatch, SetStateAction } from "react";
import {
  InterviewContext,
  InterviewType,
  ScreenshotConfig,
  TYPE_PROVIDER,
} from "@/types";
import { CursorType, CustomizableState } from "@/lib/storage";
import type { InterviewCustomPrompts } from "@/lib/storage/interview-context.storage";

export type IContextType = {
  interviewContext: InterviewContext;
  setInterviewContext: (ctx: InterviewContext) => void;
  interviewAnswerType: InterviewType;
  setInterviewAnswerType: (type: InterviewType) => void;
  interviewCustomPrompts: InterviewCustomPrompts;
  setInterviewCustomPrompt: (type: InterviewType, prompt: string) => void;
  resetInterviewCustomPrompt: (type: InterviewType) => void;
  systemPrompt: string;
  setSystemPrompt: Dispatch<SetStateAction<string>>;
  allAiProviders: TYPE_PROVIDER[];
  customAiProviders: TYPE_PROVIDER[];
  selectedAIProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedAIProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  allSttProviders: TYPE_PROVIDER[];
  customSttProviders: TYPE_PROVIDER[];
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedSttProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  screenshotConfiguration: ScreenshotConfig;
  setScreenshotConfiguration: React.Dispatch<
    React.SetStateAction<ScreenshotConfig>
  >;
  customizable: CustomizableState;
  toggleAppIconVisibility: (isVisible: boolean) => Promise<void>;
  toggleAlwaysOnTop: (isEnabled: boolean) => Promise<void>;
  toggleAutostart: (isEnabled: boolean) => Promise<void>;
  loadData: () => void;
  hostedApiEnabled: boolean;
  setHostedApiEnabled: (enabled: boolean) => Promise<void>;
  hasActiveLicense: boolean;
  setHasActiveLicense: Dispatch<SetStateAction<boolean>>;
  getActiveLicenseStatus: () => Promise<void>;
  selectedAudioDevices: {
    input: { id: string; name: string };
    output: { id: string; name: string };
  };
  setSelectedAudioDevices: Dispatch<
    SetStateAction<{
      input: { id: string; name: string };
      output: { id: string; name: string };
    }>
  >;
  setCursorType: (type: CursorType) => void;
  supportsImages: boolean;
  setSupportsImages: (value: boolean) => void;
};
