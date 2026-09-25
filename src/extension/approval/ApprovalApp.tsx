import { ApprovalPrompt } from "@/ui/features/approval/components/ApprovalPrompt";
import { useTheme } from "@/ui/hooks/useTheme";

/**
 * Root component for the approval popup
 * Renders the ApprovalPrompt component which handles fetching
 * the pending request and displaying the approval UI
 */
export default function ApprovalApp() {
  // Apply theme based on settings and system preference
  useTheme();

  return (
    <div className="app-canvas h-screen min-h-[600px] w-screen min-w-[400px] overflow-hidden bg-background text-foreground">
      <ApprovalPrompt />
    </div>
  );
}
