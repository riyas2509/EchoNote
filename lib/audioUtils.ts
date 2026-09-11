import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

let ffmpegPathResolved: string | null = null;

try {
  if (ffmpegStatic && typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) {
    ffmpeg.setFfmpegPath(ffmpegStatic);
    ffmpegPathResolved = ffmpegStatic;
    console.log(`[AudioUtils] FFmpeg initialized with binary at: ${ffmpegStatic}`);
  } else {
    console.warn("[AudioUtils] ffmpeg-static path did not resolve to an existing executable file.");
  }
} catch (err: any) {
  console.error("[AudioUtils] Error configuring FFmpeg path:", err?.message || err);
}

/**
 * Checks if the FFmpeg runtime is available and ready for conversion tasks.
 */
export function isFfmpegAvailable(): { available: boolean; path?: string; error?: string } {
  if (ffmpegPathResolved && fs.existsSync(ffmpegPathResolved)) {
    return { available: true, path: ffmpegPathResolved };
  }
  return { 
    available: false, 
    error: "FFmpeg executable is not available in the current environment." 
  };
}

export interface NormalizedAudioMime {
  containerMime: string;
  codec?: string;
  extension: string;
  isGeminiDirectSupported: boolean;
  isConversionRecommended: boolean;
}

/**
 * Robust MIME normalization function.
 * Splits container from codec parameters (e.g. 'audio/webm;codecs=opus' -> container: 'audio/webm', codec: 'opus').
 * Infers from fileName if raw MIME is missing or generic.
 */
export function normalizeAudioMimeType(rawMime?: string, fileName?: string): NormalizedAudioMime {
  let cleanMime = (rawMime || '').trim().toLowerCase();
  let codec: string | undefined = undefined;

  // Extract codec parameters if present (e.g., audio/webm; codecs="opus" or audio/webm;codecs=opus)
  if (cleanMime.includes(';')) {
    const parts = cleanMime.split(';');
    cleanMime = parts[0].trim();
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part.startsWith('codecs=') || part.startsWith('codec=')) {
        codec = part.replace(/^codecs?=["']?/, '').replace(/["']?$/, '').toLowerCase();
      }
    }
  }

  // If MIME is missing or generic octet-stream, infer from file extension
  if (!cleanMime || cleanMime === 'application/octet-stream' || cleanMime === 'audio/unknown') {
    if (fileName) {
      const ext = path.extname(fileName).toLowerCase();
      if (ext === '.opus') cleanMime = 'audio/opus';
      else if (ext === '.ogg' || ext === '.oga') cleanMime = 'audio/ogg';
      else if (ext === '.webm') cleanMime = 'audio/webm';
      else if (ext === '.mp3') cleanMime = 'audio/mpeg';
      else if (ext === '.wav') cleanMime = 'audio/wav';
      else if (ext === '.m4a') cleanMime = 'audio/mp4';
      else if (ext === '.mp4') cleanMime = 'audio/mp4';
      else if (ext === '.aac') cleanMime = 'audio/aac';
      else if (ext === '.flac') cleanMime = 'audio/flac';
    }
  }

  // Map to container MIME, safe file extension, and Gemini compatibility
  switch (cleanMime) {
    case 'audio/webm':
      return {
        containerMime: 'audio/webm',
        codec: codec || 'opus',
        extension: '.webm',
        isGeminiDirectSupported: true,
        isConversionRecommended: false
      };
    case 'audio/ogg':
    case 'audio/oga':
    case 'application/ogg':
      return {
        containerMime: 'audio/ogg',
        codec: codec || (cleanMime.includes('opus') ? 'opus' : undefined),
        extension: '.ogg',
        isGeminiDirectSupported: true,
        isConversionRecommended: false
      };
    case 'audio/opus':
      return {
        containerMime: 'audio/opus',
        codec: 'opus',
        extension: '.opus',
        // Raw Opus stream or custom container is best converted to WAV for standard Gemini intake
        isGeminiDirectSupported: false,
        isConversionRecommended: true
      };
    case 'audio/mp3':
    case 'audio/mpeg':
    case 'audio/mpg':
      return {
        containerMime: 'audio/mpeg',
        extension: '.mp3',
        isGeminiDirectSupported: true,
        isConversionRecommended: false
      };
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return {
        containerMime: 'audio/wav',
        extension: '.wav',
        isGeminiDirectSupported: true,
        isConversionRecommended: false
      };
    case 'audio/aac':
    case 'audio/x-aac':
      return {
        containerMime: 'audio/aac',
        extension: '.aac',
        isGeminiDirectSupported: true,
        isConversionRecommended: false
      };
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return {
        containerMime: 'audio/mp4',
        extension: '.m4a',
        isGeminiDirectSupported: true,
        isConversionRecommended: false
      };
    case 'audio/flac':
    case 'audio/x-flac':
      return {
        containerMime: 'audio/flac',
        extension: '.flac',
        isGeminiDirectSupported: true,
        isConversionRecommended: false
      };
    default:
      // Fallback: If unknown, recommend conversion to standard WAV
      return {
        containerMime: cleanMime || 'audio/wav',
        codec,
        extension: fileName ? (path.extname(fileName).toLowerCase() || '.audio') : '.audio',
        isGeminiDirectSupported: false,
        isConversionRecommended: true
      };
  }
}

/**
 * Converts any supported audio file to standard 16kHz mono WAV format using FFmpeg.
 * @param inputPath Path to the input audio file.
 * @param outputPath Path to the output WAV file.
 * @param options Audio configuration options (sampleRate, channels).
 * @returns A promise that resolves to the output path.
 */
export const convertAudioToWav = (
  inputPath: string, 
  outputPath: string, 
  options: { sampleRate?: number; channels?: number } = {}
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const ffmpegStatus = isFfmpegAvailable();
    if (!ffmpegStatus.available) {
      return reject(new Error("Audio conversion is unavailable because the FFmpeg runtime is not available."));
    }

    const sampleRate = options.sampleRate || 16000;
    const channels = options.channels || 1;

    ffmpeg(inputPath)
      .toFormat('wav')
      .audioCodec('pcm_s16le')
      .audioFrequency(sampleRate)
      .audioChannels(channels)
      .on('start', (commandLine) => {
        console.log(`[AudioUtils] Spawned FFmpeg conversion command: ${commandLine}`);
      })
      .on('error', (err: any, stdout?: string, stderr?: string) => {
        console.error(`[AudioUtils] FFmpeg conversion failed: ${err.message}`);
        if (stderr) {
          console.error(`[AudioUtils] FFmpeg stderr summary: ${stderr.slice(-300).trim()}`);
        }
        reject(err);
      })
      .on('end', () => {
        console.log(`[AudioUtils] Conversion finished successfully -> ${outputPath}`);
        resolve(outputPath);
      })
      .save(outputPath);
  });
};

/**
 * Backward compatibility alias for convertAudioToWav.
 */
export const convertOpusToWav = (inputPath: string, outputPath: string): Promise<string> => {
  return convertAudioToWav(inputPath, outputPath);
};
