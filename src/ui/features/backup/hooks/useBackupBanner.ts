import { useCallback, useEffect, useState } from "react";
import {
  dismissBackupBanner,
  isBackupBannerVisible,
  readBackupBannerDismissed,
} from "../backup-banner";
import { useKeyBackupStatus } from "./useKeyBackupStatus";

interface BackupBanner {
  visible: boolean;
  dismiss: () => void;
}

/**
 * Whether Home asks the selected key to be backed up.
 *
 * The banner stays hidden until the dismissal flag has been read for this key,
 * so a key dismissed earlier in the session never flashes it. The flag is
 * remembered against the key it was read for: switching keys re-reads, and a
 * dismissal of one never carries to another.
 */
export function useBackupBanner(keyId: string | undefined): BackupBanner {
  const status = useKeyBackupStatus(keyId);
  const [read, setRead] = useState<{ keyId: string; dismissed: boolean } | null>(
    null
  );

  useEffect(() => {
    if (!keyId) return;
    let cancelled = false;
    void readBackupBannerDismissed(keyId).then((dismissed) => {
      if (!cancelled) setRead({ keyId, dismissed });
    });
    return () => {
      cancelled = true;
    };
  }, [keyId]);

  const dismiss = useCallback(() => {
    if (!keyId) return;
    setRead({ keyId, dismissed: true });
    void dismissBackupBanner(keyId);
  }, [keyId]);

  const settled = read !== null && read.keyId === keyId;
  return {
    visible: settled && isBackupBannerVisible(status, read.dismissed),
    dismiss,
  };
}
