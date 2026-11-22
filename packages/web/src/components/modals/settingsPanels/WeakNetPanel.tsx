import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../../i18n/formatters';
import { Toggle } from '../../ui/Toggle';
import {
  SLOW_RTT_MS,
  useWeakNetStore,
  weakNetActive,
  type WeakNetFeature,
  type WeakNetMode,
} from '../../../stores/weakNetStore';

const MODES: WeakNetMode[] = ['auto', 'always', 'off'];
const GROUPS: { id: 'voice' | 'chat'; features: WeakNetFeature[] }[] = [
  { id: 'voice', features: ['voiceOnly', 'lighterVoice'] },
  { id: 'chat', features: ['tapToLoad', 'shrinkImages'] },
];

/** 0–4 bars from the last round trip: an unknown or failed probe shows none. */
function bars(rttMs: number | null): number {
  if (rttMs === null) return 0;
  if (rttMs < 150) return 4;
  if (rttMs < 350) return 3;
  if (rttMs <= SLOW_RTT_MS) return 2;
  return 1;
}

export function WeakNetPanel() {
  const { t } = useTranslation(['settings']);
  const f = useFormatters();
  const mode = useWeakNetStore((s) => s.mode);
  const features = useWeakNetStore((s) => s.features);
  const rttMs = useWeakNetStore((s) => s.rttMs);
  const active = useWeakNetStore((s) => weakNetActive(s));
  const setMode = useWeakNetStore((s) => s.setMode);
  const setFeature = useWeakNetStore((s) => s.setFeature);
  const probe = useWeakNetStore((s) => s.probe);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    try { await probe(); } finally { setTesting(false); }
  };
  useEffect(() => { void test(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one fresh reading when the page opens

  const detected = useWeakNetStore((s) => s.detected);
  const lit = bars(rttMs);
  const weak = rttMs === null || detected;
  const headline = rttMs === null
    ? t('settings:weakNet.now.unknown')
    : weak ? t('settings:weakNet.now.weak') : t('settings:weakNet.now.good');
  const detail = [
    rttMs === null ? null : t('settings:weakNet.now.rtt', { ms: f.formatNumber(rttMs) }),
    active ? t(`settings:weakNet.now.on.${mode === 'always' ? 'always' : 'auto'}`) : t('settings:weakNet.now.off'),
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <div className="mb-6">
        <h2 className="font-display font-extrabold text-[32px] leading-tight tracking-[-0.03em] text-txt-primary">{t('settings:weakNet.title')}</h2>
        <p className="text-[15px] text-txt-tertiary mt-1">{t('settings:weakNet.subtitle')}</p>
      </div>

      <section
        className={`rounded-[22px] px-5 py-4 flex flex-wrap items-center gap-4 -rotate-[0.4deg] ${weak ? 'bg-accent-amber text-[#1A0E07]' : 'bg-accent-mint text-[#0B2219]'}`}
        aria-live="polite"
      >
        <div dir="ltr" className="flex items-end gap-1 h-[34px]" role="img" aria-label={t('settings:weakNet.now.bars', { count: lit })}>
          {[10, 18, 26, 34].map((h, i) => (
            <span key={h} className={`w-2 rounded-[3px] ${i < lit ? 'bg-current' : 'bg-current opacity-25'}`} style={{ height: h }} />
          ))}
        </div>
        <div className="flex-1 min-w-[200px] flex flex-col">
          <span className="font-display font-extrabold text-[20px]">{headline}</span>
          <span className="text-sm font-semibold">{detail}</span>
        </div>
        <button
          type="button"
          onClick={() => void test()}
          disabled={testing}
          className="h-[42px] px-4 rounded-[13px] bg-[#1A0E07] text-txt-primary font-extrabold disabled:opacity-60"
        >
          {testing ? t('settings:weakNet.now.testing') : t('settings:weakNet.now.test')}
        </button>
      </section>

      <div role="radiogroup" aria-label={t('settings:weakNet.mode.label')} className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        {MODES.map((m) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMode(m)}
              className={`min-h-[100px] p-4 rounded-[20px] text-start flex flex-col gap-1.5 transition-transform ${
                on ? 'bg-accent-primary text-txt-on-primary -rotate-1 shadow-[4px_4px_0_rgb(var(--text-primary))]' : 'border-2 border-border-hard bg-surface-elevated text-txt-primary'
              }`}
            >
              <span className="font-display font-extrabold text-[18px]">{t(`settings:weakNet.mode.${m}.label`)}</span>
              <span className="text-[13px] leading-snug opacity-85">{t(`settings:weakNet.mode.${m}.description`)}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        {GROUPS.map((g) => (
          <section key={g.id} className="rounded-[22px] bg-surface-elevated px-5 py-4">
            <h3 className="font-display font-extrabold text-[19px] text-txt-primary mb-1.5">{t(`settings:weakNet.groups.${g.id}`)}</h3>
            {g.features.map((feature) => (
              <div key={feature} className="py-3 border-t-2 border-border-hard flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-extrabold text-[15px] text-txt-primary">{t(`settings:weakNet.features.${feature}.label`)}</div>
                  <div className="text-[13px] text-txt-tertiary">{t(`settings:weakNet.features.${feature}.description`)}</div>
                </div>
                <Toggle
                  enabled={features[feature]}
                  onChange={(on) => setFeature(feature, on)}
                  disabled={mode === 'off'}
                  ariaLabel={t(`settings:weakNet.features.${feature}.label`)}
                />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
