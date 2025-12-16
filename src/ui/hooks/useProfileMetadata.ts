import { useState, useEffect } from "react";
import { rpc } from "@/infrastructure/messaging/client";
import type { ProfileMetadata } from "@/domain/profile/types";

/**
 * Hook for fetching profile metadata for multiple public keys
 *
 * @param pubkeys - Array of hex public keys to fetch profiles for
 * @returns Map of pubkey -> ProfileMetadata and loading state
 */
export function useProfileMetadata(pubkeys: string[]) {
  const [profiles, setProfiles] = useState<Map<string, ProfileMetadata>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pubkeys.length === 0) {
      setProfiles(new Map());
      return;
    }

    let cancelled = false;

    const fetchProfiles = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch all profiles in parallel
        const results = await Promise.allSettled(
          pubkeys.map(async (pubkey) => {
            const data = await rpc<ProfileMetadata | null>({
              type: "profile.get" as any,
              params: { pubkey, forceFetch: false },
            } as any);
            return { pubkey, data };
          })
        );

        if (cancelled) return;

        // Build map of successful results
        const profileMap = new Map<string, ProfileMetadata>();
        results.forEach((result, index) => {
          if (result.status === "fulfilled" && result.value.data) {
            profileMap.set(result.value.pubkey, result.value.data);
          }
        });

        setProfiles(profileMap);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch profiles:", err);
          setError(
            err instanceof Error ? err.message : "Failed to fetch profiles"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchProfiles();

    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(pubkeys)]); // Stringify to avoid infinite loops on array reference changes

  return { profiles, isLoading, error };
}
