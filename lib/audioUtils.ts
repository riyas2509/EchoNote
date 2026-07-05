import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

/**
 * Converts an OPUS audio file to WAV format.
 * @param inputPath Path to the input OPUS file.
 * @param outputPath Path to the output WAV file.
 * @returns A promise that resolves to the output path.
 */
export const convertOpusToWav = (inputPath: string, outputPath: string): Promise<string> => {
  console.log(`[AudioUtils] Converting OPUS to WAV: ${inputPath} -> ${outputPath}`);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')
      .on('start', (commandLine) => {
        console.log(`[AudioUtils] Spawned FFmpeg with command: ${commandLine}`);
      })
      .on('progress', (progress) => {
        console.log(`[AudioUtils] Processing: ${progress.percent}% done`);
      })
      .on('error', (err) => {
        console.error(`[AudioUtils] FFmpeg error: ${err.message}`);
        reject(err);
      })
      .on('end', () => {
        console.log('[AudioUtils] Conversion finished successfully');
        resolve(outputPath);
      })
      .save(outputPath);
  });
};
