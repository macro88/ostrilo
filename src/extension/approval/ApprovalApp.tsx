import { ApprovalPrompt } from "@/ui/features/approval/components/ApprovalPrompt";

/**
 * Root component for the approval popup
 * Renders the ApprovalPrompt component which handles fetching
 * the pending request and displaying the approval UI
 */
export default function ApprovalApp() {
  return (
    <div className="w-[400px] h-[600px] bg-background text-foreground overflow-hidden">
      <ApprovalPrompt />
    </div>
  );
}
