import type { SecretBytes } from "@/application/ports/crypto";
import {
  BiometricPasswordNeededError,
  BiometricRejectedError,
} from "@/application/services/biometric-factor.service";
import {
  BiometricFactorSchema,
  CredentialIdSchema,
  PasswordSchema,
  PrfBytesSchema,
} from "@/infrastructure/validation/schemas";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "../error-codes";
import {
  rateLimitedResponse,
  withPasswordThrottle,
} from "../password-throttle";
import type { RpcRequest, RpcResponse } from "../rpc";
import type { ServiceContext } from "../rpc-router";
import { vaultProblemResponse } from "./vault-errors";

type BiometricRequest = Extract<
  RpcRequest,
  { type: `vault.biometric${string}` }
>;

/**
 * The one detail string every biometric refusal carries. A caller must not be
 * able to tell a missing factor from a mismatched credential, a failed
 * wrapping, a failed verifier or a rule that needs the password this time; the
 * status method is the only place any of that is disclosed.
 */
const REFUSAL_DETAILS = "Use your password to unlock.";

function refused(method: string): RpcResponse {
  return createRpcErrorResponse(RPC_ERROR_CODES.BIOMETRIC_REJECTED, {
    details: REFUSAL_DETAILS,
    method,
  });
}

function isRefusal(error: unknown): boolean {
  return (
    error instanceof BiometricRejectedError ||
    error instanceof BiometricPasswordNeededError
  );
}

async function handleStatus(context: ServiceContext, method: string): Promise<RpcResponse> {
  if (!context.vault.biometricAvailable) {
    return createRpcErrorResponse(RPC_ERROR_CODES.BIOMETRIC_UNAVAILABLE, { method });
  }
  return { ok: true, data: await context.vault.biometricStatus() };
}

async function handleUnlockRequest(
  context: ServiceContext,
  method: string
): Promise<RpcResponse> {
  try {
    return { ok: true, data: await context.vault.biometricUnlockRequest() };
  } catch (error) {
    if (isRefusal(error)) return refused(method);
    throw error;
  }
}

/**
 * Unlocks under the same throttle counter as the password.
 *
 * Checked before the vault is asked anything, so a refused attempt reads no
 * factor and derives no key. Only an output that was actually tried and failed
 * is charged: a cancelled ceremony never reaches here, and a refusal that
 * tested nothing is not a guess.
 */
async function handleUnlock(
  message: Extract<BiometricRequest, { type: "vault.biometricUnlock" }>,
  context: ServiceContext
): Promise<RpcResponse> {
  const credentialId = CredentialIdSchema.safeParse(message.credentialId);
  const prfOutput = PrfBytesSchema.safeParse(message.prfOutput);
  if (!credentialId.success || !prfOutput.success) return refused(message.type);

  const waitMs = await context.unlockThrottle.check();
  if (waitMs > 0) return rateLimitedResponse(waitMs, message.type);

  try {
    const result = await context.vault.unlockWithFactor(
      Uint8Array.from(credentialId.data),
      Uint8Array.from(prfOutput.data) as SecretBytes
    );
    await context.unlockThrottle.recordSuccess();
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof BiometricRejectedError && error.evaluated) {
      await context.unlockThrottle.recordFailure();
    }
    if (isRefusal(error)) return refused(message.type);
    const problem = vaultProblemResponse(error, message.type);
    if (problem) return problem;
    throw error;
  }
}

/**
 * Enrols a factor. The password is proven under the shared throttle exactly as
 * every other password check is, and a wrong one is reported as a wrong
 * password: that is a password error, not a biometric refusal.
 */
async function handleEnroll(
  message: Extract<BiometricRequest, { type: "vault.biometricEnroll" }>,
  context: ServiceContext
): Promise<RpcResponse> {
  const password = PasswordSchema.safeParse(message.password);
  if (!password.success) {
    return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PASSWORD, {
      details: password.error.issues[0]?.message,
      method: message.type,
    });
  }
  const factor = BiometricFactorSchema.safeParse(message.factor);
  const prfOutput = PrfBytesSchema.safeParse(message.prfOutput);
  if (!factor.success || !prfOutput.success) return refused(message.type);

  try {
    const result = await withPasswordThrottle(context, message.type, () =>
      context.vault.enrollBiometric(
        password.data,
        factor.data,
        Uint8Array.from(prfOutput.data) as SecretBytes
      )
    );
    return result.ok ? { ok: true, data: null } : result.response;
  } catch (error) {
    if (isRefusal(error)) return refused(message.type);
    throw error;
  }
}

/** Handles the `vault.biometric*` methods on behalf of `VaultRpcHandler`. */
export async function handleBiometricRequest(
  message: BiometricRequest,
  context: ServiceContext
): Promise<RpcResponse> {
  switch (message.type) {
    case "vault.biometricStatus":
      return handleStatus(context, message.type);
    case "vault.biometricUnlockRequest":
      return handleUnlockRequest(context, message.type);
    case "vault.biometricUnlock":
      return handleUnlock(message, context);
    case "vault.biometricForget":
      await context.vault.forgetBiometric();
      return { ok: true, data: null };
    case "vault.biometricEnroll":
      return handleEnroll(message, context);
  }
}
