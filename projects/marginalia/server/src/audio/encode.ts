import { spawn } from "node:child_process";
import fs from "node:fs/promises";

/**
 * AUDIO.md's encoding rule: "Opus via `ffmpeg` if present, WAV otherwise" —
 * checked once per process (ffmpeg's presence doesn't change mid-run) so
 * the render loop isn't spawning a probe process per sentence.
 */
let ffmpegAvailable: Promise<boolean> | null = null;

function checkFfmpeg(): Promise<boolean> {
  if (!ffmpegAvailable) {
    ffmpegAvailable = new Promise((resolve) => {
      const proc = spawn("ffmpeg", ["-version"]);
      proc.on("error", () => resolve(false));
      proc.on("exit", (code) => resolve(code === 0));
    });
  }
  return ffmpegAvailable;
}

function encodeToOpus(wav: Uint8Array, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "wav",
      "-i",
      "pipe:0",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      outPath,
    ]);
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    proc.stdin.write(wav);
    proc.stdin.end();
  });
}

/**
 * Writes one synthesized sentence's audio to `<pathWithoutExt>.<ext>`,
 * returning which extension it actually used. Never throws on a missing or
 * misbehaving ffmpeg — that degrades to the WAV fallback rather than
 * failing the whole render (AUDIO.md: "WAV fallback means audio never
 * hard-depends on it").
 */
export async function writeEncodedSegment(
  wav: Uint8Array,
  pathWithoutExt: string,
): Promise<"opus" | "wav"> {
  if (await checkFfmpeg()) {
    try {
      await encodeToOpus(wav, `${pathWithoutExt}.opus`);
      return "opus";
    } catch {
      // Fall through to the WAV write below.
    }
  }
  await fs.writeFile(`${pathWithoutExt}.wav`, wav);
  return "wav";
}
