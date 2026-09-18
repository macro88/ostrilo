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
- **THEN** it contains no private key, no plaintext key-encryption key, and no value that yields either without the authenticator

### Requirement: Biometric Unlock Requires Both A Wrapped-Key Gate And A Verified Assertion

The extension SHALL refuse a biometric unlock unless BOTH a key derived from the authenticator's pseudo-random-function output opens the stored wrapping AND a WebAuthn assertion is verified in the background against a single-use challenge. A caller supplying only a pseudo-random-function output SHALL be refused.

#### Scenario: A captured secret alone is not enough

- **GIVEN** an attacker holding a previously captured pseudo-random-function output
- **WHEN** they call the unlock method with it and no valid assertion
- **THEN** the unlock is refused
- **AND** no key material is returned

#### Scenario: A valid assertion with a wrong secret is not enough

- **GIVEN** a valid, freshly signed assertion
- **WHEN** the supplied pseudo-random-function output does not open the stored wrapping
- **THEN** the unlock is refused
- **AND** the failure is reported with the same code every other biometric failure uses

### Requirement: Assertion Verification Happens In The Background

The background SHALL mint a 32-byte challenge into session storage, SHALL consume it on read before any verification and regardless of outcome, and SHALL refuse a challenge that is absent, of the wrong purpose, or older than 120 seconds. It SHALL verify the assertion signature over the authenticator data concatenated with the hash of the client data against the public key recorded at enrolment, and SHALL independently check the client-data type, the challenge bytes, the origin, the relying-party identifier hash, the user-present bit, the user-verified bit and the backup-eligible bit. A boolean supplied by a document SHALL NOT be accepted as proof of any of these.

#### Scenario: A challenge cannot be replayed

- **GIVEN** a challenge that has been used in one unlock attempt
- **WHEN** the same challenge is presented again
- **THEN** the attempt is refused
- **AND** the refusal does not depend on whether the first attempt succeeded

#### Scenario: A document's claim of user verification is not trusted

- **GIVEN** a document reporting that user verification succeeded
- **WHEN** the user-verified bit in the signed authenticator data is clear
- **THEN** the unlock is refused

#### Scenario: An expired challenge is refused

- **GIVEN** a challenge minted more than 120 seconds ago
- **WHEN** an assertion citing it arrives
- **THEN** the unlock is refused

#### Scenario: An invalid signature is refused

- **GIVEN** an assertion whose signature does not verify against the recorded public key
- **WHEN** the background verifies it
- **THEN** the unlock is refused
- **AND** no wrapping is opened

### Requirement: Every Field The Verifier Consults Is Bound Into The Wrapping

The additional authenticated data for the wrapped key SHALL bind the live vault envelope version, every key-derivation cost field and the envelope salt, the wrapper version, the credential identifier, the recorded relying-party identifier hash, the recorded origin, the credential public key, the credential algorithm, the backup-eligible bit, the pseudo-random-function salt and the derivation info version. No mutable field SHALL be bound.

#### Scenario: A substituted public key breaks the wrapping

- **GIVEN** an attacker with write access to extension storage
- **WHEN** they replace the recorded credential public key with one they control
- **THEN** the wrapping no longer decrypts
- **AND** no key-encryption key is recovered

#### Scenario: A flipped backup-eligible bit breaks the wrapping

- **WHEN** the recorded backup-eligible bit is altered in storage
- **THEN** the wrapping no longer decrypts

#### Scenario: A rolled-back envelope breaks the wrapping

- **GIVEN** a stored wrapping bound to the live envelope's derivation parameters
- **WHEN** the envelope is replaced with one carrying different parameters or a different salt
- **THEN** the wrapping no longer decrypts

#### Scenario: Renaming a factor re-encrypts nothing

- **WHEN** the factor label, transports, or last-use timestamps are written
- **THEN** the wrapping is unchanged
- **AND** biometric unlock continues to work

### Requirement: The Relying Party Identity Is Recorded As Observed, Never Computed

Enrolment SHALL read the relying-party identifier hash from the registration authenticator data and the origin from the client data, and SHALL compare later assertions byte-for-byte against those recorded values. The extension SHALL NOT compute an expected relying-party identifier hash from a constructed string.

#### Scenario: The recorded hash is the one the authenticator signed

- **WHEN** a factor is enrolled
- **THEN** the stored relying-party identifier hash is the value read out of the registration authenticator data

#### Scenario: An assertion for a different relying party is refused

- **GIVEN** an assertion whose authenticator data carries a different relying-party identifier hash
- **WHEN** the background verifies it
- **THEN** the unlock is refused

### Requirement: Enrolment Proves A Full Round Trip Before Anything Is Persisted

Enrolment SHALL perform credential creation followed by an immediate assertion, SHALL require exactly 32 bytes of pseudo-random-function output from that assertion, and SHALL wrap the live key-encryption key and unwrap it back to the identical bytes before writing any record. A reported extension-enabled value SHALL NOT be treated as proof that output is available. If any step fails, nothing SHALL be persisted.

#### Scenario: An authenticator that reports support but returns no output enrols nothing

- **GIVEN** an authenticator reporting the extension as enabled at creation
- **WHEN** the immediate assertion returns no pseudo-random-function output
- **THEN** enrolment fails
- **AND** no factor record is written

#### Scenario: A failed unwrap check enrols nothing

- **WHEN** the wrapped key does not unwrap back to the identical key-encryption key bytes
- **THEN** enrolment fails
- **AND** no factor record is written

### Requirement: The Ceremony Runs In A Visible Dedicated Extension Document

Both ceremonies SHALL run in a dedicated extension document opened as a window. The extension SHALL NOT run a ceremony in the toolbar action popup, an offscreen document, or a hidden frame.

#### Scenario: The ceremony document is the only host

- **WHEN** the codebase is searched for credential-management API usage
- **THEN** it appears only in the ceremony adapter
- **AND** the adapter is reachable only from the ceremony document

### Requirement: The Relying Party Identifier Is The Extension Origin

Credential creation SHALL omit the relying-party identifier member of its relying-party parameter, and assertion SHALL omit its relying-party identifier parameter, so the browser supplies the extension origin. Neither ceremony SHALL hardcode a relying-party identifier. No host permission SHALL be added for a relying-party identifier; that obligation is owned by the extension manifest policy.

#### Scenario: No relying-party identifier is sent

- **WHEN** credential creation is invoked
- **THEN** the request carries no relying-party identifier
- **AND** the browser supplies the extension origin

#### Scenario: Assertion omits the relying-party identifier too

- **WHEN** an assertion is requested
- **THEN** the request carries no relying-party identifier
- **AND** the recorded relying-party identifier hash is used only to verify what comes back

### Requirement: User Verification Is Required And Independently Confirmed

Both ceremonies SHALL request user verification as required, and the background SHALL refuse any assertion whose signed user-verified bit is clear.

#### Scenario: A presence-only assertion is refused

- **GIVEN** an authenticator that signs with user presence but not user verification
- **WHEN** the background verifies the assertion
- **THEN** the unlock is refused

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

### Requirement: A Biometric Session Holds Reduced Authority

A session opened biometrically SHALL NOT authorize revealing or backing up a key, generating or importing a key, deleting a key, changing the auto-lock or session-timeout settings, raising an origin to high trust, setting an allow kind rule, enabling a session grant, or enrolling another biometric factor. The session record SHALL name the factor that opened it.

This list is exactly the set of operations that already require the password, so the property holds without new enforcement code. Policy mutations that are not password-gated today — lowering a trust level, setting a deny or ask kind rule, disabling a session grant, and removing an origin — remain reachable in a biometric session exactly as they are in a password session. Widening the password gate over them is a separate change and SHALL NOT be claimed by this one.

#### Scenario: Reveal is refused in a biometric session

- **GIVEN** a vault unlocked biometrically
- **WHEN** a key reveal is requested
- **THEN** it is refused
- **AND** the refusal is the existing password re-authentication requirement, not a new check

#### Scenario: Enrolling a factor is refused in a biometric session

- **GIVEN** a vault unlocked biometrically
- **WHEN** biometric enrolment is requested
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

### Requirement: A Legacy Vault Refuses Biometric Enrolment And Unlock

When any stored key record carries no format version field, the extension SHALL refuse both biometric enrolment and biometric unlock, and SHALL state that the vault must be opened once with the password first.

#### Scenario: A legacy record blocks enrolment

- **GIVEN** a vault holding at least one unversioned key record
- **WHEN** biometric enrolment is attempted
- **THEN** it is refused with an explanation naming the password unlock as the next step

### Requirement: The Password Is Rehearsed And The First Unlock Of A Session Uses It

The extension SHALL refuse biometric unlock when no password unlock has occurred within the rehearsal interval, and SHALL refuse biometric unlock for the first unlock after a browser restart or extension update. Both states SHALL be reported as distinct, named states by the status method, so a surface can withdraw the affordance rather than offer one that fails. How each state is rendered is owned by the unlock-feedback capability.

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

Any write of the vault envelope SHALL delete the biometric factor record in the same operation.

#### Scenario: A future password change cannot strand a wrapping

- **GIVEN** a vault with a biometric factor enrolled
- **WHEN** the envelope is written for any reason
- **THEN** the factor record is deleted in the same operation
- **AND** a subsequent biometric unlock is refused as not enrolled

### Requirement: The Feature Is Absent From Non-Chromium Builds

Builds for targets other than Chromium SHALL contain no biometric ceremony document, no biometric remote-procedure methods and no biometric control. The feature SHALL NOT be shipped as a disabled control.

#### Scenario: The Firefox build contains none of it

- **WHEN** the Firefox build output is inspected
- **THEN** it contains no ceremony document
- **AND** it contains no credential-management API reference
- **AND** the Security settings surface renders no biometric section

### Requirement: A Biometric Refusal Is Not An Oracle

A refused biometric unlock or enrolment SHALL NOT let a caller learn whether a factor is enrolled, which credential is enrolled, or which verification step failed. The classification of refusals onto error codes is owned by the remote-procedure error-code capability; this requirement states only the caller-visible consequence. A user cancellation SHALL NOT reach the background and SHALL NOT record a throttle failure.

#### Scenario: Failures are indistinguishable to the caller

- **WHEN** any biometric verification step fails
- **THEN** the caller cannot determine which step failed
- **AND** the caller cannot determine whether a factor is enrolled

#### Scenario: A cancellation is not a failure

- **GIVEN** a user who dismisses the authenticator prompt
- **WHEN** the ceremony is abandoned
- **THEN** no request reaches the background
- **AND** no throttle failure is recorded
- **AND** the lock screen shows no error text

### Requirement: Enrolment Is Disclosed To The User

Enrolment SHALL be discoverable without any credential: the status method SHALL report that a usable factor exists, and SHALL report the date it was enrolled, so that a factor enrolled without the user's knowledge is surfaced on the next unlock. There is no cryptographic defence against a surface that has observed the password enrolling a factor, so visibility is the mitigation and it SHALL NOT be omitted. Which surfaces render this, and how, is owned by the unlock-feedback and options-page capabilities.

#### Scenario: An enrolled factor is reported to a locked vault

- **GIVEN** a locked vault with a factor enrolled
- **WHEN** the status method is called
- **THEN** it reports that a usable factor exists
- **AND** it reports the date the factor was enrolled
- **AND** it reports no credential identifier and no credential label
