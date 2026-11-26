import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SealMark } from "@/components/common/SealMark";
import {
  SettingsRow,
  SettingsSection,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { ReauthDialog } from "@/ui/components/dialogs/ReauthDialog";
import { useReauth } from "@/ui/hooks/useReauth";
import { useBiometricStatus } from "@/ui/hooks/useBiometricStatus";
import { CeremonyError } from "@/application/ports/webauthn";
import { IS_CHROMIUM_BUILD } from "@/domain/platform/build-target";
import { BIOMETRIC_PRF_LENGTH } from "@/domain/types";
import { zeroize } from "@/domain/utils/memory";
import {
  RpcClientError,
  biometricEnroll,
  biometricForget,
} from "@/infrastructure/messaging/client";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { BrowserWebAuthnCeremony } from "@/infrastructure/webauthn/webauthn-ceremony.adapter";

/** Why an enrolment ended with nothing enrolled. */
interface EnrolmentNotice {
  kind: "cancelled" | "no_output" | "refused";
  /** A passkey may have been created and left in the provider's manager. */
  entryMayRemain: boolean;
}

/**
 * The providers named here are the ones measured in
 * `openspec/changes/add-biometric-unlock/prf-platform-matrix.md`. The code
 * cannot detect which provider the user picked, so this is copy that the
 * matrix maintains.
 */
const NOTICE_COPY: Record<EnrolmentNotice["kind"], string> = {
  cancelled:
    "Nothing was set up. If your passkey provider refused, try again and choose Apple Passwords. 1Password does not save passkeys for browser extensions.",
  no_output:
    "That passkey provider cannot be used to unlock a vault, so nothing was set up. Apple Passwords works.",
  refused:
    "The vault did not accept that passkey, so nothing was set up. Try again.",
};

const ENTRY_MAY_REMAIN =
  " A passkey named “Ostrilo vault unlock” may have been saved; you can delete it in your passkey provider.";

function noticeOf(error: unknown): EnrolmentNotice {
  if (error instanceof CeremonyError) {
    return { kind: error.failure, entryMayRemain: error.entryMayRemain };
  }
  return { kind: "cancelled", entryMayRemain: false };
}

/**
 * Runs the ceremony and enrols in one request.
 *
 * The ceremony runs here, in the document that already holds the password, so
 * neither the password nor the authenticator's output is handed between
 * documents or parked anywhere. Both are cleared when the request settles.
 *
 * Returns a notice when nothing was enrolled for a reason that is not the
 * password. A wrong password is thrown, so the dialog that asked for it can
 * say so.
 */
async function enrolWithPassword(password: string): Promise<EnrolmentNotice | null> {
  const salt = crypto.getRandomValues(new Uint8Array(BIOMETRIC_PRF_LENGTH));
  let enrolled;
  try {
    enrolled = await BrowserWebAuthnCeremony.enroll(salt);
  } catch (error) {
    return noticeOf(error);
  }

  const wire = Array.from(enrolled.prfOutput);
  try {
    await biometricEnroll(password, enrolled.factor, wire);
    return null;
  } catch (error) {
    await BrowserWebAuthnCeremony.discard(enrolled.factor.credentialId);
    if (
      error instanceof RpcClientError &&
      error.errorCode === RPC_ERROR_CODES.BIOMETRIC_REJECTED
    ) {
      return { kind: "refused", entryMayRemain: true };
    }
    throw error;
  } finally {
    zeroize(enrolled.prfOutput);
    wire.fill(0);
  }
}

/** What turning this on means, said before the user turns it on. */
function Disclosure() {
  return (
    <ul className="mt-2 list-disc space-y-1 px-5 text-[13px] leading-snug text-muted-foreground">
      <li>
        The passkey is kept by your passkey provider and may sync to your other
        devices. Device unlock is then as strong as that account.
      </li>
      <li>
        Your master password stays required: after a browser restart, every 30
        days, and for anything that reveals or changes a key.
      </li>
      <li>
        Deleting the passkey loses only this shortcut. Your password still opens
        the vault.
      </li>
      <li>
        You can be compelled to use your device in situations where you could
        not be compelled to say a password.
      </li>
      <li>It applies to this browser profile only.</li>
    </ul>
  );
}

/**
 * Biometric unlock, on the Security tab.
 *
 * Absent from a build that does not carry the feature. Where the browser
 * cannot run a ceremony it explains that in a row with no control: a disabled
 * switch would be a promise the surface cannot keep.
 */
export function BiometricUnlockSection() {
  const { status, refresh } = useBiometricStatus();
  const [capable, setCapable] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<EnrolmentNotice | null>(null);
  const reauth = useReauth();

  useEffect(() => {
    if (!IS_CHROMIUM_BUILD) return;
    let live = true;
    void BrowserWebAuthnCeremony.probe().then((ok) => {
      if (live) setCapable(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!IS_CHROMIUM_BUILD || status === null || capable === null) return null;

  const turnOn = async () => {
    setNotice(null);
    try {
      await reauth.request(
        {
          action: "Turn on device unlock.",
          consequence:
            "Your device will ask you to confirm twice: once to save a passkey, and once to use it.",
        },
        async (password) => setNotice(await enrolWithPassword(password))
      );
    } catch {
      // Cancelled at the password prompt. Nothing was created.
    }
    await refresh();
  };

  const turnOff = async () => {
    await biometricForget();
    setNotice(null);
    await refresh();
  };

  return (
    <SettingsSection label="Device unlock">
      <div className="ink-card">
        {status.enrolled ? (
          <SettingsRow
            label="Device unlock is on"
            description={
              <>
                Added{" "}
                {status.enrolledAt
                  ? new Date(status.enrolledAt).toLocaleDateString()
                  : "earlier"}
                .{" "}
                {status.synced
                  ? "This passkey may sync through your passkey provider, so it is as strong as that account."
                  : "This passkey stays on this device."}{" "}
                Turning it off needs no password.
              </>
            }
            control={
              <Button variant="outline" className="h-10" onClick={() => void turnOff()}>
                Turn off
              </Button>
            }
          />
        ) : capable ? (
          <SettingsRow
            label="Unlock with your device"
            description="Use a passkey instead of typing your master password after each auto-lock."
            control={
              <Button variant="outline" className="h-10" onClick={() => void turnOn()}>
                Turn on
              </Button>
            }
          />
        ) : (
          <SettingsRow
            label="Unlock with your device"
            description="This browser has no passkey provider that can do this, so the master password is the only way to unlock."
          />
        )}
      </div>

      {!status.enrolled && capable && <Disclosure />}

      {notice && (
        <output className="mt-3 flex items-start gap-2.5 rounded-[10px] bg-[var(--ink-amber-soft)] p-3 text-xs text-[var(--ink-amber)]">
          <SealMark icon={ShieldAlert} tone="warning" size="sm" className="mt-px" />
          <p>
            {NOTICE_COPY[notice.kind]}
            {notice.entryMayRemain && ENTRY_MAY_REMAIN}
          </p>
        </output>
      )}

      <ReauthDialog {...reauth.dialogProps} />
    </SettingsSection>
  );
}
