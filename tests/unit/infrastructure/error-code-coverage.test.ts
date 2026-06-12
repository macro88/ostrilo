/**
 * Error Code Coverage Tests
 * 
 * Verifies that all defined RPC error codes have structured metadata
 * and that no hardcoded error strings remain in RPC handlers.
 */

import { describe, it, expect } from "vitest";
import {
  RPC_ERROR_CODES,
  RPC_ERROR_MESSAGES,
  RPC_NUMERIC_ERROR_CODES,
  createRpcErrorResponse,
} from "@/infrastructure/messaging/error-codes";
import * as fs from "fs";
import * as path from "path";

describe("RPC Error Code Coverage", () => {
  const infrastructurePath = path.join(
    __dirname,
    "../../../src/infrastructure/messaging"
  );

  /**
   * Helper to read all TypeScript files in handlers directory
   */
  function getAllHandlerFiles(): string[] {
    const handlersPath = path.join(infrastructurePath, "handlers");
    const files = fs.readdirSync(handlersPath);
    return files
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => path.join(handlersPath, file));
  }

  /**
   * Helper to read router file
   */
  function getRouterFile(): string {
    return path.join(infrastructurePath, "rpc-router.ts");
  }

  /**
   * Helper to find hardcoded error strings (strings not using RPC_ERROR_CODES)
   */
  function findHardcodedErrorStrings(fileContent: string): string[] {
    const hardcoded: string[] = [];

    // Pattern: { ok: false, error: "some_string" } where "some_string" is not via RPC_ERROR_CODES
    const errorPatterns = [
      /{\s*ok:\s*false[^}]*error:\s*["'`]([^"'`]+)["'`]/g,
      /return\s*{\s*ok:\s*false[^}]*error:\s*["'`]([^"'`]+)["'`]/g,
    ];

    for (const pattern of errorPatterns) {
      let match;
      while ((match = pattern.exec(fileContent)) !== null) {
        const errorString = match[1];
        // Check if this is a known error code
        const isKnownCode = Object.values(RPC_ERROR_CODES).includes(
          errorString as any
        );
        // Skip template literals and variable interpolations
        const isTemplateLiteral = errorString.includes("${");
        const looksLikePlaceholder = errorString.includes("...");

        if (!isKnownCode && !isTemplateLiteral && !looksLikePlaceholder) {
          // Check context - if it's using RPC_ERROR_CODES constant, it's OK
          const contextStart = Math.max(0, match.index - 100);
          const contextEnd = Math.min(
            fileContent.length,
            match.index + match[0].length + 100
          );
          const context = fileContent.substring(contextStart, contextEnd);

          if (!context.includes("RPC_ERROR_CODES")) {
            hardcoded.push(errorString);
          }
        }
      }
    }

    return [...new Set(hardcoded)]; // Remove duplicates
  }

  describe("Error Code Usage Coverage", () => {
    const handlerFiles = getAllHandlerFiles();
    const routerFile = getRouterFile();
    const allRpcFiles = [...handlerFiles, routerFile];

    // Read all file contents once
    const fileContents = new Map<string, string>();
    for (const file of allRpcFiles) {
      fileContents.set(file, fs.readFileSync(file, "utf-8"));
    }

    it("should have all error codes defined in RPC_ERROR_CODES", () => {
      // Verify the constant object exists and has expected structure
      expect(RPC_ERROR_CODES).toBeDefined();
      expect(Object.keys(RPC_ERROR_CODES).length).toBeGreaterThan(0);
    });

    it("should define numeric mappings and default messages for every code", () => {
      for (const errorCode of Object.values(RPC_ERROR_CODES)) {
        expect(RPC_NUMERIC_ERROR_CODES[errorCode]).toEqual(
          expect.any(Number)
        );
        expect(RPC_ERROR_MESSAGES[errorCode]).toEqual(expect.any(String));
        expect(RPC_ERROR_MESSAGES[errorCode].length).toBeGreaterThan(0);
      }
    });

    it("should construct JSON-RPC style error objects", () => {
      const response = createRpcErrorResponse(RPC_ERROR_CODES.DENIED, {
        details: "user rejected",
        method: "nostr.signEvent",
      });

      expect(response).toEqual({
        ok: false,
        error: {
          code: RPC_NUMERIC_ERROR_CODES[RPC_ERROR_CODES.DENIED],
          message: RPC_ERROR_MESSAGES[RPC_ERROR_CODES.DENIED],
          data: {
            errorCode: RPC_ERROR_CODES.DENIED,
            details: "user rejected",
            method: "nostr.signEvent",
          },
        },
      });
    });

    it("should not have hardcoded error strings in handlers", () => {
      const filesWithHardcodedErrors: Array<{
        file: string;
        errors: string[];
      }> = [];

      for (const [file, content] of fileContents.entries()) {
        const hardcoded = findHardcodedErrorStrings(content);
        if (hardcoded.length > 0) {
          filesWithHardcodedErrors.push({
            file: path.basename(file),
            errors: hardcoded,
          });
        }
      }

      // If any hardcoded strings found, fail with helpful message
      if (filesWithHardcodedErrors.length > 0) {
        const errorReport = filesWithHardcodedErrors
          .map(
            ({ file, errors }) =>
              `  ${file}:\n` + errors.map((e) => `    - "${e}"`).join("\n")
          )
          .join("\n");

        expect.fail(
          `Found hardcoded error strings in RPC handlers:\n${errorReport}\n\n` +
            `All errors should use constants from RPC_ERROR_CODES.`
        );
      }
    });
  });

  describe("Error Code Completeness", () => {
    it("should have JSDoc comments for all error codes", () => {
      const errorCodesFile = path.join(
        infrastructurePath,
        "error-codes.ts"
      );
      const content = fs.readFileSync(errorCodesFile, "utf-8");

      const missingDocs: string[] = [];

      for (const constantName of Object.keys(RPC_ERROR_CODES)) {
        // Check if there's a JSDoc comment before this constant
        const pattern = new RegExp(
          `/\\*\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*/\\s*${constantName}:`
        );
        if (!pattern.test(content)) {
          missingDocs.push(constantName);
        }
      }

      if (missingDocs.length > 0) {
        expect.fail(
          `The following error codes lack JSDoc comments:\n` +
            missingDocs.map((code) => `  - ${code}`).join("\n")
        );
      }
    });

    it("should export RpcErrorCode type", () => {
      const errorCodesFile = path.join(
        infrastructurePath,
        "error-codes.ts"
      );
      const content = fs.readFileSync(errorCodesFile, "utf-8");

      expect(content).toContain("export type RpcErrorCode");
    });

    it("should mark RPC_ERROR_CODES as const", () => {
      const errorCodesFile = path.join(
        infrastructurePath,
        "error-codes.ts"
      );
      const content = fs.readFileSync(errorCodesFile, "utf-8");

      expect(content).toMatch(/export\s+const\s+RPC_ERROR_CODES\s*=\s*{[\s\S]*}\s+as\s+const/);
    });
  });

  describe("Error Code Categories", () => {
    it("should have authentication/authorization codes", () => {
      expect(RPC_ERROR_CODES.LOCKED).toBe("locked");
      expect(RPC_ERROR_CODES.DENIED).toBe("denied");
      expect(RPC_ERROR_CODES.NEEDS_APPROVAL).toBe("needs_approval");
    });

    it("should have validation error codes", () => {
      expect(RPC_ERROR_CODES.INVALID_EVENT).toBe("invalid_event");
      expect(RPC_ERROR_CODES.INVALID_ORIGIN).toBe("invalid_origin");
      expect(RPC_ERROR_CODES.INVALID_PASSWORD).toBe("invalid_password");
      expect(RPC_ERROR_CODES.INVALID_KEY_INPUT).toBe("invalid_key_input");
      expect(RPC_ERROR_CODES.INVALID_HASH).toBe("invalid_hash");
      expect(RPC_ERROR_CODES.INVALID_REQUEST).toBe("invalid_request");
      expect(RPC_ERROR_CODES.INVALID_PARAMS).toBe("invalid_params");
    });

    it("should have state error codes", () => {
      expect(RPC_ERROR_CODES.NO_KEY_SELECTED).toBe("no_key_selected");
      expect(RPC_ERROR_CODES.KEY_ALREADY_EXISTS).toBe("key_already_exists");
      expect(RPC_ERROR_CODES.KEY_NOT_FOUND).toBe("key_not_found");
    });

    it("should have operation error codes", () => {
      expect(RPC_ERROR_CODES.TIMEOUT).toBe("timeout");
      expect(RPC_ERROR_CODES.UNKNOWN_METHOD).toBe("unknown_method");
      expect(RPC_ERROR_CODES.UNKNOWN_NAMESPACE).toBe("unknown_namespace");
      expect(RPC_ERROR_CODES.APPROVAL_FAILED).toBe("approval_failed");
      expect(RPC_ERROR_CODES.SIGNING_FAILED).toBe("signing_failed");
      expect(RPC_ERROR_CODES.RATE_LIMITED).toBe("rate_limited");
      expect(RPC_ERROR_CODES.NETWORK_ERROR).toBe("network_error");
    });
  });
});
