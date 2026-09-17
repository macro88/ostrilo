import { useReducer, useEffect, useCallback } from "react";
import { rpc } from "@/infrastructure/messaging/client";
import type { ProfileMetadata } from "@/domain/profile/types";
import { RELAY_BOUNDS } from "@/domain/relay";

interface ProfileState {
  profile: ProfileMetadata | null;
  loading: boolean;
  error: string | null;
}

type ProfileAction =
  | { type: "reset" }
  | { type: "request" }
  | { type: "settled" }
  | { type: "success"; profile: ProfileMetadata | null }
  | { type: "optimistic"; profile: ProfileMetadata }
  | { type: "failure"; error: string };

/**
 * How long the surface waits for `profile.get` before it stops showing
 * placeholders.
 *
 * The background settles every relay fetch at `FETCH_DEADLINE_MS`, so an
 * answer that has not arrived a second after that is not coming in a form
 * worth waiting for. Past this point the rows read as an unpublished profile
 * ("Not set"), which is the only claim the extension can honestly make; a late
 * answer still lands and fills them in.
 */
const PROFILE_SETTLE_MS = RELAY_BOUNDS.FETCH_DEADLINE_MS + 1000;

/**
 * A pubkey means a fetch starts the moment the hook mounts, so the first frame
 * is a loading frame. Starting at `loading: false` painted one frame of
 * "Not set" beside an enabled Edit button before the effect flipped it - a
 * flash for the user, and a frame the design-review runner mistook for the
 * resting state.
 */
function createInitialState(pubkey: string | null): ProfileState {
  return { profile: null, loading: pubkey !== null, error: null };
}

function profileReducer(
  state: ProfileState,
  action: ProfileAction
): ProfileState {
  switch (action.type) {
    case "reset":
      return createInitialState(null);
    case "request":
      return { ...state, loading: true, error: null };
    case "settled":
      return { ...state, loading: false };
    case "success":
      return { profile: action.profile, loading: false, error: null };
    case "optimistic":
      return { ...state, profile: action.profile };
    case "failure":
      return { ...state, loading: false, error: action.error };
  }
}

/**
 * Hook for fetching and managing profile metadata
 */
export function useProfile(pubkey: string | null) {
  const [state, dispatch] = useReducer(
    profileReducer,
    pubkey,
    createInitialState
  );

  const fetchProfile = useCallback(
    async (forceFetch = false) => {
      if (!pubkey) {
        dispatch({ type: "reset" });
        return;
      }

      dispatch({ type: "request" });
      const settle = window.setTimeout(
        () => dispatch({ type: "settled" }),
        PROFILE_SETTLE_MS
      );

      try {
        const data = await rpc<ProfileMetadata | null>({
          type: "profile.get" as any,
          params: { pubkey, forceFetch },
        } as any);

        dispatch({ type: "success", profile: data });
      } catch (err) {
        console.error("Failed to fetch profile:", err);
        dispatch({
          type: "failure",
          error: err instanceof Error ? err.message : "Failed to fetch profile",
        });
      } finally {
        window.clearTimeout(settle);
      }
    },
    [pubkey]
  );

  // Auto-fetch when pubkey changes
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateProfile = useCallback(
    async (metadata: ProfileMetadata) => {
      try {
        dispatch({ type: "request" });

        await rpc({
          type: "profile.update" as any,
          params: { metadata },
        } as any);

        // Optimistically update local state
        dispatch({ type: "optimistic", profile: metadata });

        // Refetch to get latest from relay
        await fetchProfile(true);
      } catch (err) {
        console.error("Failed to update profile:", err);
        dispatch({
          type: "failure",
          error: err instanceof Error ? err.message : "Failed to update profile",
        });
        throw err;
      }
    },
    [fetchProfile]
  );

  const refresh = useCallback(() => {
    return fetchProfile(true);
  }, [fetchProfile]);

  return {
    profile: state.profile,
    loading: state.loading,
    error: state.error,
    updateProfile,
    refresh,
  };
}
