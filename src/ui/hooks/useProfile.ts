import { useReducer, useEffect, useCallback } from "react";
import { rpc } from "@/infrastructure/messaging/client";
import type { ProfileMetadata } from "@/domain/profile/types";

interface ProfileState {
  profile: ProfileMetadata | null;
  loading: boolean;
  error: string | null;
}

type ProfileAction =
  | { type: "reset" }
  | { type: "request" }
  | { type: "success"; profile: ProfileMetadata | null }
  | { type: "optimistic"; profile: ProfileMetadata }
  | { type: "failure"; error: string };

const initialProfileState: ProfileState = {
  profile: null,
  loading: false,
  error: null,
};

function profileReducer(
  state: ProfileState,
  action: ProfileAction
): ProfileState {
  switch (action.type) {
    case "reset":
      return initialProfileState;
    case "request":
      return { ...state, loading: true, error: null };
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
  const [state, dispatch] = useReducer(profileReducer, initialProfileState);

  const fetchProfile = useCallback(
    async (forceFetch = false) => {
      if (!pubkey) {
        dispatch({ type: "reset" });
        return;
      }

      try {
        dispatch({ type: "request" });

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
