import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { useWeakNetFeature } from '../../stores/weakNetStore';

interface TapToLoadProps {
  /** Bytes, when known, so the reader can judge whether it is worth it. */
  size?: number | null | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
  children: ReactNode;
}

/**
 * In weak internet mode an image or GIF is not fetched until tapped; outside it
 * the children render as they are. Each one is loaded on its own tap.
 */
export function TapToLoad({ size, width, height, children }: TapToLoadProps) {
  const { t } = useTranslation(['chat']);
  const { formatBytes } = useFormatters();
  const hold = useWeakNetFeature('tapToLoad');
  const [loaded, setLoaded] = useState(false);
  if (!hold || loaded) return <>{children}</>;

  const label = size ? t('chat:tapToLoad.withSize', { size: formatBytes(size) }) : t('chat:tapToLoad.label');
  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      aria-label={label}
      className="mt-1 relative overflow-hidden rounded-[18px] bg-interactive-muted flex items-center justify-center max-w-full"
      style={{
        width: width && height ? Math.min(width, 240) : 240,
        aspectRatio: width && height ? `${width}/${height}` : '8/5',
        maxHeight: 300,
      }}
    >
      <span className="relative px-3 py-2 rounded-xl bg-surface-base text-txt-primary font-extrabold text-[13px] flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v12M6 11l6 6 6-6" /></svg>
        {label}
      </span>
    </button>
  );
}
