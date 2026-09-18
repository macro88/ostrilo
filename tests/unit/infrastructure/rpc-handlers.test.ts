import { describe, it, expect, vi, beforeEach } from "vitest";
import { DisclosureRateLimitService } from "@/application/services/disclosure-rate-limit.service";
import { RpcRouter } from "@/infrastructure/messaging/rpc-router";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { SettingsRpcHandler } from "@/infrastructure/messaging/handlers/settings-rpc";
import { CryptoRpcHandler } from "@/infrastructure/messaging/handlers/crypto-rpc";
import { StateRpcHandler } from "@/infrastructure/messaging/handlers/state-rpc";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import {
  RPC_ERROR_CODES,
  createRpcErrorResponse,
} from "@/infrastructure/messaging/rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";

describe("RPC Router and Handlers", () => {
  let router: RpcRouter;
  let mockContext: ServiceContext;

  beforeEach(() => {
    router = new RpcRouter();

    // Create mock service context
    mockContext = {
      disclosureRateLimit: new DisclosureRateLimitService(),
      unlockThrottle: {
        check: vi.fn().mockResolvedValue(0),
        recordFailure: vi.fn().mockResolvedValue(0),
        recordSuccess: vi.fn().mockResolvedValue(undefined),
      },
      vault: {
        unlock: vi.fn().mockResolvedValue({ selectedKeyId: "test-key" }),
        lock: vi.fn().mockResolvedValue(undefined),
        generateKey: vi.fn().mockResolvedValue({ publicKey: "generated-key" }),
        importKey: vi.fn().mockResolvedValue({ publicKey: "imported-key" }),
        selectKey: vi.fn().mockResolvedValue(undefined),
        sign: vi
          .fn()
          .mockResolvedValue({ sigHex: "signature", keyId: "test-key" }),
        listKeys: vi.fn().mockResolvedValue([]),
        getLockState: vi.fn().mockResolvedValue({ isLocked: false }),
      },
      policy: {
        evaluate: vi.fn().mockResolvedValue({ allowed: true }),
        getIdentityDisclosure: vi.fn().mockResolvedValue("allow"),
        setIdentityDisclosure: vi.fn().mockResolvedValue(undefined),
        setOriginPolicy: vi.fn().mockResolvedValue(undefined),
        setPerKindRule: vi.fn().mockResolvedValue(undefined),
        clearSessionGrant: vi.fn().mockResolvedValue(undefined),
        setSessionGrant: vi.fn().mockResolvedValue(undefined),
        removeOriginPolicy: vi.fn().mockResolvedValue(undefined),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ theme: "dark" }),
        update: vi.fn().mockResolvedValue({ theme: "light" }),
      },
      crypto: {
        evaluatePassword: vi.fn().mockResolvedValue({ score: 4 }),
        parsePrivateKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
      },
    } as any;
  });

  describe("RpcRouter", () => {
    it("should register modules correctly", () => {
      const vaultHandler = new VaultRpcHandler();
      router.registerModule("vault", vaultHandler);

      expect(router.getRegisteredNamespaces()).toContain("vault");
    });

    it("should route requests to correct module", async () => {
      const mockHandler = {
        handleRequest: vi.fn().mockResolvedValue({ ok: true, data: "test" }),
      };

      router.registerModule("test", mockHandler);

      const message = { type: "test.method" as any };
      const result = await router.handleRequest(message, mockContext);

      expect(mockHandler.handleRequest).toHaveBeenCalledWith(
        message,
        mockContext
      );
      expect(result).toEqual({ ok: true, data: "test" });
    });

    it("should handle unknown namespace", async () => {
      const message = { type: "unknown.method" as any };
      const result = await router.handleRequest(message, mockContext);

      expect(result).toEqual(
        createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_NAMESPACE, {
          details: "unknown",
          method: "unknown.method",
        })
      );
    });

    it("should handle invalid message type", async () => {
      const message = { type: "" as any };
      const result = await router.handleRequest(message, mockContext);

      expect(result).toEqual(
        createRpcErrorResponse(RPC_ERROR_CODES.INVALID_REQUEST)
      );
    });

    it("does not leak raw error text back across the RPC boundary", async () => {
      // The router used to return `error?.message ?? String(error)` as
      // `details`. Thrown messages can carry internal paths and state, and
      // this response travels back toward the caller, so the text is now
      // fixed and the real error is logged internally instead.
      const mockHandler = {
        handleRequest: vi
          .fn()
          .mockRejectedValue(new Error("ENOENT /Users/someone/secret/path")),
      };

      router.registerModule("test", mockHandler);

      const message = { type: "test.method" as any };
      const result = await router.handleRequest(message, mockContext);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(
          RPC_ERROR_CODES.UNKNOWN_METHOD
        );
        expect(result.error.data.method).toBe("test.method");
        const serialised = JSON.stringify(result);
        expect(serialised).not.toContain("ENOENT");
        expect(serialised).not.toContain("/Users/someone");
      }
    });

    it("does not resolve inherited object keys as namespaces", async () => {
      // The module registry was a plain object literal, so "__proto__.x" and
      // "constructor.x" found a truthy value on Object.prototype and passed
      // the existence check before failing on the method call.
      for (const type of ["__proto__.x", "constructor.x", "toString.x"]) {
        const result = await router.handleRequest(
          { type } as never,
          mockContext
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(
            RPC_ERROR_CODES.UNKNOWN_NAMESPACE
          );
        }
      }
    });
  });

  describe("VaultRpcHandler", () => {
    let handler: VaultRpcHandler;

    beforeEach(() => {
      handler = new VaultRpcHandler();
    });

    it("should handle vault.unlock", async () => {
      const message = {
        type: "vault.unlock",
        password: "test-password",
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.vault.unlock).toHaveBeenCalledWith("test-password");
      expect(result).toEqual({ ok: true, data: { selectedKeyId: "test-key" } });
    });

    it("should handle vault.lock", async () => {
      const message = { type: "vault.lock" } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.vault.lock).toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: null });
    });

    it("should handle keys.list", async () => {
      const message = { type: "keys.list" } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.vault.listKeys).toHaveBeenCalled();
      expect(result).toEqual({
        ok: true,
        data: [],
      });
    });

    it("should handle unsupported methods", async () => {
      const message = { type: "vault.unsupported" } as any;
      const result = await handler.handleRequest(message, mockContext);

      expect(result).toEqual(
        createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: "vault.unsupported",
          method: "vault.unsupported",
        })
      );
    });
  });

  describe("PolicyRpcHandler", () => {
    let handler: PolicyRpcHandler;

    beforeEach(() => {
      handler = new PolicyRpcHandler();
    });

    it("should handle policy.evaluate", async () => {
      const message = {
        type: "policy.evaluate",
        origin: "https://example.com",
        kind: 1,
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.policy.evaluate).toHaveBeenCalledWith({
        origin: "https://example.com",
        kind: 1,
      });
      expect(result).toEqual({ ok: true, data: { allowed: true } });
    });
  });

  describe("SettingsRpcHandler", () => {
    let handler: SettingsRpcHandler;

    beforeEach(() => {
      handler = new SettingsRpcHandler();
    });

    it("should handle settings.get", async () => {
      const message = { type: "settings.get" } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.settings.get).toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: { theme: "dark" } });
    });

    it("should handle settings.update", async () => {
      const message = {
        type: "settings.update",
        patch: { theme: "light" },
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.settings.update).toHaveBeenCalledWith({
        theme: "light",
      });
      expect(result).toEqual({ ok: true, data: { theme: "light" } });
    });

    it("should sanitize protected medium trust kinds before settings.update", async () => {
      const message = {
        type: "settings.update",
        patch: { mediumAllowKinds: [1, 6, 9734, 9735] },
      } satisfies Parameters<SettingsRpcHandler["handleRequest"]>[0];

      await handler.handleRequest(message, mockContext);

      // 1 and 9734 are protected; 9735 is unprotected but outside the
      // high-trust allowlist, so medium trust could never act on it either.
      expect(mockContext.settings.update).toHaveBeenCalledWith({
        mediumAllowKinds: [6],
      });
    });
  });

  describe("StateRpcHandler", () => {
    let handler: StateRpcHandler;

    beforeEach(() => {
      handler = new StateRpcHandler();
    });

    it("should handle state.getLock", async () => {
      const message = { type: "state.getLock" } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(mockContext.vault.getLockState).toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: { isLocked: false } });
    });
  });

  describe("CryptoRpcHandler", () => {
    let handler: CryptoRpcHandler;

    beforeEach(() => {
      handler = new CryptoRpcHandler();
    });

    it("should handle crypto.evaluatePassword", async () => {
      // No module mock here on purpose. The handler dynamically imports
      // checkPassword from "@/domain/utils/password-policy" (crypto-rpc.ts),
      // not from "@/domain/utils/crypto", so the doMock that used to sit here
      // never affected this test - but it DID leak into later tests in
      // this file and break their dynamic imports. Use the real function.
      const message = {
        type: "crypto.evaluatePassword",
        password: "strong-password",
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(true);
    });

    it("validates a private key WITHOUT returning the key bytes", async () => {
      // This handler used to return Array.from(privateKey) - the raw 32-byte
      // secret scalar - across the message bus into the calling page, where it
      // landed in a plain JS array nothing zeroizes and the RPC client logged
      // it. The caller only ever needed a yes/no answer.
      const message = {
        type: "crypto.parsePrivateKey",
        keyInput: "ab".repeat(32),
      } as const;
      const result = await handler.handleRequest(message, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ valid: true });

        // The decisive assertion: no key material anywhere in the response.
        const serialised = JSON.stringify(result.data);
        expect(serialised).not.toContain("ab".repeat(32));
        expect(Array.isArray(result.data)).toBe(false);
      }
    });

    it("rejects an npub, which is not a private key", async () => {
      const result = await handler.handleRequest(
        {
          type: "crypto.parsePrivateKey",
          keyInput: "npub1" + "q".repeat(58),
        } as const,
        mockContext
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.data.errorCode).toBe(
          RPC_ERROR_CODES.INVALID_KEY_INPUT
        );
      }
    });
  });

  describe("NostrRpcHandler", () => {
    let handler: NostrRpcHandler;
    let nostrMockContext: ServiceContext;

    beforeEach(() => {
      handler = new NostrRpcHandler();

      // Create mock context specific to Nostr handler tests
      nostrMockContext = {
        disclosureRateLimit: new DisclosureRateLimitService(),
        vault: {
          unlock: vi.fn().mockResolvedValue({ selectedKeyId: "test-key" }),
          lock: vi.fn().mockResolvedValue(undefined),
          generateKey: vi
            .fn()
            .mockResolvedValue({ publicKey: "generated-key" }),
          importKey: vi.fn().mockResolvedValue({ publicKey: "imported-key" }),
          selectKey: vi.fn().mockResolvedValue(undefined),
          sign: vi
            .fn()
            .mockResolvedValue({ sigHex: "a".repeat(128), keyId: "key-1" }), // 64-byte hex signature
          listKeys: vi.fn().mockResolvedValue([
            {
              id: "key-1",
              pubkey:
                "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
              isSelected: true,
            },
          ]),
          getLockState: vi.fn().mockResolvedValue({ isLocked: false }),
        },
        policy: {
          evaluate: vi
            .fn()
            .mockResolvedValue({ mode: "allow", reason: "explicit_allow" }),
          getIdentityDisclosure: vi.fn().mockResolvedValue("allow"),
          setIdentityDisclosure: vi.fn().mockResolvedValue(undefined),
          setOriginPolicy: vi.fn().mockResolvedValue(undefined),
          setPerKindRule: vi.fn().mockResolvedValue(undefined),
          clearSessionGrant: vi.fn().mockResolvedValue(undefined),
          setSessionGrant: vi.fn().mockResolvedValue(undefined),
          removeOriginPolicy: vi.fn().mockResolvedValue(undefined),
        },
        settings: {
          get: vi.fn().mockResolvedValue({ theme: "dark" }),
          update: vi.fn().mockResolvedValue({ theme: "light" }),
        },
        activityLog: {
          addEntry: vi.fn().mockResolvedValue(undefined),
          getRecent: vi.fn().mockResolvedValue([]),
          filterBy: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
          getUniqueOrigins: vi.fn().mockResolvedValue([]),
          clear: vi.fn().mockResolvedValue(undefined),
        },
      } as any;
    });

    describe("nostr.getPublicKey", () => {
      it("should return pubkey when vault is unlocked and key is selected", async () => {
        const message = {
          type: "nostr.getPublicKey",
          origin: "https://example.com",
        } as const;
        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data).toEqual({
            pubkey:
              "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          });
        }
      });

      it("should return error when vault is locked", async () => {
        nostrMockContext.vault.getLockState = vi
          .fn()
          .mockResolvedValue({ isLocked: true });

        const message = {
          type: "nostr.getPublicKey",
          origin: "https://example.com",
        } as const;
        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
        }
      });

      it("should return error when no key is selected", async () => {
        nostrMockContext.vault.listKeys = vi
          .fn()
          .mockResolvedValue([
            { id: "key-1", pubkey: "abc123", isSelected: false },
          ]);

        const message = {
          type: "nostr.getPublicKey",
          origin: "https://example.com",
        } as const;
        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(
            RPC_ERROR_CODES.NO_KEY_SELECTED
          );
        }
      });
    });

    describe("nostr.signEvent", () => {
      const validUnsignedEvent = {
        kind: 7,
        content: "Hello, Nostr!",
        tags: [],
        created_at: 1234567890,
      };

      it.each([1.0000001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        "rejects kind %s before policy evaluation",
        async (kind) => {
          const message = {
            type: "nostr.signEvent",
            event: { ...validUnsignedEvent, kind },
            origin: "https://example.com",
          } as any;

          const result = await handler.handleRequest(message, nostrMockContext);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.data.errorCode).toBe(
              RPC_ERROR_CODES.INVALID_EVENT
            );
          }
          // The protected-kind gate for kind 1 must not be reachable by
          // arithmetic: nothing downstream of validation may run.
          expect(nostrMockContext.policy.evaluate).not.toHaveBeenCalled();
          expect(nostrMockContext.vault.sign).not.toHaveBeenCalled();
        }
      );

      it.each([5, 22242, 27235])(
        "still requires approval for newly protected kind %i even when policy allows",
        async (kind) => {
          nostrMockContext.policy.evaluate = vi
            .fn()
            .mockResolvedValue({ mode: "allow", reason: "trust" });

          const message = {
            type: "nostr.signEvent",
            event: { ...validUnsignedEvent, kind },
            origin: "https://example.com",
          } as any;

          const result = await handler.handleRequest(message, nostrMockContext);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.data.errorCode).toBe(
              RPC_ERROR_CODES.NEEDS_APPROVAL
            );
          }
          expect(nostrMockContext.vault.sign).not.toHaveBeenCalled();
        }
      );

      it("should sign event when vault is unlocked and policy allows", async () => {
        const message = {
          type: "nostr.signEvent",
          event: validUnsignedEvent,
          origin: "https://example.com",
        } as const;

        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(true);
        if (result.ok) {
          const data = result.data as { event: any };
          expect(data.event).toBeDefined();
          expect(data.event.id).toMatch(/^[0-9a-f]{64}$/);
          expect(data.event.pubkey).toBe(
            "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
          );
          expect(data.event.sig).toBe("a".repeat(128));
          expect(data.event.kind).toBe(7);
          expect(data.event.content).toBe("Hello, Nostr!");
        }
      });

      it("should return error when vault is locked", async () => {
        nostrMockContext.vault.getLockState = vi
          .fn()
          .mockResolvedValue({ isLocked: true });

        const message = {
          type: "nostr.signEvent",
          event: validUnsignedEvent,
          origin: "https://example.com",
        } as const;

        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
        }
      });

      it("should return error when policy denies", async () => {
        nostrMockContext.policy.evaluate = vi
          .fn()
          .mockResolvedValue({ mode: "deny", reason: "explicit_deny" });

        const message = {
          type: "nostr.signEvent",
          event: validUnsignedEvent,
          origin: "https://example.com",
        } as const;

        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.DENIED);
        }
      });

      it("should return needs_approval when policy asks", async () => {
        nostrMockContext.policy.evaluate = vi
          .fn()
          .mockResolvedValue({ mode: "ask", reason: "default_ask" });

        const message = {
          type: "nostr.signEvent",
          event: validUnsignedEvent,
          origin: "https://example.com",
        } as const;

        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.NEEDS_APPROVAL);
        }
      });

      it("should route protected auto-allow results through approval before signing", async () => {
        const approvalQueue = new ApprovalQueueService();
        const windowManager = vi.fn().mockResolvedValue(undefined);
        handler = new NostrRpcHandler(approvalQueue, windowManager);
        nostrMockContext.policy.evaluate = vi
          .fn()
          .mockResolvedValue({ mode: "allow", reason: "trust" });
        const protectedEvent = {
          ...validUnsignedEvent,
          kind: 1,
        };
        const message = {
          type: "nostr.signEvent",
          event: protectedEvent,
          origin: "https://example.com",
        } as const;

        const resultPromise = handler.handleRequest(message, nostrMockContext);
        await vi.waitFor(() => {
          expect(approvalQueue.count()).toBe(1);
        });
        expect(nostrMockContext.vault.sign).not.toHaveBeenCalled();

        const request = approvalQueue.getNextPending();
        expect(request?.operation).toBe("sign_event");
        expect(request?.event?.kind).toBe(1);
        approvalQueue.resolve(request!.id, "allow_once");

        const result = await resultPromise;

        expect(windowManager).toHaveBeenCalled();
        expect(result.ok).toBe(true);
        expect(nostrMockContext.vault.sign).toHaveBeenCalledTimes(1);
      });

      it("should return needs_approval for protected auto-allow results without a queue", async () => {
        nostrMockContext.policy.evaluate = vi
          .fn()
          .mockResolvedValue({ mode: "allow", reason: "trust" });
        const message = {
          type: "nostr.signEvent",
          event: { ...validUnsignedEvent, kind: 1 },
          origin: "https://example.com",
        } as const;

        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(
            RPC_ERROR_CODES.NEEDS_APPROVAL
          );
        }
        expect(nostrMockContext.vault.sign).not.toHaveBeenCalled();
      });

      it("should return error for invalid event", async () => {
        const message = {
          type: "nostr.signEvent",
          event: { kind: "invalid" }, // kind should be number
          origin: "https://example.com",
        } as any;

        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_EVENT);
        }
      });

      it("should return error for invalid origin", async () => {
        const message = {
          type: "nostr.signEvent",
          event: validUnsignedEvent,
          origin: "not-a-valid-url",
        } as const;

        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_ORIGIN);
        }
      });

      it("should handle events with tags", async () => {
        const eventWithTags = {
          ...validUnsignedEvent,
          tags: [
            [
              "p",
              "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
            ],
            [
              "e",
              "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
            ],
          ],
        };

        const message = {
          type: "nostr.signEvent",
          event: eventWithTags,
          origin: "https://example.com",
        } as const;

        const result = await handler.handleRequest(message, nostrMockContext);

        expect(result.ok).toBe(true);
        if (result.ok) {
          const data = result.data as { event: any };
          expect(data.event.tags).toEqual(eventWithTags.tags);
        }
      });
    });

    it("should handle unsupported methods", async () => {
      const message = { type: "nostr.unsupported" } as any;
      const result = await handler.handleRequest(message, nostrMockContext);

      expect(result).toEqual(
        createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: "nostr.unsupported",
          method: "nostr.unsupported",
        })
      );
    });
  });

  describe("ApprovalRpcHandler", () => {
    let handler: any;
    let mockQueue: any;

    beforeEach(async () => {
      // Import dynamically to avoid hoisting issues
      const { ApprovalRpcHandler } = await import(
        "@/infrastructure/messaging/handlers/approval-rpc"
      );

      // Create mock queue
      mockQueue = {
        getNextPending: vi.fn(),
        getById: vi.fn(),
        resolve: vi.fn(),
        count: vi.fn(),
      };

      handler = new ApprovalRpcHandler(mockQueue);
    });

    describe("approval.getNext", () => {
      it("should return next pending request", async () => {
        const mockRequest = {
          id: "test-id",
          origin: "https://example.com",
          operation: "sign_event" as const,
          event: { kind: 1, content: "test", tags: [], created_at: 123 },
          createdAt: 123,
          timeoutAt: 183,
        };
        mockQueue.getNextPending.mockReturnValue(mockRequest);

        const message = { type: "approval.getNext" } as const;
        const result = await handler.handleRequest(message, mockContext);

        expect(result.ok).toBe(true);
        expect((result as any).data.request).toEqual(mockRequest);
      });

      it("should return null when queue is empty", async () => {
        mockQueue.getNextPending.mockReturnValue(undefined);

        const message = { type: "approval.getNext" } as const;
        const result = await handler.handleRequest(message, mockContext);

        expect(result.ok).toBe(true);
        expect((result as any).data.request).toBeNull();
      });
    });

    describe("approval.count", () => {
      it("should return pending count", async () => {
        mockQueue.count.mockReturnValue(3);

        const message = { type: "approval.count" } as const;
        const result = await handler.handleRequest(message, mockContext);

        expect(result.ok).toBe(true);
        expect((result as any).data.count).toBe(3);
      });
    });

    describe("approval.resolve", () => {
      it("should resolve request with allow action", async () => {
        const requestId = "00000000-0000-4000-8000-000000000001";
        const mockRequest = {
          id: requestId,
          origin: "https://example.com",
          operation: "sign_event" as const,
          event: { kind: 1, content: "test", tags: [], created_at: 123 },
          createdAt: 123,
          timeoutAt: 183,
        };
        mockQueue.getById.mockReturnValue(mockRequest);
        mockQueue.resolve.mockReturnValue(true);

        const message = {
          type: "approval.resolve",
          requestId,
          action: "allow",
        } as const;
        const result = await handler.handleRequest(message, mockContext);

        expect(result.ok).toBe(true);
        expect((result as any).data.resolved).toBe(true);
        expect(mockQueue.resolve).toHaveBeenCalledWith(requestId, "allow");
      });

      it("should return error for non-existent request", async () => {
        mockQueue.getById.mockReturnValue(undefined);

        const message = {
          type: "approval.resolve",
          requestId: "non-existent",
          action: "allow",
        } as const;
        const result = await handler.handleRequest(message, mockContext);

        expect(result.ok).toBe(false);
        expect((result as any).error.data.errorCode).toBe(
          RPC_ERROR_CODES.INVALID_PARAMS
        );
      });

      it("should update policy on deny_remember action", async () => {
        const requestId = "00000000-0000-4000-8000-000000000002";
        const mockRequest = {
          id: requestId,
          origin: "https://example.com",
          operation: "sign_event" as const,
          event: { kind: 1, content: "test", tags: [], created_at: 123 },
          createdAt: 123,
          timeoutAt: 183,
        };
        mockQueue.getById.mockReturnValue(mockRequest);
        mockQueue.resolve.mockReturnValue(true);

        const message = {
          type: "approval.resolve",
          requestId,
          action: "deny_remember",
        } as const;
        const result = await handler.handleRequest(message, mockContext);

        expect(result.ok).toBe(true);
        expect(mockContext.policy.setPerKindRule).toHaveBeenCalledWith(
          "https://example.com",
          1,
          "deny"
        );
      });

      it("should update policy on allow action for unprotected kinds", async () => {
        const requestId = "00000000-0000-4000-8000-000000000003";
        const mockRequest = {
          id: requestId,
          origin: "https://example.com",
          operation: "sign_event" as const,
          event: { kind: 10002, content: "test", tags: [], created_at: 123 },
          createdAt: 123,
          timeoutAt: 183,
        };
        mockQueue.getById.mockReturnValue(mockRequest);
        mockQueue.resolve.mockReturnValue(true);

        const message = {
          type: "approval.resolve",
          requestId,
          action: "allow",
        } as const;
        await handler.handleRequest(message, mockContext);

        expect(mockContext.policy.setPerKindRule).toHaveBeenCalledWith(
          "https://example.com",
          10002,
          "allow"
        );
        expect(mockQueue.resolve).toHaveBeenCalledWith(requestId, "allow");
      });

      it("should not update policy on allow_once action", async () => {
        const requestId = "00000000-0000-4000-8000-000000000004";
        const mockRequest = {
          id: requestId,
          origin: "https://example.com",
          operation: "sign_event" as const,
          event: { kind: 10002, content: "test", tags: [], created_at: 123 },
          createdAt: 123,
          timeoutAt: 183,
        };
        mockQueue.getById.mockReturnValue(mockRequest);
        mockQueue.resolve.mockReturnValue(true);

        const message = {
          type: "approval.resolve",
          requestId,
          action: "allow_once",
        } as const;
        await handler.handleRequest(message, mockContext);

        expect(mockContext.policy.setPerKindRule).not.toHaveBeenCalled();
        expect(mockQueue.resolve).toHaveBeenCalledWith(requestId, "allow_once");
      });

      it.each([1, 9734])(
        "should not persist remembered allow for protected kind %s",
        async (kind) => {
          const requestId = `00000000-0000-4000-8000-${String(kind).padStart(12, "0")}`;
          const mockRequest = {
            id: requestId,
            origin: "https://example.com",
            operation: "sign_event" as const,
            event: { kind, content: "test", tags: [], created_at: 123 },
            createdAt: 123,
            timeoutAt: 183,
          };
          mockQueue.getById.mockReturnValue(mockRequest);
          mockQueue.resolve.mockReturnValue(true);

          const message = {
            type: "approval.resolve",
            requestId,
            action: "allow",
          } as const;
          await handler.handleRequest(message, mockContext);

          expect(mockContext.policy.setPerKindRule).not.toHaveBeenCalled();
          expect(mockQueue.resolve).toHaveBeenCalledWith(requestId, "allow");
        }
      );
    });

    it("should handle unsupported methods", async () => {
      const message = { type: "approval.unsupported" } as any;
      const result = await handler.handleRequest(message, mockContext);

      expect(result).toEqual(
        createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
          details: "approval.unsupported",
          method: "approval.unsupported",
        })
      );
    });
  });
});
