import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { isFfmpegAvailable, normalizeAudioMimeType } from './audioUtils.ts';
import { TranscriptSegment } from '../types.ts';

export interface TrimAudioOptions {
  inputBuffer: Buffer;
  mimeType?: string;
  fileName?: string;
  startTime: number;
  endTime: number;
  maxDurationSeconds?: number;
}

export interface TrimAudioResult {
  trimmedBuffer: Buffer;
  mimeType: string;
  extension: string;
  fileName: string;
  duration: number;
  contentHash: string;
  sizeBytes: number;
}

/**
 * Validates audio trim boundary conditions.
 */
export function validateTrimRange(
  startTime: number,
  endTime: number,
  totalDuration?: number,
  maxAllowedClipSeconds: number = 7200 // 2 hours default limit
): { valid: boolean; error?: string; duration?: number } {
  if (typeof startTime !== 'number' || isNaN(startTime) || startTime < 0) {
    return { valid: false, error: 'Start time must be a non-negative number in seconds.' };
  }
  if (typeof endTime !== 'number' || isNaN(endTime) || endTime <= 0) {
    return { valid: false, error: 'End time must be a positive number in seconds.' };
  }
  if (endTime <= startTime) {
    return { valid: false, error: 'End time must be strictly greater than start time.' };
  }

  const duration = endTime - startTime;
  if (duration < 0.5) {
    return { valid: false, error: 'Trim range must be at least 0.5 seconds long.' };
  }
  if (duration > maxAllowedClipSeconds) {
    return { 
      valid: false, 
      error: `Trim range duration of ${duration.toFixed(1)}s exceeds the maximum limit of ${maxAllowedClipSeconds}s.` 
    };
  }

  if (typeof totalDuration === 'number' && totalDuration > 0) {
    // Add small tolerance (e.g. 0.5s) for audio player float rounding
    if (startTime >= totalDuration) {
      return { 
        valid: false, 
        error: `Start time (${startTime.toFixed(1)}s) cannot exceed total recording duration (${totalDuration.toFixed(1)}s).` 
      };
    }
    if (endTime > totalDuration + 0.5) {
      return { 
        valid: false, 
        error: `End time (${endTime.toFixed(1)}s) cannot exceed total recording duration (${totalDuration.toFixed(1)}s).` 
      };
    }
  }

  return { valid: true, duration };
}

/**
 * Trims an audio buffer using fluent-ffmpeg.
 * Uses seek / duration parameters and outputs high-quality compressed audio (AAC/M4A or WAV depending on input).
 */
export async function trimAudioBuffer(options: TrimAudioOptions): Promise<TrimAudioResult> {
  const { inputBuffer, mimeType, fileName, startTime, endTime } = options;

  const validation = validateTrimRange(startTime, endTime, undefined, options.maxDurationSeconds);
  if (!validation.valid || !validation.duration) {
    throw new Error(validation.error || 'Invalid trim boundaries.');
  }

  const ffmpegStatus = isFfmpegAvailable();
  if (!ffmpegStatus.available) {
    throw new Error(`FFmpeg media processor is not available: ${ffmpegStatus.error || 'Executable missing'}`);
  }

  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error('Input audio buffer is empty.');
  }

  // 100MB input buffer limit protection
  if (inputBuffer.length > 100 * 1024 * 1024) {
    throw new Error('Input audio exceeds maximum supported file size of 100MB for trimming.');
  }

  const normalized = normalizeAudioMimeType(mimeType, fileName);
  const inputExt = normalized.extension || '.m4a';
  const outExt = (inputExt === '.wav') ? '.wav' : '.m4a';
  const outMime = (outExt === '.wav') ? 'audio/wav' : 'audio/mp4';

  const tempDir = os.tmpdir();
  const fileId = crypto.randomUUID();
  const tempInputPath = path.join(tempDir, `echonote_trim_in_${fileId}${inputExt}`);
  const tempOutputPath = path.join(tempDir, `echonote_trim_out_${fileId}${outExt}`);

  try {
    fs.writeFileSync(tempInputPath, inputBuffer);

    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(tempInputPath)
        .setStartTime(startTime)
        .setDuration(validation.duration!);

      if (outExt === '.wav') {
        command = command
          .toFormat('wav')
          .audioCodec('pcm_s16le')
          .audioFrequency(16000)
          .audioChannels(1);
      } else {
        // Output clean AAC audio inside M4A/MP4 container
        command = command
          .toFormat('mp4')
          .audioCodec('aac')
          .audioBitrate('128k')
          .outputOptions(['-movflags', '+faststart']);
      }

      command
        .on('start', (cmdLine) => {
          console.log(`[AudioTrimService] Executing FFmpeg trim: ${cmdLine}`);
        })
        .on('error', (err: any, stdout?: string, stderr?: string) => {
          console.error(`[AudioTrimService] FFmpeg trim error: ${err.message}`);
          if (stderr) {
            console.error(`[AudioTrimService] Stderr: ${stderr.slice(-300)}`);
          }
          reject(new Error(`Audio trimming processing failed: ${err.message}`));
        })
        .on('end', () => {
          resolve();
        })
        .save(tempOutputPath);
    });

    if (!fs.existsSync(tempOutputPath)) {
      throw new Error('FFmpeg completed without generating output file.');
    }

    const trimmedBuffer = fs.readFileSync(tempOutputPath);
    if (trimmedBuffer.length === 0) {
      throw new Error('Generated trimmed audio file is 0 bytes.');
    }

    const contentHash = crypto.createHash('sha256').update(trimmedBuffer).digest('hex');
    const safeBaseName = (fileName ? path.basename(fileName, path.extname(fileName)) : 'recording')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputFileName = `${safeBaseName}_trimmed_${Math.round(startTime)}s_${Math.round(endTime)}s${outExt}`;

    return {
      trimmedBuffer,
      mimeType: outMime,
      extension: outExt,
      fileName: outputFileName,
      duration: validation.duration,
      contentHash: `sha256:${contentHash}`,
      sizeBytes: trimmedBuffer.length
    };
  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
    } catch {}
    try {
      if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    } catch {}
  }
}

/**
 * Derives transcript segments aligned to the trimmed time window [startTime, endTime].
 * 
 * Rules:
 * 1. Segments completely outside the window are excluded.
 * 2. Segments overlapping the boundaries are clipped to [startTime, endTime].
 * 3. Timestamps are offset by startTime so the trimmed audio starts at 0.0s.
 * 4. Returns alignment metadata indicating whether segments were found or if alignment is partial/empty.
 */
export function alignTranscriptSegments(
  originalSegments: TranscriptSegment[] | undefined,
  startTime: number,
  endTime: number
): {
  alignedSegments: TranscriptSegment[];
  totalOriginalSegments: number;
  alignedCount: number;
  isAligned: boolean;
  alignmentNote?: string;
} {
  if (!Array.isArray(originalSegments) || originalSegments.length === 0) {
    return {
      alignedSegments: [],
      totalOriginalSegments: 0,
      alignedCount: 0,
      isAligned: false,
      alignmentNote: 'No original transcript segments were available for alignment.'
    };
  }

  const aligned: TranscriptSegment[] = [];

  for (const seg of originalSegments) {
    const sStart = typeof seg.startTime === 'number' ? seg.startTime : 0;
    const sEnd = typeof seg.endTime === 'number' ? seg.endTime : sStart;

    // Check if segment overlaps with the trim range [startTime, endTime]
    if (sEnd <= startTime || sStart >= endTime) {
      continue; // Completely outside the trim window
    }

    // Clip segment to boundaries
    const clippedStart = Math.max(sStart, startTime);
    const clippedEnd = Math.min(sEnd, endTime);

    // Offset relative to new clip start
    const newStart = Math.max(0, clippedStart - startTime);
    const newEnd = Math.max(newStart, clippedEnd - startTime);

    aligned.push({
      speaker: seg.speaker || 'Speaker',
      text: seg.text || '',
      startTime: Number(newStart.toFixed(2)),
      endTime: Number(newEnd.toFixed(2))
    });
  }

  const isAligned = aligned.length > 0;
  return {
    alignedSegments: aligned,
    totalOriginalSegments: originalSegments.length,
    alignedCount: aligned.length,
    isAligned,
    alignmentNote: isAligned 
      ? `Successfully aligned ${aligned.length} segment(s) to trimmed audio range (${startTime}s - ${endTime}s).`
      : `No transcript segments fell within the selected time window (${startTime}s - ${endTime}s).`
  };
}
