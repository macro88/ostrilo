import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";

/**
 * Keeps a request that cannot be rendered from taking the whole window with it.
 *
 * There was no error boundary anywhere in the approval tree —
 * `src/extension/approval/main.tsx` mounts `<ApprovalApp />` directly, and the
 * only boundary in `src/` is `ModelFallbackBoundary` in `Logo.tsx`. A request
 * that threw while rendering blanked the entire window, which removed the Deny
 * control for every OTHER queued request too. Introducing a request shape the
 * detail views were not written for is exactly the moment to add one.
 *
 * THE DENY PATH MUST SURVIVE. A user who cannot read a request must still be
 * able to refuse it — that is the whole point of this component, and it is why
 * the fallback renders a Deny button rather than only an apology. The unreadable
 * request is the one most deserving of refusal.
 */

interface ApprovalErrorBoundaryProps {
  children: ReactNode;
  /** Refuses the request that failed to render. */
  onDeny: () => void;
  /** Returns to the queue, so the other requests stay actionable. */
  onBack?: () => void;
  /** Changes when the displayed request changes, so the boundary can reset. */
  resetKey?: string | null;
}

interface ApprovalErrorBoundaryState {
  failed: boolean;
}

export class ApprovalErrorBoundary extends Component<
  ApprovalErrorBoundaryProps,
  ApprovalErrorBoundaryState
> {
  state: ApprovalErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ApprovalErrorBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(previous: ApprovalErrorBoundaryProps) {
    // Selecting a different request clears the failure, so one bad entry does
    // not make every later selection look broken.
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Message and component stack only. A thrown object in this tree can carry
    // request content, and this console belongs to a window whose entire job is
    // to show the user something trustworthy.
    console.error(
      "[Approval] Failed to render request:",
      error.message,
      info.componentStack
    );
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        className="flex h-full min-h-0 flex-col bg-background"
        data-testid="approval-render-error"
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-6">
          <div className="rounded-[10px] bg-[var(--ink-amber-soft)] p-4 text-[var(--ink-amber)]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-2 text-xs font-semibold">
                <p>This request could not be displayed.</p>
                <p>
                  Do not approve something you cannot read. Deny it, and the
                  other pending requests are unaffected.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 space-y-3 border-t border-border bg-card p-4">
          <Button
            variant="outline"
            onClick={this.props.onDeny}
            className="h-12 w-full"
          >
            <X className="h-4 w-4" />
            Deny this request
          </Button>
          {this.props.onBack && (
            <Button
              variant="ghost"
              onClick={this.props.onBack}
              className="w-full"
            >
              Back to the queue
            </Button>
          )}
        </div>
      </div>
    );
  }
}
