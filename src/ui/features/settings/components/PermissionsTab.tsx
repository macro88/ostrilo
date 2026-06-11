import { Shield } from "lucide-react";
import { OriginPolicyTable } from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { LoadingSpinner } from "@/ui/components/common/LoadingSpinner";
import { EmptyState } from "@/ui/components/common/EmptyState";

export function PermissionsTab() {
  const {
    settings,
    isLoading,
    setSessionGrant,
    removeOriginPolicy,
    setPerKindRule,
  } = useAppSettings();

  if (isLoading) {
    return (
      <div className="py-12">
        <LoadingSpinner label="Loading settings..." />
      </div>
    );
  }

  const handleSetPerKindRule = (origin: string, kind: number, rule: string) => {
    // Validate rule is a valid mode
    if (rule === "allow" || rule === "deny" || rule === "ask") {
      setPerKindRule(origin, kind, rule);
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
          onRemove={removeOriginPolicy}
          onToggleSession={setSessionGrant}
          onSetPerKindRule={handleSetPerKindRule}
        />
      )}
    </div>
  );
}
