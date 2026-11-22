import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock, pickVoiceFormat, VOICE_MESSAGE_MAX_SECONDS, VOICE_MESSAGE_NAME } from './voiceMessage';

/** Whether this browser can record a voice message at all. */
export function canRecordVoice(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && pickVoiceFormat((m) => MediaRecorder.isTypeSupported(m)) !== null;
}

interface VoiceRecorderProps {
  onSend: (file: File) => void;
  onCancel: () => void;
  /** The microphone could not be opened (refused, missing, busy). */
  onError: (err: unknown) => void;
}

/** Records from the moment it mounts; the composer swaps it in for the text box. */
export function VoiceRecorder({ onSend, onCancel, onError }: VoiceRecorderProps) {
  const { t } = useTranslation(['chat']);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sendOnStop = useRef(false);
  const handlers = useRef({ onSend, onCancel, onError });
  handlers.current = { onSend, onCancel, onError };

  useEffect(() => {
    const format = pickVoiceFormat((m) => MediaRecorder.isTypeSupported(m));
    if (!format) { handlers.current.onError(new Error('No recording format')); return; }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    const chunks: Blob[] = [];

    void navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
      if (disposed) { s.getTracks().forEach((tr) => tr.stop()); return; }
      stream = s;
      const rec = new MediaRecorder(s, { mimeType: format.mime, audioBitsPerSecond: 32_000 });
      recorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        s.getTracks().forEach((tr) => tr.stop());
        if (!sendOnStop.current || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: format.mime.split(';')[0] });
        handlers.current.onSend(new File([blob], `${VOICE_MESSAGE_NAME}.${format.ext}`, { type: blob.type }));
      };
      rec.start(1000);
      const started = Date.now();
      timer = setInterval(() => {
        const elapsed = (Date.now() - started) / 1000;
        setSeconds(elapsed);
        if (elapsed >= VOICE_MESSAGE_MAX_SECONDS) { sendOnStop.current = true; rec.stop(); clearInterval(timer); }
      }, 250);
    }, (err: unknown) => { if (!disposed) handlers.current.onError(err); });

    return () => {
      disposed = true;
      clearInterval(timer);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const finish = (send: boolean) => {
    sendOnStop.current = send;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    if (!send) onCancel();
  };

  return (
    <div className="flex-1 min-w-0 h-11 flex items-center gap-2" role="status" aria-live="polite">
      <button
        type="button"
        onClick={() => finish(false)}
        aria-label={t('chat:voiceMessage.discard')}
        className="w-10 h-10 shrink-0 rounded-[12px] text-txt-tertiary hover:text-accent-rose flex items-center justify-center"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
      </button>
      <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-accent-rose animate-pulse" aria-hidden="true" />
      <span className="flex-1 text-[15px] font-semibold text-txt-primary tabular-nums">
        {t('chat:voiceMessage.recording', { time: formatClock(seconds) })}
      </span>
      <button
        type="button"
        onClick={() => finish(true)}
        aria-label={t('chat:voiceMessage.send')}
        className="w-10 h-10 desktop:w-[34px] desktop:h-[34px] shrink-0 rounded-[12px] bg-accent-primary hover:bg-accent-primary-hover text-txt-on-primary flex items-center justify-center"
      >
        <svg className="rtl:-scale-x-100" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" /></svg>
      </button>
    </div>
  );
}
