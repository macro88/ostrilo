import { describeViolation } from "@/domain/utils/password-policy";
import { evaluatePasswordStrength } from "@/infrastructure/messaging/client";

/**
 * The reason a new master password cannot be used, or `""` when it can.
 *
 * The verdict comes from the background, which has the blocklist, so
 * `acceptable` is authoritative. A score threshold here would drop the domain
 * predicate's length term and accept "Aa1!" as a vault password.
 */
export async function newPasswordProblem(
  password: string,
  confirmation: string
): Promise<string> {
  if (!password) return "Password is required";
  if (password !== confirmation) return "Passwords do not match";
  try {
    const strength = await evaluatePasswordStrength(password);
    if (strength.acceptable) return "";
    return strength.violations.length > 0
      ? describeViolation(strength.violations[0])
      : "Password does not meet the policy.";
  } catch {
    return "Could not validate password strength";
  }
}
