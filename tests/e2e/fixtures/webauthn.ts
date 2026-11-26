import type { BrowserContext, Page } from "@playwright/test";

/**
 * Attaches a virtual authenticator to one page.
 *
 * WHAT THIS DOES NOT PROVE. A virtual authenticator answers for whatever
 * relying party the page presents, verifies the "user" by configuration, and
 * is not a passkey provider. It shows that the extension's own code runs a
 * ceremony and uses the result correctly. It says nothing about whether Apple
 * Passwords, Windows Hello, Google Password Manager or a security key accepts
 * an extension origin or returns a PRF output; those are measured by hand in
 * `openspec/changes/add-biometric-unlock/prf-platform-matrix.md`.
 *
 * The authenticator belongs to the page it was added to. A ceremony in another
 * window does not see its credentials, which is why the unlock test navigates
 * the enrolling page to the unlock document instead of opening a second one.
 */
export async function addVirtualAuthenticator(
  context: BrowserContext,
  page: Page
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
}
