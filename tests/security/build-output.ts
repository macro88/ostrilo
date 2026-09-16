import { expect, it } from "vitest";

/**
 * Shared entry condition for the two suites that assert on `.output/`.
 *
 * THE PROBLEM THIS SOLVES. `manifest-assertions.test.ts` and
 * `key-handling-bundle.test.ts` read what WXT actually emitted, so they need a
 * build. CI splits those two things across jobs on purpose: `Typecheck and
 * tests` runs the suite without building, `Extension builds` builds. Left
 * alone that gives you one of two failures, and this repository has now had
 * both:
 *
 *   - Skip when unbuilt, and the guard evaporates. `manifest-assertions`
 *     skipped silently in the only job that ran it, and the real assertions
 *     never executed anywhere until the build job was taught to re-run them.
 *   - Fail when unbuilt, and the guard fails the wrong job.
 *     `key-handling-bundle` took this route - "a skip is not a pass" - and so
 *     it reliably failed `Typecheck and tests`, which is not the job that was
 *     ever going to produce `.output/`.
 *
 * THE RULE. A missing `.output/` is only a defect when something promised to
 * have built it. `OSTRILO_REQUIRE_BUILD_OUTPUT=1` is that promise: the caller
 * is asserting it has just run the builds, so absent output is a hard failure.
 * Without it the suite skips and says which command to run.
 *
 * Set the variable wherever the builds have genuinely happened - that is
 * `pnpm run test:build-output`, and the `Extension builds` job which uses it.
 * Never set it repository-wide; that just reinstates the failing-in-the-wrong-
 * job behaviour it exists to remove.
 */
export const BUILD_OUTPUT_REQUIRED =
  process.env.OSTRILO_REQUIRE_BUILD_OUTPUT === "1";

/**
 * Declares the entry condition for one build target and reports whether the
 * caller should go on to register its real assertions.
 *
 * Registers exactly one test either way, so a target that was never built is
 * always visible in the report rather than silently absent.
 */
export function buildOutputPresent(
  present: boolean,
  buildCommand: string
): boolean {
  if (present) return true;

  if (BUILD_OUTPUT_REQUIRED) {
    it(`MISSING BUILD OUTPUT - OSTRILO_REQUIRE_BUILD_OUTPUT is set, so \`${buildCommand}\` was expected to have run already`, () => {
      expect(present).toBe(true);
    });
  } else {
    it.skip(
      `SKIPPED - run \`${buildCommand}\` first (or \`pnpm run test:build-output\`); a skip is not a pass`,
      () => {}
    );
  }

  return false;
}
