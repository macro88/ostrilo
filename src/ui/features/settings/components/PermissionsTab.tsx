import { Globe } from "lucide-react";
import type { TrustLevel } from "@/domain/types";
import { useCallback, useEffect, useState } from "react";
import { policyGetSessionGrants } from "@/infrastructure/messaging/client";
import {
  OriginPolicyTable,
  DisclosureHistory,
} from "@/ui/features/settings/components/shared";
import {
  SettingsLoading,
  SettingsSection,
  SettingsTabHeader,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { useAppSettings } from "@/hooks/useAppSettings";
import { SealMark } from "@/ui/components/common/SealMark";
import { ReauthDialog } from "@/ui/components/dialogs/ReauthDialog";
import { useReauth } from "@/ui/hooks/useReauth";

export function PermissionsTab() {
  const {
    settings,
    isLoading,
    setSessionGrant,
    removeOriginPolicy,
    setPerKindRule,
    updateOriginTrustLevel,
    revokeIdentityDisclosure,
  } = useAppSettings();
  const reauth = useReauth();

  // Read from the background rather than from the stored display flag, and
  // re-read after every change, so an expired grant stops showing as live.
  const [sessionGrants, setSessionGrants] = useState<
    Array<{ origin: string; expiresAt: number }>
  >([]);
  const refreshGrants = useCallback(async () => {
    try {
      setSessionGrants(await policyGetSessionGrants());
    } catch {
      // A locked or unreachable background has no live grants to show.
      setSessionGrants([]);
    }
  }, []);
  useEffect(() => {
    void refreshGrants();
  }, [refreshGrants]);

  if (isLoading) {
    return <SettingsLoading />;
  }

  // `allow` and an enabled session grant are standing permissions to sign
  // without prompting. Both are password-gated in the background; `deny`,
  // `ask` and turning a grant off only ever add friction, so they are free.
  const handleSetPerKindRule = async (
    origin: string,
    kind: number,
    rule: string
  ) => {
    if (rule !== "allow" && rule !== "deny" && rule !== "ask") return;
    if (rule !== "allow") {
      await setPerKindRule(origin, kind, rule);
      return;
    }
    try {
      await reauth.request(
        {
          action: `Always allow kind ${kind} for ${origin}.`,
          consequence: "Events of that kind will be signed without a prompt.",
        },
        (password) => setPerKindRule(origin, kind, rule, password)
      );
    } catch {
      // Cancelled. The rule is unchanged.
    }
  };

  // Raising to `high` is a standing grant to sign the high-trust kinds
  // without prompting, so it costs a password. Lowering trust does not:
  // a user revoking access should not have to find their password first.
  const handleUpdateTrust = async (origin: string, trustLevel: string) => {
    if (trustLevel !== "high") {
      await updateOriginTrustLevel(origin, trustLevel as TrustLevel);
      return;
    }
    try {
      await reauth.request(
        {
          action: `Raise ${origin} to high trust.`,
          consequence:
            "It will sign the high-trust event kinds without prompting you again.",
        },
        (password) =>
          updateOriginTrustLevel(origin, trustLevel as TrustLevel, password)
      );
    } catch {
      // Cancelled. The trust level is unchanged.
    }
  };

  const handleToggleSession = async (origin: string, enabled: boolean) => {
    if (!enabled) {
      await setSessionGrant(origin, false);
      await refreshGrants();
      return;
    }
    try {
      await reauth.request(
        {
          action: `Grant ${origin} a signing session.`,
          consequence:
            "It will sign every unprotected kind without prompting until the session expires or the vault locks.",
        },
        (password) => setSessionGrant(origin, true, password)
      );
      await refreshGrants();
    } catch {
      // Cancelled. No grant was created.
    }
  };

  const hasOrigins = settings.origins && settings.origins.length > 0;

  return (
    <div>
      <SettingsTabHeader
        title="Permissions"
        lede="Each site that has asked you to sign gets a trust level and, if you want, a rule per event kind."
      />

      <SettingsSection label="Sites">
        {!hasOrigins ? (
          // The empty state is a row in the card the list would fill, not a
          // centred block: the first site to ask will take exactly this place.
          <div className="ink-card">
            <div className="ink-row py-5">
              <SealMark icon={Globe} tone="muted" size="lg" />
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold leading-snug text-foreground">
                  No sites yet
                </h4>
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">
                  The first site that asks you to sign will appear here, with
                  its trust level and rules.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <OriginPolicyTable
            origins={settings.origins}
            mediumAllowKinds={settings.mediumAllowKinds}
            onUpdateTrust={handleUpdateTrust}
            sessionGrants={sessionGrants}
            onRemove={removeOriginPolicy}
            onToggleSession={handleToggleSession}
            onSetPerKindRule={handleSetPerKindRule}
            onRevokeDisclosure={revokeIdentityDisclosure}
          />
        )}
      </SettingsSection>

      <SettingsSection
        label="Public key reads"
        note="Your public key is not a secret. This list is about linkage: which sites have tied your browsing to that identity."
      >
        <DisclosureHistory />
      </SettingsSection>

      <ReauthDialog {...reauth.dialogProps} />
    </div>
  );
}
