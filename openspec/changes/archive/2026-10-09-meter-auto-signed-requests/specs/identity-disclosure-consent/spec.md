## ADDED Requirements

### Requirement: The Public Key Rate Window Survives A Worker Restart

The extension SHALL keep the `nostr.getPublicKey` rate window across a restart of the background worker, so that an evicted worker does not return the allowance to an origin. This SHALL hold while the vault is locked, where no keepalive runs and the worker is routinely ended between calls. A request that arrives at a restarted worker SHALL be judged against the persisted window. A persisted window that cannot be read as valid SHALL be treated as empty. The persisted window is specified by `approval-flood-controls`, "Rate-Limit Counters Survive A Worker Restart".

#### Scenario: An exhausted allowance survives a restart

- **GIVEN** an origin has exhausted its `getPublicKey` allowance within the rate window
- **WHEN** the background worker is restarted and the origin calls `getPublicKey` again within that window
- **THEN** the request is refused with error code `rate_limited`
- **AND** no public key is returned
- **AND** no approval prompt is queued

#### Scenario: The allowance recovers on the original schedule

- **GIVEN** an origin exhausted its allowance before a restart
- **WHEN** the rate window, measured from the original calls, elapses
- **THEN** the origin may call `getPublicKey` again
