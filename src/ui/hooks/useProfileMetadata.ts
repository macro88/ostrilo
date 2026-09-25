import { useEffect, useState } from "react";
import { rpc } from "@/infrastructure/messaging/client";
import type { ProfileMetadata } from "@/domain/profile/types";

const EMPTY_PROFILES = new Map<string, ProfileMetadata>();

interface FetchedProfiles {
  signature: string;
  profiles: Map<string, ProfileMetadata>;
}

/**
 * Fetches profile metadata for a set of public keys.
 *
 * Loading is derived from whether the last completed fetch was for the current
 * key set, so a fetch abandoned when the set changes cannot leave it stuck.
 *
 * @param pubkeys - Array of hex public keys to fetch profiles for
 * @returns Map of pubkey -> ProfileMetadata and loading state
 */
export function useProfileMetadata(pubkeys: string[]) {
  const [fetched, setFetched] = useState<FetchedProfiles | null>(null);
  const pubkeySignature = pubkeys.join("\u0000");

  useEffect(() => {
    if (pubkeySignature.length === 0) {
      return;
    }

    let cancelled = false;
    const requestedPubkeys = pubkeySignature.split("\u0000");

    const fetchProfiles = async () => {
      // allSettled never rejects: a failed lookup is simply absent from the map.
      const results = await Promise.allSettled(
        requestedPubkeys.map(async (pubkey) => {
          const data = await rpc<ProfileMetadata | null>({
            type: "profile.get",
            params: { pubkey, forceFetch: false },
          });
          return { pubkey, data };
        })
      );

      if (cancelled) return;

      const profiles = new Map<string, ProfileMetadata>();
      results.forEach((result) => {
        if (result.status === "fulfilled" && result.value.data) {
          profiles.set(result.value.pubkey, result.value.data);
        }
      });

      setFetched({ signature: pubkeySignature, profiles });
    };

    void fetchProfiles();

    return () => {
      cancelled = true;
    };
  }, [pubkeySignature]);

  if (pubkeySignature.length === 0) {
    return { profiles: EMPTY_PROFILES, isLoading: false };
  }

  return {
    profiles: fetched?.profiles ?? EMPTY_PROFILES,
    isLoading: fetched?.signature !== pubkeySignature,
  };
}
