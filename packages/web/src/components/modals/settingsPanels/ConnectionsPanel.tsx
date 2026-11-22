import { useTranslation } from 'react-i18next';
import { ConnectedInstances } from '../ConnectedInstances';

export function ConnectionsPanel() {
  const { t } = useTranslation(['settings']);
  return (
    <div className="space-y-5">
      <h2 className="font-display font-extrabold text-[32px] leading-tight tracking-[-0.03em] text-txt-primary mb-6">{t('settings:connections.title')}</h2>
      <ConnectedInstances />
    </div>
  );
}
