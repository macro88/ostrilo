import { useState, useEffect, useCallback } from "react";
import { rpc } from "@/infrastructure/messaging/client";
import type { ProfileMetadata } from "@/domain/profile/types";

/**
 * Hook for fetching and managing profile metadata
 */
export function useProfile(pubkey: string | null) {
  const [profile, setProfile] = useState<ProfileMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(
    async (forceFetch = false) => {
      if (!pubkey) {
        setProfile(null);
        setError(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const data = await rpc<ProfileMetadata | null>({
          type: "profile.get" as any,
          params: { pubkey, forceFetch },
        } as any);

        setProfile(data);
      } catch (err) {
        console.error("Failed to fetch profile:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch profile"
        );
      } finally {
        setLoading(false);
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
        setLoading(true);
        setError(null);

        await rpc({
          type: "profile.update" as any,
          params: { metadata },
        } as any);

        // Optimistically update local state
        setProfile(metadata);

        // Refetch to get latest from relay
        await fetchProfile(true);
      } catch (err) {
        console.error("Failed to update profile:", err);
        setError(
          err instanceof Error ? err.message : "Failed to update profile"
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchProfile]
  );

  const refresh = useCallback(() => {
    return fetchProfile(true);
  }, [fetchProfile]);

  return {
    profile,
    loading,
    error,
    updateProfile,
    refresh,
  };
}
