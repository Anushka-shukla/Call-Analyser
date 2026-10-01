// Splits a stereo call recording into two mono tracks (one per speaker) with ffmpeg.
// Mono recordings come back as a single track, so the pipeline keeps working either way.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

export type Track = { channel: 'left' | 'right' | 'mono'; data: Buffer; contentType: string };

// Which side of a stereo recording is the agent. Confirm by listening to a split recording.
export const agentChannel = (): 'left' | 'right' => (process.env.AGENT_CHANNEL === 'right' ? 'right' : 'left');
export const dualMode = () => process.env.AUDIO_MODE !== 'mono';

function run(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary not found'));
    const p = spawn(ffmpegPath, args);
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

// Reads the channel count from ffmpeg's description of the input stream.
export function channelsFromProbe(stderr: string): number {
  const line = stderr.split('\n').find((l) => l.includes('Audio:')) ?? '';
  if (/\bmono\b/.test(line) || /\b1 channels\b/.test(line)) return 1;
  if (/\bstereo\b/.test(line) || /\b2 channels\b/.test(line)) return 2;
  return 1;
}

export async function splitTracks(audio: ArrayBuffer | Buffer, contentType: string): Promise<Track[]> {
  const input = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
  if (!dualMode()) return [{ channel: 'mono', data: input, contentType }];

  const dir = await mkdtemp(path.join(tmpdir(), 'call-'));
  try {
    const src = path.join(dir, contentType.includes('wav') ? 'in.wav' : 'in.mp3');
    await writeFile(src, input);

    const probe = await run(['-hide_banner', '-i', src]);
    if (channelsFromProbe(probe.stderr) < 2) return [{ channel: 'mono', data: input, contentType }];

    const left = path.join(dir, 'left.mp3');
    const right = path.join(dir, 'right.mp3');
    const out = await run([
      '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-filter_complex', '[0:a]channelsplit=channel_layout=stereo[L][R]',
      '-map', '[L]', '-ar', '16000', '-b:a', '48k', left,
      '-map', '[R]', '-ar', '16000', '-b:a', '48k', right,
    ]);
    if (out.code !== 0) throw new Error(`ffmpeg split failed: ${out.stderr.slice(0, 300)}`);

    return [
      { channel: 'left', data: await readFile(left), contentType: 'audio/mpeg' },
      { channel: 'right', data: await readFile(right), contentType: 'audio/mpeg' },
    ];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}