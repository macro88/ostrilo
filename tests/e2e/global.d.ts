/**
 * Global type definitions for E2E tests
 * Defines NIP-07 window.nostr API types for TypeScript
 */

interface UnsignedNostrEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey?: string;
}

interface SignedNostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface Nip04 {
  encrypt(pubkey: string, plaintext: string): Promise<string>;
  decrypt(pubkey: string, ciphertext: string): Promise<string>;
}

interface Nip44 {
  encrypt(pubkey: string, plaintext: string): Promise<string>;
  decrypt(pubkey: string, ciphertext: string): Promise<string>;
}

interface WindowNostr {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedNostrEvent): Promise<SignedNostrEvent>;
  nip04?: Nip04;
  nip44?: Nip44;
}

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

export {};
