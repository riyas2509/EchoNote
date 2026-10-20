import React, { useState, useEffect, useRef } from 'react';
import { 
  Scissors, 
  Play, 
  Pause, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Sliders, 
  FileAudio,
  Sparkles,
  ShieldCheck,
  Loader2,
  X
} from 'lucide-react';
import { toast } from 'sonner';

export interface AudioTrimmerModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordingId: string;
  recordingTitle: string;
  initialDuration?: number;
  audioUrl?: string;
  projectId?: string;
  onTrimSuccess?: (derivedRecording: any) => void;
  getIdToken?: () => Promise<string | undefined>;
}

export const AudioTrimmerModal: React.FC<AudioTrimmerModalProps> = ({
  isOpen,
  onClose,
  recordingId,
  recordingTitle,
  initialDuration = 0,
  audioUrl,
  projectId,
  onTrimSuccess,
  getIdToken
}) => {
  const [duration, setDuration] = useState<number>(initialDuration || 0);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(initialDuration || 10);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [clipTitle, setClipTitle] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<any | null>(null);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [playbackSourceUrl, setPlaybackSourceUrl] = useState<string>('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimerRef = useRef<any>(null);

  // Initialize and fetch playback token/url if audioUrl is not direct
  useEffect(() => {
    let isMounted = true;
    const setupAudio = async () => {
      try {
        let effectiveUrl = audioUrl || '';
        if (!effectiveUrl || !effectiveUrl.startsWith('blob:')) {
          const token = getIdToken ? await getIdToken() : undefined;
          const res = await fetch(`/api/recordings/${encodeURIComponent(recordingId)}/playback-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
          });
          if (res.ok) {
            const data = await res.json();
            effectiveUrl = data.signedUrl || data.playbackUrl || data.url;
          }
        }
        if (isMounted && effectiveUrl) {
          setPlaybackSourceUrl(effectiveUrl);
        }
      } catch (err) {
        console.warn('[AudioTrimmerModal] Could not fetch signed URL, falling back to direct:', err);
      }
    };

    if (isOpen) {
      setErrorMessage(null);
      setSuccessResult(null);
      setShowConfirm(false);
      setClipTitle(`${recordingTitle} (Trimmed Clip)`);
      setupAudio();
    }

    return () => {
      isMounted = false;
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (previewTimerRef.current) {
        clearInterval(previewTimerRef.current);
      }
    };
  }, [isOpen, recordingId, recordingTitle, audioUrl, getIdToken]);

  // Handle audio metadata load
  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const audioDur = audioRef.current.duration;
      if (audioDur && !isNaN(audioDur) && audioDur > 0) {
        setDuration(audioDur);
        if (endTime <= 0 || endTime > audioDur) {
          setEndTime(Math.min(audioDur, 30));
        }
      }
    }
  };

  // Handle audio timeupdate
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      // Auto stop when preview reaches endTime
      if (audioRef.current.currentTime >= endTime) {
        audioRef.current.pause();
        audioRef.current.currentTime = startTime;
        setIsPlaying(false);
      }
    }
  };

  // Preview controls
  const togglePlayRangePreview = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (currentTime < startTime || currentTime >= endTime) {
        audioRef.current.currentTime = startTime;
      }
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.error('Audio preview play error:', err);
        toast.error('Unable to play audio preview. Check browser audio permissions.');
      });
    }
  };

  const handleStopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = startTime;
      setCurrentTime(startTime);
    }
    setIsPlaying(false);
  };

  // Validation
  const clipDuration = Math.max(0, endTime - startTime);
  const isValidRange = startTime >= 0 && endTime > startTime && clipDuration >= 0.5 && (duration === 0 || endTime <= duration + 0.5);

  const getValidationError = (): string | null => {
    if (startTime < 0) return 'Start time cannot be negative.';
    if (endTime <= startTime) return 'End time must be greater than start time.';
    if (clipDuration < 0.5) return 'Trim selection must be at least 0.5 seconds long.';
    if (duration > 0 && endTime > duration + 0.5) {
      return `End time (${endTime.toFixed(1)}s) exceeds total recording duration (${duration.toFixed(1)}s).`;
    }
    return null;
  };

  const validationError = getValidationError();

  // Execute Trim Mutation
  const handleExecuteTrim = async () => {
    if (!isValidRange) {
      toast.error(validationError || 'Invalid trim range.');
      return;
    }

    setShowConfirm(false);
    setIsProcessing(true);
    setErrorMessage(null);
    setProcessingStep('Acquiring secure media processing slot...');

    try {
      const token = getIdToken ? await getIdToken() : undefined;
      setProcessingStep('Trimming audio bytes with FFmpeg & aligning transcripts...');

      const res = await fetch(`/api/recordings/${encodeURIComponent(recordingId)}/trim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          startTime,
          endTime,
          title: clipTitle.trim() || undefined
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Server-side audio trimming failed.');
      }

      setProcessingStep('Derived asset created & provenance registered.');
      setSuccessResult(data);
      toast.success('Trimmed audio clip generated successfully!');
      if (onTrimSuccess) {
        onTrimSuccess(data.derivedRecording);
      }
    } catch (err: any) {
      console.error('[AudioTrimmerModal Error]:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during audio trimming.');
      toast.error(err.message || 'Audio trimming failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatSeconds = (sec: number): string => {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-6 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight text-white uppercase">Audio Clip & Trimmer</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Lossless FFmpeg Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium truncate max-w-md mt-0.5">
                Original Asset: <span className="text-slate-200 font-bold">{recordingTitle}</span>
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Audio Tag (Hidden or Scrubber) */}
          {playbackSourceUrl && (
            <audio 
              ref={audioRef}
              src={playbackSourceUrl}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
          )}

          {/* Success Banner */}
          {successResult && (
            <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-extrabold text-emerald-900">Trimmed Recording Created Successfully</h4>
                  <p className="text-xs text-emerald-700 mt-1">
                    Produced actual audio file: <span className="font-mono font-bold">{successResult.derivedRecording?.fileName}</span> ({successResult.derivedRecording?.duration?.toFixed(1)}s, {Math.round((successResult.derivedRecording?.sizeBytes || 0) / 1024)} KB).
                  </p>
                  {successResult.transcriptAlignment?.isAligned && (
                    <p className="text-[11px] text-emerald-800 font-semibold mt-1">
                      Aligned {successResult.transcriptAlignment.alignedCount} transcript segment(s) to the new time boundaries.
                    </p>
                  )}
                  <p className="text-[10px] text-emerald-600 font-mono mt-1">
                    Original recording preserved unchanged. Linked to meeting session with unbroken provenance.
                  </p>
                </div>
              </div>
              <div className="pt-2 flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl uppercase tracking-wider"
                >
                  Close & View Asset
                </button>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-extrabold text-rose-900">Trimming Failed</h4>
                <p className="text-xs text-rose-700 mt-0.5 font-medium">{errorMessage}</p>
                <button
                  onClick={() => handleExecuteTrim()}
                  className="mt-2 text-[11px] font-bold text-rose-800 underline hover:text-rose-900"
                >
                  Retry Operation
                </button>
              </div>
            </div>
          )}

          {/* Processing State */}
          {isProcessing && (
            <div className="p-6 rounded-2xl bg-indigo-50 border border-indigo-100 flex flex-col items-center justify-center text-center space-y-3">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <div>
                <h4 className="text-sm font-black text-indigo-950 uppercase tracking-tight">Processing Audio Trim</h4>
                <p className="text-xs text-indigo-700 font-medium mt-1">{processingStep}</p>
                <p className="text-[10px] text-slate-500 mt-1 font-mono">
                  Executing server-side media processing. Do not close this window.
                </p>
              </div>
            </div>
          )}

          {!successResult && !isProcessing && (
            <>
              {/* Clip Title Input */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1.5">
                  Trimmed Clip Title
                </label>
                <input
                  type="text"
                  value={clipTitle}
                  onChange={(e) => setClipTitle(e.target.value)}
                  placeholder="e.g. Budget Discussion Excerpt"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Scrubber & Visual Range Preview */}
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                  <span>Current: <strong className="text-slate-800">{formatSeconds(currentTime)}</strong></span>
                  <span>Duration: <strong className="text-slate-800">{formatSeconds(duration)}</strong></span>
                  <span>Selection: <strong className="text-indigo-600">{formatSeconds(clipDuration)}</strong></span>
                </div>

                {/* Scrubber bar with range visualization */}
                <div className="relative w-full h-8 bg-slate-200 rounded-lg overflow-hidden flex items-center">
                  {/* Selected region fill */}
                  {duration > 0 && (
                    <div 
                      className="absolute top-0 bottom-0 bg-indigo-500/30 border-x-2 border-indigo-600 z-10 pointer-events-none"
                      style={{
                        left: `${(startTime / duration) * 100}%`,
                        width: `${(clipDuration / duration) * 100}%`
                      }}
                    />
                  )}
                  {/* Current playhead marker */}
                  {duration > 0 && (
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-20 pointer-events-none"
                      style={{
                        left: `${(currentTime / duration) * 100}%`
                      }}
                    />
                  )}
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setCurrentTime(val);
                      if (audioRef.current) audioRef.current.currentTime = val;
                    }}
                    className="w-full h-full opacity-0 cursor-pointer z-30"
                  />
                </div>

                {/* Range inputs: Start and End */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                      Clip Start (seconds)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={endTime - 0.5}
                        step={0.1}
                        value={startTime}
                        onChange={(e) => setStartTime(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs font-bold focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      <button
                        onClick={() => setStartTime(currentTime)}
                        className="px-2 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-[10px] font-bold uppercase shrink-0"
                        title="Set start to current playback position"
                      >
                        Set Current
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black uppercase text-slate-600 mb-1">
                      Clip End (seconds)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={startTime + 0.5}
                        max={duration || 99999}
                        step={0.1}
                        value={endTime}
                        onChange={(e) => setEndTime(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs font-bold focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      <button
                        onClick={() => setEndTime(currentTime)}
                        className="px-2 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-[10px] font-bold uppercase shrink-0"
                        title="Set end to current playback position"
                      >
                        Set Current
                      </button>
                    </div>
                  </div>
                </div>

                {/* Validation Warning */}
                {validationError && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{validationError}</span>
                  </div>
                )}

                {/* Preview controls */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={togglePlayRangePreview}
                      disabled={!isValidRange}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{isPlaying ? 'Pause Preview' : 'Play Range Preview'}</span>
                    </button>
                    <button
                      onClick={handleStopPreview}
                      className="p-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                      title="Reset Preview to Start"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <span className="text-[11px] font-mono text-slate-500">
                    Preview: {formatSeconds(startTime)} &rarr; {formatSeconds(endTime)}
                  </span>
                </div>
              </div>

              {/* Original Preservation Notice */}
              <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100 flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="text-[11px] text-slate-600">
                  <p className="font-bold text-slate-800">Immutable Original Recording</p>
                  <p className="mt-0.5">
                    Trimming creates an independent derived recording asset with aligned transcript timestamps. The original recording and audit provenance remain intact.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Confirmation Modal Overlay */}
          {showConfirm && (
            <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3 animate-in zoom-in-95 duration-150">
              <h4 className="text-sm font-black uppercase tracking-tight text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                Confirm Trim Operation
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                You are about to create a new trimmed audio recording of <strong className="text-white">{clipDuration.toFixed(1)} seconds</strong> ({formatSeconds(startTime)} &rarr; {formatSeconds(endTime)}). This will invoke server-side media processing and save a new audio file.
              </p>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecuteTrim}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider transition-all shadow-md"
                >
                  Proceed with Trim
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!successResult && !isProcessing && (
          <div className="p-5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold uppercase tracking-wider transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!isValidRange || showConfirm}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Scissors className="w-4 h-4" />
              <span>Create Trimmed Recording</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
