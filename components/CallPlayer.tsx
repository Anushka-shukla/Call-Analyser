'use client';
import { useRef, useState } from 'react';

type Seg = { idx: number; speaker: string | null; start_ms: number | null; end_ms: number | null; text_original: string | null; text_en: string | null };

function mmss(ms: number | null) {
  const s = Math.round((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function CallPlayer({ src, segments, agentSpeaker }: { src: string | null; segments: Seg[]; agentSpeaker: string | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const onTime = () => {
    const t = (audio.current?.currentTime ?? 0) * 1000;
    const seg = segments.find((s) => (s.start_ms ?? 0) <= t && t < (s.end_ms ?? 0));
    setActive(seg ? seg.idx : null);
  };

  const jump = (s: Seg) => {
    if (!audio.current) return;
    audio.current.currentTime = (s.start_ms ?? 0) / 1000;
    audio.current.play().catch(() => {});
  };

  const name = (sp: string | null) => {
    if (sp === 'agent' || (sp && agentSpeaker && sp === agentSpeaker)) return 'Agent';
    if (sp === 'customer') return 'Customer';
    return sp === null ? 'Unknown' : `Customer (${sp})`;
  };

  return (
    <div>
      <div className="player">
        {src ? <audio ref={audio} controls preload="metadata" src={src} onTimeUpdate={onTime} /> : <p className="small">Recording not saved yet.</p>}
      </div>
      {segments.length === 0 ? <p className="small">No transcript yet.</p> : segments.map((s) => {
        const isAgent = s.speaker === 'agent' || (!!agentSpeaker && s.speaker === agentSpeaker);
        const same = !s.text_en || s.text_en === s.text_original;
        return (
          <div
            key={s.idx}
            className={`seg${active === s.idx ? ' active' : ''}`}
            onClick={() => jump(s)}
            onKeyDown={(e) => { if (e.key === 'Enter') jump(s); }}
            role="button"
            tabIndex={0}
            aria-label={`Play from ${mmss(s.start_ms)}`}
          >
            <span className="t">{mmss(s.start_ms)}</span>
            <span className={`who${isAgent ? ' agent' : ''}`}>{name(s.speaker)}</span>
            <span>{same ? s.text_original : s.text_en}</span>
            <span className="orig">{same ? '' : s.text_original}</span>
          </div>
        );
      })}
    </div>
  );
}