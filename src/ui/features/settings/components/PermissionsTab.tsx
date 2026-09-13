import { Shield } from "lucide-react";
import type { TrustLevel } from "@/domain/types";
import { OriginPolicyTable } from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { LoadingSpinner } from "@/ui/components/common/LoadingSpinner";
import { EmptyState } from "@/ui/components/common/EmptyState";
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
  } = useAppSettings();
  const reauth = useReauth();

  if (isLoading) {
    return (
      <div className="py-12">
        <LoadingSpinner label="Loading settings..." />
      </div>
    );
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
    } catch {
      // Cancelled. No grant was created.
    }
  };

  const hasOrigins = settings.origins && settings.origins.length > 0;

  return (
    <div className="ink-card p-4 space-y-6">
      <div>
        <h2 className="screen-title">Permissions</h2>
        <p className="text-sm text-muted-foreground">
          Manage per-origin policies and trust levels
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground h-8 w-8">
          <Shield className="h-4 w-4" />
        </div>
        <h3 className="font-medium">Per-Origin Policies</h3>
      </div>

      {!hasOrigins ? (
        <EmptyState
          icon={Shield}
          title="No Origins Configured"
          description="Origin policies will appear here once you interact with websites that request Nostr signing. You can configure trust levels and per-kind rules for each origin."
        />
      ) : (
        <OriginPolicyTable
          origins={settings.origins}
          mediumAllowKinds={settings.mediumAllowKinds}
          onUpdateTrust={handleUpdateTrust}
          onRemove={removeOriginPolicy}
          onToggleSession={handleToggleSession}
          onSetPerKindRule={handleSetPerKindRule}
        />
      )}

      <ReauthDialog {...reauth.dialogProps} />
    </div>
  );
}
