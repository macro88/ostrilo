## ADDED Requirements

### Requirement: Biometric Unlock Wraps The Existing Vault Key And Never Replaces The Password

The extension SHALL store biometric unlock material only as an additional authenticated encryption of the same vault key-encryption key the password produces. It SHALL NOT create a second key-encryption key, SHALL NOT store a plaintext key released after a successful assertion, and SHALL NOT offer any state in which a password is not enrolled.

#### Scenario: The wrapped key is the same key the password produces

- **GIVEN** a vault with a biometric factor enrolled
- **WHEN** the key recovered from the biometric wrapping is compared with the key the password derives
- **THEN** the two are byte-identical
- **AND** the vault holds exactly one key-encryption key

#### Scenario: The password cannot be removed

- **GIVEN** a vault with a biometric factor enrolled
- **WHEN** the user looks for a way to remove the password
- **THEN** no surface offers one
- **AND** the enrolment disclosure states that the password remains required

#### Scenario: No plaintext key is stored for release after an assertion

- **WHEN** the stored biometric record is inspected
- **THEN** it contains no private key, no plaintext key-encryption key, and no value that yields either without the authenticator's pseudo-random-function output

### Requirement: The Authenticator's Output Is The Only Thing That Opens The Wrapping

The extension SHALL admit a biometric unlock only when a key derived from the authenticator's pseudo-random-function output opens the stored wrapping and the recovered key then decrypts the vault envelope verifier. The background SHALL NOT accept any statement from a document — that a ceremony took place, that the user was verified, that an assertion was valid — in place of that decryption. The extension SHALL NOT verify a WebAuthn assertion signature as an admission gate, and SHALL NOT claim a replay defence it does not have.

The pseudo-random-function output is a static secret: the same credential and salt always produce the same 32 bytes. Anyone who holds that output together with a copy of extension storage can recover the key-encryption key without the background, so no check the background performs can make a captured output worthless. Documentation and user-facing copy SHALL describe the output on those terms: it is equivalent to the key-encryption key for anyone who can read extension storage, and it is revoked only by forgetting the factor or changing the password.

#### Scenario: A wrong output unlocks nothing

- **GIVEN** a vault with a biometric factor enrolled
- **WHEN** an unlock is requested with 32 bytes that are not the authenticator's output
- **THEN** the wrapping fails authenticated decryption
- **AND** the vault stays locked

#### Scenario: A document's claim is not a substitute for the secret

- **WHEN** the biometric unlock request schema is inspected
- **THEN** it carries the credential identifier and the pseudo-random-function output
- **AND** it carries no field by which a document reports that verification succeeded

#### Scenario: No surface claims a captured output is harmless

- **WHEN** the storage-format documentation and the enable-time disclosure are inspected
- **THEN** neither states that a captured pseudo-random-function output cannot unlock the vault
- **AND** the documentation states that forgetting the factor or changing the password is what revokes one

### Requirement: The Wrapping Is Bound To The Live Envelope And To Its Own Credential

The additional authenticated data for the wrapped key SHALL bind the live vault envelope version, every key-derivation cost field and the envelope salt, the wrapper version, the credential identifier, the pseudo-random-function salt, the derivation info version and the backup-eligible flag recorded at enrolment. No mutable field SHALL be bound.

#### Scenario: A rolled-back envelope breaks the wrapping

- **GIVEN** a stored wrapping bound to the live envelope's derivation parameters
- **WHEN** the envelope is replaced with one carrying different parameters or a different salt
- **THEN** the wrapping no longer decrypts

#### Scenario: A rewritten credential identifier or salt breaks the wrapping

- **GIVEN** an attacker with write access to extension storage
- **WHEN** they replace the recorded credential identifier or pseudo-random-function salt
- **THEN** the wrapping no longer decrypts
- **AND** no key-encryption key is recovered

#### Scenario: A flipped backup-eligible flag breaks the wrapping

- **WHEN** the recorded backup-eligible flag is altered in storage
- **THEN** the wrapping no longer decrypts
- **AND** the Security tab therefore cannot be made to show a synced credential as device-bound

#### Scenario: Renaming a factor re-encrypts nothing

- **WHEN** the factor label, transports, or last-use timestamps are written
- **THEN** the wrapping is unchanged
- **AND** biometric unlock continues to work

### Requirement: Enrolment Proves A Full Round Trip Before Anything Is Persisted

Enrolment SHALL perform credential creation followed by an immediate assertion, SHALL require exactly 32 bytes of pseudo-random-function output from that assertion, and SHALL wrap the live key-encryption key and unwrap it back to the identical bytes before writing any record. A reported extension-enabled value SHALL NOT be treated as proof that output is available. If any step fails, nothing SHALL be persisted, and the surface SHALL say that a passkey entry may have been left in the platform's credential manager.

#### Scenario: An authenticator that reports support but returns no output enrols nothing

- **GIVEN** an authenticator reporting the extension as enabled at creation
- **WHEN** the immediate assertion returns no pseudo-random-function output
- **THEN** enrolment fails
- **AND** no factor record is written

#### Scenario: A failed unwrap check enrols nothing

- **WHEN** the wrapped key does not unwrap back to the identical key-encryption key bytes
- **THEN** enrolment fails
- **AND** no factor record is written

#### Scenario: A stray credential is reported, not hidden

- **GIVEN** an enrolment that created a credential and then failed
- **WHEN** the failure is shown
- **THEN** the extension asks the platform to drop the credential where the platform offers a way to
- **AND** the surface states that an entry may remain in the platform's credential manager

### Requirement: Enrolment Runs In The Document That Holds The Password

The enrolment ceremony SHALL run in the options page, in the same document whose re-authentication dialog collected the password. The password and the pseudo-random-function output SHALL be sent to the background in one enrolment request. Neither SHALL be passed to another document, staged in storage, or held by the background between requests, and the background SHALL NOT hold a key-encryption key while waiting for a ceremony.

#### Scenario: One request carries both secrets

- **WHEN** the enrolment request schema is inspected
- **THEN** it carries the password, the pseudo-random-function output, the credential identifier, the pseudo-random-function salt, the transports and the backup-eligible flag
- **AND** no earlier request has handed the background the password or a key derived from it

#### Scenario: The background holds nothing between requests

- **GIVEN** an enrolment the user abandons at the authenticator prompt
- **WHEN** background state is inspected
- **THEN** it holds no password, no key-encryption key and no pending enrolment

### Requirement: The Unlock Ceremony Runs In A Visible Dedicated Extension Document

The unlock ceremony SHALL run in a dedicated extension document opened as a window. The extension SHALL NOT run a ceremony in the toolbar action popup, the side panel, an offscreen document, or a hidden frame. Credential-management API usage SHALL appear in exactly one adapter module, imported only by the ceremony document and the options page.

#### Scenario: Two documents reach the adapter and no others

- **WHEN** the codebase is searched for credential-management API usage
- **THEN** it appears only in the ceremony adapter
- **AND** the adapter is imported only by the ceremony document and the options page

### Requirement: The Relying Party Identifier Is The Extension Origin

Credential creation SHALL omit the relying-party identifier member of its relying-party parameter, and assertion SHALL omit its relying-party identifier parameter, so the browser supplies the extension origin. Neither ceremony SHALL hardcode a relying-party identifier. No host permission SHALL be added for a relying-party identifier; that obligation is owned by the extension manifest policy.

#### Scenario: No relying-party identifier is sent

- **WHEN** credential creation is invoked
- **THEN** the request carries no relying-party identifier
- **AND** the browser supplies the extension origin

#### Scenario: Assertion omits the relying-party identifier too

- **WHEN** an assertion is requested
- **THEN** the request carries no relying-party identifier

### Requirement: User Verification Is Required And Its Enforcement Is Stated Honestly

Both ceremonies SHALL request user verification as required. The background cannot observe whether verification happened, so the property SHALL rest on the authenticator binding its pseudo-random-function output to user verification, and SHALL be measured rather than assumed: the platform matrix SHALL record, for every authenticator class the feature is offered on, whether a presence-only ceremony can return the enrolled output. An authenticator class that returns the enrolled output without user verification SHALL NOT be offered.

#### Scenario: Both ceremonies ask for verification

- **WHEN** credential creation or an assertion is requested
- **THEN** user verification is requested as required

#### Scenario: A class that leaks the output without verification is excluded

- **GIVEN** the platform matrix records an authenticator class that returns the enrolled output to a presence-only ceremony
- **WHEN** the feature's supported classes are decided
- **THEN** that class is not offered
- **AND** the matrix records why

### Requirement: The Pseudo-Random-Function Output Is Input Keying Material, Not A Key

The 32-byte output SHALL be stretched with HKDF-SHA256 using an empty salt and a versioned, purpose-bound info string, and the derived wrapping key SHALL be produced as a non-extractable key that never exists as a byte buffer. The raw output SHALL NOT be imported as an encryption key.

#### Scenario: The wrapping key is not extractable

- **WHEN** the derived wrapping key is inspected
- **THEN** it is a non-extractable key object
- **AND** no code path exports its bytes

#### Scenario: The info string is versioned and purpose-bound

- **WHEN** the derivation info is inspected
- **THEN** it names this purpose and carries a version
- **AND** it includes the credential identifier

### Requirement: A Recovered Key Is Proven Against The Envelope Verifier

A key recovered from the biometric wrapping SHALL decrypt the vault envelope verifier before any per-record work, and a failure SHALL be reported identically to any other biometric failure.

#### Scenario: A rewritten wrapping yields a key that fails the verifier

- **GIVEN** an attacker who overwrites the stored wrapping with their own ciphertext
- **WHEN** a biometric unlock is attempted
- **THEN** the recovered value fails the envelope verifier
- **AND** the vault stays locked
- **AND** no per-record decryption is attempted

### Requirement: A Biometric Unlock Never Stands In For The Password

A biometric unlock SHALL open the vault and nothing more. It SHALL NOT satisfy any operation that asks for the password: revealing a key, generating or importing a key, deleting a key, changing the password, changing the auto-lock or session-timeout settings, raising an origin to high trust, setting an allow kind rule, enabling a session grant, or enrolling a biometric factor. The session record SHALL name the factor that opened it.

This is not a reduced tier of authority. Every one of those operations asks for the password in a password-opened session too, so the two sessions can do exactly the same things; the property is that no path accepts a biometric ceremony where the password is asked for, and it holds without new enforcement code. Policy mutations that are not password-gated today — lowering a trust level, setting a deny or ask kind rule, disabling a session grant, and removing an origin — remain reachable in either session. Widening the password gate over them is a separate change and SHALL NOT be claimed by this one.

#### Scenario: Reveal still asks for the password

- **GIVEN** a vault unlocked biometrically
- **WHEN** a key reveal is requested without the password
- **THEN** it is refused
- **AND** the refusal is the existing password requirement, not a new check

#### Scenario: Enrolling a factor still asks for the password

- **GIVEN** a vault unlocked biometrically
- **WHEN** biometric enrolment is requested without the password
- **THEN** it is refused

#### Scenario: A policy mutation that is not password-gated is not claimed to be blocked

- **GIVEN** a vault unlocked biometrically
- **WHEN** an origin's trust level is lowered, a deny rule is set, a session grant is disabled, or an origin is removed
- **THEN** the operation proceeds exactly as it would in a password session
- **AND** no surface states that a biometric session cannot change an origin policy

#### Scenario: Signing under existing policy still works

- **GIVEN** a vault unlocked biometrically
- **WHEN** an origin requests a signature its policy already permits
- **THEN** the signature is produced

#### Scenario: The session names its factor

- **WHEN** the session lock record is read after a biometric unlock
- **THEN** it records that a biometric factor opened it

### Requirement: At Most One Factor Is Enrolled

The vault SHALL hold at most one enrolled biometric factor. Enrolling while a factor already exists SHALL replace it in a single write, and SHALL NOT leave two records or a partially written one.

#### Scenario: A second enrolment replaces the first

- **GIVEN** a vault with one enrolled factor
- **WHEN** enrolment succeeds with a different authenticator
- **THEN** exactly one factor record exists
- **AND** it is the newly enrolled one
- **AND** the replaced credential no longer unlocks the vault

#### Scenario: A failed replacement leaves the existing factor intact

- **GIVEN** a vault with one enrolled factor
- **WHEN** a replacement enrolment fails at any step
- **THEN** the existing factor record is unchanged
- **AND** it still unlocks the vault

### Requirement: Enrolment Requires The Password And Revocation Requires Nothing

Enrolment SHALL require the vault password and an unlocked vault. Forgetting a factor SHALL require no credential and SHALL be reachable while the vault is locked. Forgetting a factor SHALL delete only the wrapping and SHALL NOT alter the envelope, any key record, or the password.

#### Scenario: A user with a dead authenticator is not stuck

- **GIVEN** a locked vault whose enrolled authenticator no longer exists
- **WHEN** the user chooses to forget the factor
- **THEN** it is deleted without any credential
- **AND** the password still unlocks the vault

#### Scenario: Forgetting leaves the vault otherwise untouched

- **WHEN** a factor is forgotten
- **THEN** the envelope, every key record and the password are unchanged

### Requirement: A Vault That Needs The Password Once Refuses Biometric Unlock

The extension SHALL refuse biometric enrolment and biometric unlock when any stored key record carries no format version field, and SHALL refuse biometric unlock while a password-change journal is present. Both conditions are resolved only by a password unlock: a legacy record is migrated under the password, and an interrupted password change is recovered by trying the password against both journalled states, which a factor cannot do. The status method SHALL report this as a named state so the surface can say that the password is needed this time.

#### Scenario: A legacy record blocks enrolment

- **GIVEN** a vault holding at least one unversioned key record
- **WHEN** biometric enrolment is attempted
- **THEN** it is refused with an explanation naming the password unlock as the next step

#### Scenario: An interrupted password change blocks biometric unlock

- **GIVEN** a stored password-change journal
- **WHEN** a biometric unlock is attempted
- **THEN** it is refused before the supplied output is evaluated
- **AND** the journal, the envelope and every key record are left exactly as they were
- **AND** the status method reports that the password is needed this time

### Requirement: The Password Is Rehearsed And The First Unlock Of A Session Uses It

The extension SHALL refuse biometric unlock when no password unlock has occurred within the rehearsal interval, and SHALL refuse biometric unlock for the first unlock after a browser restart or extension update. Both states SHALL be reported as distinct, named states by the status method, so a surface can withdraw the affordance rather than offer one that fails. How each state is rendered is owned by the unlock-feedback capability.

Both rules are availability and coercion controls, not cryptographic ones: the rehearsal timestamp and the session marker are ordinary stored values, and a party that can write extension storage can move them. They SHALL NOT be described as a defence against such a party.

#### Scenario: Rehearsal-due is refused and reported

- **GIVEN** no password unlock within the rehearsal interval
- **WHEN** a biometric unlock is attempted
- **THEN** the background refuses it
- **AND** the status method reports the rehearsal-due state by name

#### Scenario: The first unlock after a restart uses the password

- **GIVEN** a browser that has just started
- **WHEN** a biometric unlock is attempted before any password unlock in that browser session
- **THEN** the background refuses it
- **AND** the status method reports the restart-pending state by name
- **AND** a later unlock in the same browser session SHALL offer it when a usable factor is enrolled and the rehearsal is not due

### Requirement: An Envelope Write Deletes The Biometric Wrapping

Any write of the vault envelope SHALL delete the biometric factor record as part of the same operation, and SHALL delete it before the envelope is written, so an interruption between the two leaves a vault with no factor rather than a factor bound to an envelope that is gone. This covers the first creation of an envelope, a completed password change, and both recovery branches of an interrupted one.

#### Scenario: A password change cannot strand a wrapping

- **GIVEN** a vault with a biometric factor enrolled
- **WHEN** the password is changed
- **THEN** the factor record is deleted before the new envelope is written
- **AND** a subsequent biometric unlock is refused
- **AND** the password-change surface says the factor must be enrolled again

#### Scenario: A recovered password change deletes it too

- **GIVEN** a vault with a biometric factor enrolled and an interrupted password change
- **WHEN** a password unlock recovers either journalled state
- **THEN** no factor record remains

### Requirement: The Feature Is Absent From Non-Chromium Builds

Builds for targets other than Chromium SHALL contain no biometric ceremony document, no reference to the credential-management API, no code that reads or writes the biometric wrapping, and no biometric control. The feature SHALL NOT be shipped as a disabled control. The biometric remote-procedure methods remain defined in every build so that the error-code capability can answer them uniformly: on such a build the status method reports the feature unavailable and every other biometric method refuses.

#### Scenario: The Firefox build contains none of it

- **WHEN** the Firefox build output is inspected
- **THEN** it contains no ceremony document
- **AND** it contains no credential-management API reference
- **AND** it contains no reference to the biometric wrapping's storage key
- **AND** the Security settings surface renders no biometric section

#### Scenario: A build without the feature refuses the methods

- **GIVEN** a build for a target other than Chromium
- **WHEN** a biometric method is invoked
- **THEN** the status method reports the feature unavailable
- **AND** every other biometric method is refused without reading or writing anything

### Requirement: A Biometric Refusal Does Not Say Which Step Failed

A refused biometric unlock or enrolment SHALL NOT let a caller learn which credential is enrolled or which step failed. The classification of refusals onto error codes is owned by the remote-procedure error-code capability; this requirement states only the caller-visible consequence. Whether a factor is enrolled is not hidden from an extension page — the status method reports it on purpose — and a refusal SHALL NOT be a second source of it. A user cancellation SHALL NOT reach the background and SHALL NOT record a throttle failure.

#### Scenario: Failures are indistinguishable to the caller

- **WHEN** a biometric unlock fails at the factor lookup, the unwrap, or the envelope verifier
- **THEN** the caller cannot determine which step failed

#### Scenario: A cancellation is not a failure

- **GIVEN** a user who dismisses the authenticator prompt
- **WHEN** the ceremony is abandoned
- **THEN** no unlock request reaches the background
- **AND** no throttle failure is recorded
- **AND** the lock screen shows no error text

### Requirement: Enrolment Is Disclosed To The User

Enrolment SHALL be discoverable without any credential: the status method SHALL report that a usable factor exists, and SHALL report the date it was enrolled, so that a factor enrolled without the user's knowledge is surfaced on the next unlock. There is no cryptographic defence against a surface that has observed the password enrolling a factor, so visibility is the mitigation and it SHALL NOT be omitted. The Security tab SHALL also state whether the enrolled credential is one that syncs between devices. Which surfaces render this, and how, is owned by the unlock-feedback and options-page capabilities.

#### Scenario: An enrolled factor is reported to a locked vault

- **GIVEN** a locked vault with a factor enrolled
- **WHEN** the status method is called
- **THEN** it reports that a usable factor exists
- **AND** it reports the date the factor was enrolled
- **AND** it reports no credential identifier and no credential label

#### Scenario: A synced credential is shown as one

- **GIVEN** a factor whose backup-eligible flag was set at enrolment
- **WHEN** the Security tab lists the factor
- **THEN** it states that this credential syncs through the user's passkey provider
- **AND** it states that the factor is as strong as that account
