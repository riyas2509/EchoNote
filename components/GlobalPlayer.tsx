import React from 'react';
import { PlaybackMetadata, PlaybackStatus, AuthStatus } from '../types';

interface GlobalPlayerProps {
  metadata: PlaybackMetadata | null;
  status: PlaybackStatus;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: (speed: number) => void;
  authStatus: AuthStatus;
}

const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const GlobalPlayer: React.FC<GlobalPlayerProps> = ({
  metadata,
  status,
  currentTime,
  duration,
  playbackSpeed,
  onPlayPause,
  onStop,
  onSeek,
  onSpeedChange,
  authStatus,
}) => {
  if (!metadata || status === 'stopped') return null;

  const isGuest = authStatus === AuthStatus.GUEST;

  return (
    <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-[100] bg-white/95 backdrop-blur-xl border-t border-brand-divider/20 shadow-sm animate-in slide-in-from-bottom-full duration-500">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex flex-col md:flex-row items-center gap-3 md:gap-6">
        {/* Asset Info */}
        <div className="flex items-center space-x-3 md:space-x-4 w-full md:w-64 shrink-0">
          <div className="h-8 w-8 md:h-10 md:w-10 bg-brand-primary rounded-lg flex items-center justify-center shrink-0 shadow-md overflow-hidden border border-white/10">
            <img 
              src="/Logo-2.png" 
              alt="EchoNote" 
              className="h-6 w-6 object-contain" 
            />
          </div>
          <div className="overflow-hidden text-left">
            <p className="text-[13px] font-bold text-brand-primary truncate tracking-tight">
              {metadata.title}
            </p>
            <p className="text-[10px] text-brand-secondary font-bold tracking-widest uppercase opacity-50">
              {metadata.segmentIndex !== undefined ? `Segment analysis` : `Master asset`}
            </p>
          </div>
        </div>

        {/* Controls & Progress */}
        <div className="flex-1 w-full flex flex-col items-center space-y-1 md:space-y-2">
          <div className="flex items-center space-x-6 md:space-x-8">
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => !isGuest && onSpeedChange(playbackSpeed === 1 ? 1.5 : playbackSpeed === 1.5 ? 2 : playbackSpeed === 2 ? 0.5 : 1)}
                className={`px-2 py-1 bg-brand-background border border-brand-divider/20 rounded text-[10px] font-bold transition-colors w-12 ${isGuest ? 'text-slate-300 cursor-not-allowed' : 'text-brand-primary hover:bg-brand-divider/10'}`}
                title={isGuest ? "Playback speed locked in guest mode" : "Playback Speed"}
                disabled={isGuest}
              >
                {playbackSpeed}x
              </button>
            </div>

            <button 
              onClick={onStop}
              className="text-slate-400 hover:text-red-500 transition-colors"
              title="Stop Analysis"
            >
              <i className="fa-solid fa-stop text-base md:text-lg"></i>
            </button>
            
            <button 
              onClick={onPlayPause}
              className="w-10 h-10 md:w-12 md:h-12 bg-brand-primary text-brand-accent rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
            >
              <i className={`fa-solid ${status === 'playing' ? 'fa-pause' : 'fa-play'} ${status !== 'playing' ? 'ml-1' : ''} text-sm md:text-base`}></i>
            </button>
          </div>

          <div className="w-full flex items-center space-x-4">
            <span className="text-[11px] font-medium text-slate-400 w-10 text-right font-mono">{formatTime(currentTime)}</span>
            <input 
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="flex-1 h-1.5 bg-brand-background rounded-lg appearance-none cursor-pointer accent-brand-primary hover:accent-brand-secondary transition-all"
            />
            <span className="text-[11px] font-medium text-slate-400 w-10 font-mono">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Desktop Branding Badge */}
        <div className="hidden md:flex w-64 justify-end shrink-0">
          <div className="px-3 py-1 bg-brand-background border border-brand-divider/20 rounded-lg text-[11px] font-medium tracking-[0.2em] text-slate-400 font-mono">
            Secure playback channel
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalPlayer;