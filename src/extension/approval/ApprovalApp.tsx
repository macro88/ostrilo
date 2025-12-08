import { ApprovalPrompt } from "@/ui/features/approval/components/ApprovalPrompt";

/**
 * Root component for the approval popup
 * Renders the ApprovalPrompt component which handles fetching
 * the pending request and displaying the approval UI
 */
export default function ApprovalApp() {
  return (
    <div className="w-[400px] min-h-[480px] bg-background text-foreground">
      <ApprovalPrompt />
    </div>
  );
}
