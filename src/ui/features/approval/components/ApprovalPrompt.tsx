import { useReducer, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  getAllApprovalRequests,
  resolveApprovalRequest,
  getApprovalCount,
  listKeys,
  reportActivity,
} from "@/infrastructure/messaging/client";
import type { PendingRequest, ApprovalAction, KeyRecord } from "@/domain/types";
import { isDisclosureRequest, isSigningRequest } from "@/domain/types";
import { AlertTriangle } from "lucide-react";
import { QueueListView } from "./QueueListView";
import { EventDetailView } from "./EventDetailView";
import { DisclosureDetailView } from "./DisclosureDetailView";
import { ApprovalErrorBoundary } from "./ApprovalErrorBoundary";
import { describeOriginTrust, type OriginTrust } from "./useApprovalDisplay";
import { browser } from "wxt/browser";
import { Logo } from "@/ui/components/logo/Logo";
import { SealMark } from "@/components/common/SealMark";
import { useAppSettings } from "@/ui/hooks/useAppSettings";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import { cn } from "@/lib/utils";

interface ApprovalPromptState {
  requests: PendingRequest[];
  selectedRequestId: string | null;
  isLoading: boolean;
  isResolving: boolean;
  error: string | null;
  nowSeconds: number;
  selectedKey: KeyRecord | null;
  showCompactDetail: boolean;
}

type ApprovalPromptAction =
  | { type: "loadStart" }
  | { type: "loadSuccess"; requests: PendingRequest[]; selectedKey: KeyRecord | null }
  | { type: "loadError"; error: string }
  | { type: "tick"; nowSeconds: number }
  | { type: "resolveStart" }
  | { type: "resolveEnd" }
  | { type: "selectRequest"; id: string }
  | { type: "showList" };

const initialApprovalPromptState: ApprovalPromptState = {
  requests: [],
  selectedRequestId: null,
  isLoading: true,
  isResolving: false,
  error: null,
  nowSeconds: Math.floor(Date.now() / 1000),
  selectedKey: null,
  showCompactDetail: false,
};

function approvalPromptReducer(
  state: ApprovalPromptState,
  action: ApprovalPromptAction
): ApprovalPromptState {
  switch (action.type) {
    case "loadStart":
      return { ...state, isLoading: true, error: null };
    case "loadSuccess": {
      const selectedStillPending =
        state.selectedRequestId &&
        action.requests.some((request) => request.id === state.selectedRequestId);

      // A single request arriving into a window that had NOTHING on screen
      // opens directly: one request is one decision, and a list of one is a
      // detour. This fires only from an empty list - the initial load, or a
      // request landing while the empty state shows - so the approve button
      // can never appear under a cursor that was just pressing something.
      const loneArrival =
        state.requests.length === 0 && action.requests.length === 1
          ? action.requests[0]
          : null;

      // Deliberately NOT auto-selecting when the previous selection is gone
      // and other requests remain. The detail pane used to instantly re-bind
      // to the next queued request, so the approve button the user had just
      // clicked reappeared under their cursor bound to a DIFFERENT event. One
      // more click and they have approved something they never read. Going
      // from several requests to one after a resolution is exactly that case,
      // so `loneArrival` requires the list to have been empty.
      return {
        ...state,
        requests: action.requests,
        selectedKey: action.selectedKey,
        selectedRequestId: selectedStillPending
          ? state.selectedRequestId
          : (loneArrival?.id ?? null),
        showCompactDetail: selectedStillPending
          ? state.showCompactDetail
          : loneArrival !== null,
        isLoading: false,
        error: null,
      };
    }
    case "loadError":
      return { ...state, error: action.error, isLoading: false };
    case "tick":
      return { ...state, nowSeconds: action.nowSeconds };
    case "resolveStart":
      return { ...state, isResolving: true };
    case "resolveEnd":
      return { ...state, isResolving: false };
    case "selectRequest":
      return {
        ...state,
        selectedRequestId: action.id,
        showCompactDetail: true,
      };
    case "showList":
      return { ...state, showCompactDetail: false };
  }
}

/**
 * ApprovalPrompt component displays pending approval requests
 * in a queue list view, with detailed event information when selected
 */
interface ApprovalPromptProps {
  /** See QueueListView.embedded: hosted under another surface's title. */
  embedded?: boolean;
}

export function ApprovalPrompt({ embedded = false }: ApprovalPromptProps = {}) {
  const [state, dispatch] = useReducer(
    approvalPromptReducer,
    initialApprovalPromptState
  );
  // Origin policies, for the FIRST VISIT / KNOWN SITE / TRUSTED chip. Read
  // through the shared settings store, which useTheme has already primed.
  const { settings, isLoading: settingsLoading } = useAppSettings();

  // Fetch all pending requests
  const fetchRequests = useCallback(async () => {
    try {
      dispatch({ type: "loadStart" });

      const [{ requests: allRequests }, keys] = await Promise.all([
        getAllApprovalRequests(),
        listKeys(),
      ]);

      // Find selected key
      const selected = keys?.find((k) => k.isSelected) ?? null;
      dispatch({
        type: "loadSuccess",
        requests: allRequests,
        selectedKey: selected,
      });
    } catch (err) {
      dispatch({
        type: "loadError",
        error: err instanceof Error ? err.message : "Failed to load requests",
      });
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    if (state.requests.length === 0) return;

    const timer = setInterval(() => {
      dispatch({
        type: "tick",
        nowSeconds: Math.floor(Date.now() / 1000),
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state.requests.length]);

  // Listen for real-time queue updates
  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "__event" in message &&
        (message as { __event?: unknown }).__event ===
          BROADCAST_EVENTS.QUEUE_UPDATED
      ) {
        console.log("[ApprovalPrompt] Queue updated, refreshing...");
        fetchRequests();
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [fetchRequests]);

  const trustByOrigin = useMemo(() => {
    // Undefined until the policies have loaded: a chip that said FIRST VISIT
    // for a moment and then changed would be a chip nobody could trust.
    if (settingsLoading) return undefined;
    const map = new Map<string, OriginTrust>();
    for (const request of state.requests) {
      if (!map.has(request.origin)) {
        map.set(
          request.origin,
          describeOriginTrust(request.origin, settings.origins)
        );
      }
    }
    return map;
  }, [settingsLoading, settings.origins, state.requests]);

  // Handle user action on selected request
  const handleAction = async (action: ApprovalAction) => {
    if (!state.selectedRequestId || state.isResolving) return;

    try {
      dispatch({ type: "resolveStart" });
      await resolveApprovalRequest(state.selectedRequestId, action);
      reportActivity();

      const [, { count }] = await Promise.all([
        fetchRequests(),
        getApprovalCount(),
      ]);
      if (count === 0) {
        // No more requests - close window
        window.close();
      } else {
        // Return to list view
        dispatch({ type: "showList" });
      }
    } catch (err) {
      dispatch({
        type: "loadError",
        error: err instanceof Error ? err.message : "Failed to process action",
      });
    } finally {
      dispatch({ type: "resolveEnd" });
    }
  };

  // Handle batch actions
  const handleBatchAction = async (
    action: "approve" | "deny",
    requestIds: string[]
  ) => {
    if (state.isResolving || requestIds.length === 0) return;

    try {
      dispatch({ type: "resolveStart" });
      const approvalAction = action === "approve" ? "allow_once" : "deny";

      // Resolve all requests in batch
      await Promise.all(
        requestIds.map((id) => resolveApprovalRequest(id, approvalAction))
      );
      reportActivity();

      const [, { count }] = await Promise.all([
        fetchRequests(),
        getApprovalCount(),
      ]);
      if (count === 0) {
        // No more requests - close window
        window.close();
      } else {
        // Return to list view
        dispatch({ type: "showList" });
      }
    } catch (err) {
      dispatch({
        type: "loadError",
        error: err instanceof Error ? err.message : "Failed to process batch",
      });
    } finally {
      dispatch({ type: "resolveEnd" });
    }
  };

  // Loading state. Same composition as the empty state, so a queue that turns
  // out to be empty does not jump.
  if (state.isLoading) {
    return (
      <ApprovalNotice mark={<MascotSeal />} title="Loading requests" />
    );
  }

  // Error state. Checked before the empty state: a failed load also leaves
  // the list empty, and "No Pending Requests" would be the wrong thing to say.
  if (state.error) {
    return (
      <ApprovalNotice
        mark={<SealMark icon={AlertTriangle} tone="danger" size="lg" />}
        title="Error loading requests"
        description={state.error}
        action={{ label: "Try again", onClick: fetchRequests }}
      />
    );
  }

  // No requests state
  if (state.requests.length === 0) {
    // The line says what this window is FOR and what will bring it back. An
    // earlier version restated the heading ("Nothing is waiting for your
    // approval"), which is why it was cut; this one carries what the heading
    // cannot. Close sits under the cluster rather than pinned to the window's
    // edge - there is no decision here to anchor a footer to.
    return (
      <ApprovalNotice
        mark={<MascotSeal />}
        title="No Pending Requests"
        description="This window opens when a site asks for a signature or your public key."
        action={{ label: "Close", onClick: () => window.close() }}
      />
    );
  }

  // No fallback to requests[0]: the pane shows what the user chose, or
  // nothing. See the loadSuccess case above.
  const selectedRequest = state.requests.find(
    (r) => r.id === state.selectedRequestId
  );
  const countdown = selectedRequest
    ? Math.max(0, selectedRequest.timeoutAt - state.nowSeconds)
    : 0;

  const handleSelectRequest = (id: string) => {
    dispatch({ type: "selectRequest", id });
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-background md:grid-cols-[330px_minmax(0,1fr)]">
      <QueueListView
        requests={state.requests}
        selectedRequestId={selectedRequest?.id ?? null}
        nowSeconds={state.nowSeconds}
        onSelectRequest={handleSelectRequest}
        onBatchAction={handleBatchAction}
        disabled={state.isResolving}
        trustByOrigin={trustByOrigin}
        embedded={embedded}
        className={state.showCompactDetail ? "hidden md:flex" : "flex"}
      />

      {selectedRequest ? (
        <DetailPane
          request={selectedRequest}
          signingKey={state.selectedKey}
          countdown={countdown}
          onResolve={handleAction}
          onBack={() => dispatch({ type: "showList" })}
          showBackButton={state.showCompactDetail}
          isResolving={state.isResolving}
          originTrust={trustByOrigin?.get(selectedRequest.origin)}
          className={cn(
            state.showCompactDetail ? "flex" : "hidden md:flex",
            "md:border-l md:border-border"
          )}
        />
      ) : (
        <div className="hidden items-center justify-center border-l border-border bg-background p-6 text-center md:flex">
          <p className="text-sm font-semibold text-muted-foreground">
            Select a request to review the exact payload.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The window when there is nothing to decide: loading, empty, or failed.
 *
 * One composition for all three, so nothing jumps between them. The mascot is
 * the single hero this flow is allowed (DESIGN_RULES §9). The action, when
 * there is one, is a compact button under the cluster: there is no decision
 * on this screen for a pinned footer to belong to.
 */
function ApprovalNotice({
  mark,
  title,
  description,
  action,
}: {
  mark: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    // Symmetric padding, so `justify-center` actually centres the cluster. An
    // asymmetric bottom pad used to lift it ~25px above centre.
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background p-6 text-center">
      {/* One measure for the whole cluster: the mark, the words and the
          control share an edge instead of each finding their own width. */}
      <div className="flex w-full max-w-[22rem] flex-col items-center">
        {mark}
        <h2 className="mt-5 text-[17px] font-bold leading-6">{title}</h2>
        {description && (
          <p className="mt-1.5 text-pretty text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        )}
        {/* The only control on the screen, so by DESIGN_RULES §7 it IS this
            screen's primary and takes the solid notched treatment. As a ghost
            it sat a shade off the background and read as disabled - worst of
            all in Deep Ink, where the hairline all but vanished. Full width on
            the cluster's measure, at the height the detail screens give their
            actions: at ~120px the 9px notch was a large bite out of a small
            block and read as damage rather than as the signature. */}
        {action && (
          <Button className="mt-6 h-12 w-full" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The mascot, seated in a seal.
 *
 * The asset is a head cut flat across its base. Standing free at hero size
 * that cut is the last edge the eye meets and reads as a crop rather than a
 * silhouette. The seal is Ostrilo's own mark shape (§5) and its lower edges
 * converge to a point below the cut, so the composition ends on the plate
 * rather than on the damage. The soft fill also lifts the mascot's darkest
 * facets off the Deep Ink background, which §9 asks to be checked.
 *
 * The mascot is seated deliberately LOW and slightly oversized, so the flat
 * base passes below the seal's point and is clipped away by the plate itself
 * (clip-path clips descendants) - the head emerges from the seal rather than
 * stopping at a cut. Its top clears the plate's upper edges, which are at
 * full width where the image begins, so no facet is lost up there.
 *
 * 96px of mascot in a 120px plate. The review captures render at 1x and the
 * crest spikes are the finest detail in the artwork, so the pixels across them
 * are the lever on how hard those edges alias - hence the larger of the two
 * sizes that still leaves 12px of half-width clearance past the beak.
 */
function MascotSeal() {
  return (
    <span
      aria-hidden="true"
      className="seal flex h-[7.5rem] w-[7.5rem] shrink-0 items-end justify-center bg-secondary"
    >
      <span className="h-24 w-24 translate-y-3">
        <Logo size="max" alt="" />
      </span>
    </span>
  );
}

interface DetailPaneProps {
  request: PendingRequest;
  signingKey: KeyRecord | null;
  countdown: number;
  onResolve: (action: ApprovalAction) => void;
  onBack: () => void;
  showBackButton: boolean;
  isResolving: boolean;
  originTrust?: OriginTrust;
  className: string;
}

/**
 * Routes one queued request to the view that can render it.
 *
 * Wrapped in a boundary because a request that throws while rendering used to
 * blank the entire window - taking the Deny control for every OTHER queued
 * request with it. The fallback still offers Deny: a user who cannot read a
 * request must still be able to refuse it.
 */
function DetailPane({ request, ...rest }: DetailPaneProps) {
  return (
    <ApprovalErrorBoundary
      resetKey={request.id}
      onDeny={() => rest.onResolve("deny")}
      onBack={rest.onBack}
    >
      {isDisclosureRequest(request) ? (
        <DisclosureDetailView request={request} {...rest} />
      ) : isSigningRequest(request) ? (
        <EventDetailView request={request} {...rest} />
      ) : (
        // A signing request with no event: not reachable through the enqueue
        // API, but the type permits it, and rendering nothing silently would be
        // worse than routing it to the refusal surface.
        <ApprovalRenderFailure />
      )}
    </ApprovalErrorBoundary>
  );
}

/**
 * Thrown to trip the boundary rather than returned, so an unrepresentable
 * request reaches exactly one refusal surface instead of two.
 */
function ApprovalRenderFailure(): never {
  throw new Error("Request has no renderable payload");
}
