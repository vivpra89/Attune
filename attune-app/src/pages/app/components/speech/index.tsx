import { useState, useCallback, useEffect, useRef } from "react";
import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  ScrollArea,
} from "@/components";
import {
  HeadphonesIcon,
  AlertCircleIcon,
  LoaderIcon,
  AudioLinesIcon,
  PauseIcon,
  CameraIcon,
  PlusIcon,
  XIcon,
  SparklesIcon,
  SendIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ModeSwitcher } from "./ModeSwitcher";
import { RecordingPanel } from "./RecordingPanel";
import { ResultsSection } from "./ResultsSection";
import { InterviewPerformancePanel } from "./InterviewPerformancePanel";
import { PermissionFlow } from "./PermissionFlow";
import { QuickActions } from "./QuickActions";
import { AIAnswerPanel } from "./AIAnswerPanel";
import { useSystemAudioType, useGlobalShortcuts } from "@/hooks";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";

export const SystemAudio = (props: useSystemAudioType) => {
  const {
    capturing,
    paused,
    isProcessing,
    isAIProcessing,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    pauseCapture,
    resumeCapture,
    isPopoverOpen,
    setIsPopoverOpen,
    startNewConversation,
    transcriptEntries,
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    handleAnswerQuestions,
    handleUserMessage,
    lastAnsweredIndex,
    autoTranscriptRollup,
    setAutoTranscriptRollup,
    transcriptRollupSummary,
    transcriptRollupThroughIndex,
    rollupLoading,
    interviewPerformance,
    performanceLoading,
    performanceError,
    autoInterviewPerformance,
    setAutoInterviewPerformance,
    handleCoachedAnswerRequest,
    vadConfig,
    updateVadConfiguration,
    recordingProgress,
    scrollAreaRef,
    captureStatus,
    speechSegmentCount,
    systemAudioScreenshotBase64,
    attachSystemAudioScreenshot,
    removeSystemAudioScreenshot,
    analyzeSystemAudioScreenshot,
    isScreenshotAnalyzing,
    conciseMode,
    setConciseMode,
  } = props;

  const { hasActiveLicense, supportsImages } = useApp();
  const { registerPriorityScreenshotCallback } = useGlobalShortcuts();

  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [transcriptWidth, setTranscriptWidth] = useState(320); // Reduced default width
  const [isResizing, setIsResizing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isVadMode = vadConfig.enabled;
  const hasResponse =
    lastAIResponse || isAIProcessing || transcriptEntries.length > 0;

  const handleToggleCapture = async () => {
    if (capturing) {
      await pauseCapture();
    } else if (paused) {
      await resumeCapture();
    } else {
      await startCapture();
    }
  };

  const handleStop = async () => {
    await stopCapture();
    setIsPopoverOpen(false);
    resizeWindow(false);
  };

  const handleModeChange = (vadEnabled: boolean) => {
    updateVadConfiguration({
      ...vadConfig,
      enabled: vadEnabled,
    });
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isAIProcessing) return;
    handleUserMessage(text);
    setInputValue("");
  };

  // Capture screenshot functionality
  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) return;

    setIsCapturingScreenshot(true);
    try {
      // Check screen recording permission on macOS
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsCapturingScreenshot(false);
          return;
        }
      }

      // Same backend as chat overlay: full-screen capture of monitor under the app window
      const base64: string = await invoke("capture_to_base64");

      attachSystemAudioScreenshot(base64);
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [isCapturingScreenshot, attachSystemAudioScreenshot]);

  // While system audio is active, route global screenshot shortcut here (e.g. during STT).
  useEffect(() => {
    const active = (capturing || paused) && !setupRequired;
    if (!active || !hasActiveLicense || !supportsImages) {
      registerPriorityScreenshotCallback(null);
      return () => registerPriorityScreenshotCallback(null);
    }
    registerPriorityScreenshotCallback(() => handleCaptureScreenshot());
    return () => registerPriorityScreenshotCallback(null);
  }, [
    capturing,
    paused,
    setupRequired,
    hasActiveLicense,
    supportsImages,
    handleCaptureScreenshot,
    registerPriorityScreenshotCallback,
  ]);

  const handleRemoveScreenshot = useCallback(() => {
    removeSystemAudioScreenshot();
  }, [removeSystemAudioScreenshot]);

  // Resize functionality
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    // Add cursor style to body while resizing
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      const container = document.querySelector('.speech-audio-container');
      if (!container) return;
      
      const containerRect = container.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      
      // Constrain width between 250px and 70% of container
      const minWidth = 250;
      const maxWidth = containerRect.width * 0.7;
      setTranscriptWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const getButtonIcon = () => {
    if (setupRequired) return <AlertCircleIcon className="text-orange-500" />;
    if (error && !setupRequired)
      return <AlertCircleIcon className="text-red-500" />;
    if (isProcessing) return <LoaderIcon className="animate-spin" />;
    if (paused)
      return <PauseIcon className="text-amber-500" />;
    if (capturing)
      return <AudioLinesIcon className="text-green-500 animate-pulse" />;
    return <HeadphonesIcon />;
  };

  const getButtonTitle = () => {
    if (setupRequired) return "Setup required - Click for instructions";
    if (error && !setupRequired) return `Error: ${error}`;
    if (isProcessing) return "Transcribing audio...";
    if (paused) return "Resume system audio capture";
    if (capturing) return "Pause system audio capture";
    return "Start system audio capture";
  };

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        if ((capturing || paused) && !open) {
          return;
        }
        setIsPopoverOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="icon"
          title={getButtonTitle()}
          onClick={handleToggleCapture}
          className={cn(
            capturing && "bg-green-50 hover:bg-green-100",
            paused && "bg-amber-50 hover:bg-amber-100",
            error && "bg-red-100 hover:bg-red-200"
          )}
        >
          {getButtonIcon()}
        </Button>
      </PopoverTrigger>

      {(capturing ||
        paused ||
        setupRequired ||
        error ||
        isAIProcessing ||
        !!lastAIResponse) && (
        <PopoverContent
          align="end"
          side="bottom"
          className="select-none w-screen p-0 border shadow-lg overflow-hidden border-input/50"
          sideOffset={8}
        >
          <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
            {/* Header - Mode Switcher + Actions */}
            <div className="flex-shrink-0 p-3 border-b border-border/50 space-y-2">
              <div className="flex items-center justify-between gap-2">
                {/* Mode Switcher */}
                {!setupRequired && (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <ModeSwitcher
                      isVadMode={isVadMode}
                      onModeChange={handleModeChange}
                      disabled={isProcessing || isAIProcessing}
                    />
                  </div>
                )}
                {setupRequired && (
                  <h2 className="font-semibold text-sm">Setup Required</h2>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Screenshot Button */}
                  {hasActiveLicense && !setupRequired && supportsImages && (
                    <Button
                      size="sm"
                      variant={
                        systemAudioScreenshotBase64 ? "default" : "outline"
                      }
                      onClick={handleCaptureScreenshot}
                      disabled={isCapturingScreenshot}
                      className={cn(
                        "h-6 text-[10px] gap-1 px-2",
                        systemAudioScreenshotBase64 &&
                          "bg-primary text-primary-foreground"
                      )}
                      title="Capture screenshot — also added to the main ask bar"
                    >
                      {isCapturingScreenshot ? (
                        <LoaderIcon className="w-3 h-3 animate-spin" />
                      ) : (
                        <CameraIcon className="w-3 h-3" />
                      )}
                      Screenshot
                    </Button>
                  )}

                  {/* New Conversation Button */}
                  {!setupRequired && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={startNewConversation}
                      className="h-6 text-[10px] gap-1 px-2"
                      title="Start a new conversation"
                    >
                      <PlusIcon className="w-3 h-3" />
                      New
                    </Button>
                  )}

                  {/* Close / End Session */}
                  {!capturing && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title={paused ? "End session" : "Close"}
                      onClick={async () => {
                        if (paused) {
                          await stopCapture();
                        }
                        setIsPopoverOpen(false);
                        resizeWindow(false);
                      }}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              
              {/* Chat input bar */}
              {!setupRequired && (
                <div className="flex items-center gap-1.5">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Type a question or message…"
                    disabled={isAIProcessing}
                    className="flex-1 rounded-md border border-border/50 bg-background/80 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isAIProcessing}
                    className="flex items-center justify-center h-7 w-7 rounded-md bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
                    title="Send message"
                  >
                    <SendIcon className="w-3.5 h-3.5" />
                  </button>
                  {transcriptEntries.length > 0 && !isAIProcessing && (
                    <button
                      onClick={handleAnswerQuestions}
                      className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap"
                      title="Auto-answer from transcript"
                    >
                      <SparklesIcon className="w-3 h-3" />
                      Answer
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-1 min-h-0 flex-col sm:flex-row divide-y sm:divide-y-0 divide-border/40 speech-audio-container">
              {setupRequired ? (
                <ScrollArea
                  className="flex-1 min-h-0 min-w-0"
                  ref={scrollAreaRef}
                >
                  <div className="p-2 space-y-2">
                    {systemAudioScreenshotBase64 && (
                      <div className="flex flex-col gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                        <div className="flex items-center gap-2">
                          <img
                            src={`data:image/png;base64,${systemAudioScreenshotBase64}`}
                            alt="Screenshot"
                            className="h-12 w-20 object-cover rounded shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-medium">
                              Screenshot attached
                            </p>
                            <p className="text-[9px] text-muted-foreground">
                              Also on the main ask bar. Included with your next
                              AI reply from this panel (Answer, quick actions,
                              or typed message).
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5 shrink-0"
                            onClick={handleRemoveScreenshot}
                            title="Remove screenshot"
                          >
                            <XIcon className="h-3 w-3" />
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-[10px] gap-1.5 w-full sm:w-auto"
                          disabled={
                            isAIProcessing ||
                            isScreenshotAnalyzing ||
                            !supportsImages
                          }
                          onClick={() => void analyzeSystemAudioScreenshot()}
                          title="Get an immediate AI response from the screenshot only"
                        >
                          {isScreenshotAnalyzing ? (
                            <LoaderIcon className="w-3 h-3 animate-spin" />
                          ) : (
                            <SparklesIcon className="w-3 h-3" />
                          )}
                          Get AI response from screenshot
                        </Button>
                      </div>
                    )}
                    {error && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                        <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[10px] font-medium text-red-800">
                            Error
                          </p>
                          <p className="text-[10px] text-red-700">{error}</p>
                        </div>
                      </div>
                    )}
                    <PermissionFlow
                      onPermissionGranted={() => {
                        startCapture();
                      }}
                      onPermissionDenied={() => {
                        // Keep showing setup instructions
                      }}
                    />
                  </div>
                </ScrollArea>
              ) : (
                <>
                  {/* Left: coaching — performance, insights, recording */}
                  <ScrollArea
                    className="flex-1 min-h-0 min-w-0 order-2 sm:order-1"
                    ref={scrollAreaRef}
                  >
                    <div className="p-1 space-y-1">
                      {systemAudioScreenshotBase64 && (
                        <div className="flex flex-col gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                          <div className="flex items-center gap-2">
                            <img
                              src={`data:image/png;base64,${systemAudioScreenshotBase64}`}
                              alt="Screenshot"
                              className="h-12 w-20 object-cover rounded shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-medium">
                                Screenshot attached
                              </p>
                              <p className="text-[9px] text-muted-foreground">
                                Also on the main ask bar. Included with your
                                next AI reply from this panel (Answer, quick
                                actions, or typed message).
                              </p>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={handleRemoveScreenshot}
                              title="Remove screenshot"
                            >
                              <XIcon className="h-3 w-3" />
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-[10px] gap-1.5 w-full sm:w-auto"
                            disabled={
                              isAIProcessing ||
                              isScreenshotAnalyzing ||
                              !supportsImages
                            }
                            onClick={() => void analyzeSystemAudioScreenshot()}
                            title="Get an immediate AI response from the screenshot only"
                          >
                            {isScreenshotAnalyzing ? (
                              <LoaderIcon className="w-3 h-3 animate-spin" />
                            ) : (
                              <SparklesIcon className="w-3 h-3" />
                            )}
                            Get AI response from screenshot
                          </Button>
                        </div>
                      )}

                      {error && (
                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                          <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[10px] font-medium text-red-800">
                              Error
                            </p>
                            <p className="text-[10px] text-red-700">{error}</p>
                          </div>
                        </div>
                      )}

                      <RecordingPanel
                        isVadMode={isVadMode}
                        isProcessing={isProcessing}
                        isAIProcessing={isAIProcessing}
                        recordingProgress={recordingProgress}
                        captureStatus={captureStatus}
                        speechSegmentCount={speechSegmentCount}
                        chunkSecs={vadConfig.streaming_chunk_secs}
                        onChunkSecsChange={(secs) =>
                          updateVadConfiguration({
                            ...vadConfig,
                            streaming_chunk_secs: secs,
                          })
                        }
                        paused={paused}
                        onPause={pauseCapture}
                        onResume={resumeCapture}
                        onStop={handleStop}
                      />

                      <InterviewPerformancePanel
                        className="w-full rounded-lg border border-border/50 overflow-hidden"
                        hasTranscript={transcriptEntries.length > 0}
                        snapshot={interviewPerformance}
                        loading={performanceLoading}
                        error={performanceError}
                        autoRefresh={autoInterviewPerformance}
                        onAutoRefreshChange={setAutoInterviewPerformance}
                        onCoachedAnswer={(mode) => {
                          if (!interviewPerformance) return;
                          void handleCoachedAnswerRequest(
                            mode,
                            interviewPerformance
                          );
                        }}
                        coachActionDisabled={isAIProcessing}
                      />

                      <AIAnswerPanel
                        lastAIResponse={lastAIResponse}
                        isAIProcessing={isAIProcessing}
                        conciseMode={conciseMode}
                        onConciseModeChange={setConciseMode}
                      />
                    </div>
                  </ScrollArea>

                  {/* Resize Handle */}
                  <div
                    className="hidden sm:flex w-1.5 bg-border hover:bg-primary cursor-col-resize transition-colors relative items-center justify-center"
                    onMouseDown={handleResizeMouseDown}
                    style={{ minWidth: '6px' }}
                  >
                    {/* Expand hit area */}
                    <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
                    {/* Visual indicator dots */}
                    <div className="absolute inset-y-0 flex flex-col items-center justify-center gap-1 pointer-events-none">
                      <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/40" />
                      <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/40" />
                      <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/40" />
                    </div>
                  </div>

                  {/* Right: transcript, AI reply, compose */}
                  <ScrollArea 
                    className="flex-none min-h-0 order-1 sm:order-2 bg-muted/5"
                    style={{ 
                      width: window.innerWidth >= 640 ? `${transcriptWidth}px` : '100%'
                    }}
                  >
                    <div className="p-1">
                      <ResultsSection
                        isAIProcessing={isAIProcessing}
                        isProcessing={isProcessing}
                        transcriptEntries={transcriptEntries}
                        lastAnsweredIndex={lastAnsweredIndex}
                        autoTranscriptRollup={autoTranscriptRollup}
                        onAutoRollupChange={setAutoTranscriptRollup}
                        transcriptRollupSummary={transcriptRollupSummary}
                        transcriptRollupThroughIndex={
                          transcriptRollupThroughIndex
                        }
                        rollupLoading={rollupLoading}
                      />
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>

            {/* Quick Actions */}
            {!setupRequired && hasResponse && (
              <div className="flex-shrink-0 border-t border-border/50 p-1">
                <QuickActions
                  actions={quickActions}
                  onActionClick={handleQuickActionClick}
                  onAddAction={addQuickAction}
                  onRemoveAction={removeQuickAction}
                  isManaging={isManagingQuickActions}
                  setIsManaging={setIsManagingQuickActions}
                  show={showQuickActions}
                  setShow={setShowQuickActions}
                />
              </div>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
};
