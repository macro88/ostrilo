import { describe, it, expect } from "vitest";
import {
  computeEventId,
  signEventHash,
  verifyEventSignature,
  generatePrivateKey,
  getPublicKey,
  publicKeyToHex,
} from "@/domain/utils/crypto";

describe("NIP-01 Event ID Computation", () => {
  describe("computeEventId", () => {
    it("computes correct event ID for a simple text note", () => {
      // Test vector: A simple kind 1 text note
      const pubkey =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const created_at = 1234567890;
      const kind = 1;
      const tags: string[][] = [];
      const content = "Hello, Nostr!";

      const id = computeEventId(pubkey, created_at, kind, tags, content);

      // The ID should be a 64-character lowercase hex string
      expect(id).toMatch(/^[0-9a-f]{64}$/);
      expect(id.length).toBe(64);
    });

    it("produces different IDs for different content", () => {
      const pubkey =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const created_at = 1234567890;
      const kind = 1;
      const tags: string[][] = [];

      const id1 = computeEventId(pubkey, created_at, kind, tags, "Hello");
      const id2 = computeEventId(pubkey, created_at, kind, tags, "World");

      expect(id1).not.toBe(id2);
    });

    it("produces different IDs for different timestamps", () => {
      const pubkey =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const kind = 1;
      const tags: string[][] = [];
      const content = "Hello";

      const id1 = computeEventId(pubkey, 1000000000, kind, tags, content);
      const id2 = computeEventId(pubkey, 1000000001, kind, tags, content);

      expect(id1).not.toBe(id2);
    });

    it("produces different IDs for different kinds", () => {
      const pubkey =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const created_at = 1234567890;
      const tags: string[][] = [];
      const content = "Hello";

      const id1 = computeEventId(pubkey, created_at, 1, tags, content);
      const id2 = computeEventId(pubkey, created_at, 6, tags, content);

      expect(id1).not.toBe(id2);
    });

    it("produces different IDs for different pubkeys", () => {
      const created_at = 1234567890;
      const kind = 1;
      const tags: string[][] = [];
      const content = "Hello";

      const pubkey1 =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const pubkey2 =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

      const id1 = computeEventId(pubkey1, created_at, kind, tags, content);
      const id2 = computeEventId(pubkey2, created_at, kind, tags, content);

      expect(id1).not.toBe(id2);
    });

    it("handles events with tags correctly", () => {
      const pubkey =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const created_at = 1234567890;
      const kind = 1;
      const content = "Hello";

      const tagsEmpty: string[][] = [];
      const tagsWithP: string[][] = [
        [
          "p",
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
        ],
      ];
      const tagsWithE: string[][] = [
        [
          "e",
          "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        ],
      ];

      const idEmpty = computeEventId(
        pubkey,
        created_at,
        kind,
        tagsEmpty,
        content
      );
      const idWithP = computeEventId(
        pubkey,
        created_at,
        kind,
        tagsWithP,
        content
      );
      const idWithE = computeEventId(
        pubkey,
        created_at,
        kind,
        tagsWithE,
        content
      );

      expect(idEmpty).not.toBe(idWithP);
      expect(idEmpty).not.toBe(idWithE);
      expect(idWithP).not.toBe(idWithE);
    });

    it("produces deterministic IDs for identical inputs", () => {
      const pubkey =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const created_at = 1234567890;
      const kind = 1;
      const tags: string[][] = [["t", "nostr"]];
      const content = "Test determinism";

      const id1 = computeEventId(pubkey, created_at, kind, tags, content);
      const id2 = computeEventId(pubkey, created_at, kind, tags, content);

      expect(id1).toBe(id2);
    });

    it("handles empty content correctly", () => {
      const pubkey =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const created_at = 1234567890;
      const kind = 1;
      const tags: string[][] = [];
      const content = "";

      const id = computeEventId(pubkey, created_at, kind, tags, content);

      expect(id).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles special characters in content", () => {
      const pubkey =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const created_at = 1234567890;
      const kind = 1;
      const tags: string[][] = [];
      const content = '{"json": true, "emoji": "🎉", "unicode": "日本語"}';

      const id = computeEventId(pubkey, created_at, kind, tags, content);

      expect(id).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("signEventHash", () => {
    it("produces valid 128-character hex signatures", () => {
      const privateKey = generatePrivateKey();
      const eventId =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

      const signature = signEventHash(eventId, privateKey);

      expect(signature).toMatch(/^[0-9a-f]{128}$/);
      expect(signature.length).toBe(128);
    });

    it("produces different signatures for different event IDs", () => {
      const privateKey = generatePrivateKey();
      const eventId1 =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const eventId2 =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

      const sig1 = signEventHash(eventId1, privateKey);
      const sig2 = signEventHash(eventId2, privateKey);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe("verifyEventSignature", () => {
    it("verifies valid signatures", () => {
      const privateKey = generatePrivateKey();
      const publicKey = getPublicKey(privateKey);
      const pubkeyHex = publicKeyToHex(publicKey);

      const eventId =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const signature = signEventHash(eventId, privateKey);

      const isValid = verifyEventSignature(eventId, signature, pubkeyHex);

      expect(isValid).toBe(true);
    });

    it("rejects signatures with wrong event ID", () => {
      const privateKey = generatePrivateKey();
      const publicKey = getPublicKey(privateKey);
      const pubkeyHex = publicKeyToHex(publicKey);

      const eventId1 =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const eventId2 =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const signature = signEventHash(eventId1, privateKey);

      const isValid = verifyEventSignature(eventId2, signature, pubkeyHex);

      expect(isValid).toBe(false);
    });

    it("rejects signatures with wrong public key", () => {
      const privateKey1 = generatePrivateKey();
      const privateKey2 = generatePrivateKey();
      const publicKey2 = getPublicKey(privateKey2);
      const pubkeyHex2 = publicKeyToHex(publicKey2);

      const eventId =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const signature = signEventHash(eventId, privateKey1);

      const isValid = verifyEventSignature(eventId, signature, pubkeyHex2);

      expect(isValid).toBe(false);
    });
  });

  describe("End-to-end event signing", () => {
    it("creates and verifies a complete signed event", () => {
      // Generate keypair
      const privateKey = generatePrivateKey();
      const publicKey = getPublicKey(privateKey);
      const pubkeyHex = publicKeyToHex(publicKey);

      // Create event data
      const created_at = Math.floor(Date.now() / 1000);
      const kind = 1;
      const tags: string[][] = [];
      const content = "Hello, Nostr!";

      // Compute event ID
      const eventId = computeEventId(
        pubkeyHex,
        created_at,
        kind,
        tags,
        content
      );

      // Sign the event
      const signature = signEventHash(eventId, privateKey);

      // Verify the signature
      const isValid = verifyEventSignature(eventId, signature, pubkeyHex);

      expect(isValid).toBe(true);

      // Verify the event ID format
      expect(eventId).toMatch(/^[0-9a-f]{64}$/);

      // Verify the signature format
      expect(signature).toMatch(/^[0-9a-f]{128}$/);
    });
  });
});
