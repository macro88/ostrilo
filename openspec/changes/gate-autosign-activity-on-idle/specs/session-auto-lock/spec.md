## MODIFIED Requirements

### Requirement: Recorded Activity Postpones The Lock

The extension SHALL treat deliberate user action in an extension surface as activity that postpones the lock. Activity SHALL be recorded from the extension surfaces themselves, at the point of the deliberate action, and not only by a background method that no surface calls.

The extension SHALL additionally treat a signature produced for an origin request without an approval prompt as activity, but ONLY while the user is present at the machine as reported by the browser's idle state. Presence SHALL be determined from operating-system input, not from the request itself, and SHALL be evaluated over the configured inactivity window, so that a user who gave the machine any input inside that window counts as present. A reported state of idle or of an operating-system lock SHALL NOT count as presence.

Background bookkeeping, broadcast handling, relay traffic, lock-state polling from a locked UI, and rendering or updating a countdown display SHALL NOT count as activity. Activity reporting SHALL be throttled on every path that records it, including the background signing path, and MUST NOT keep the background worker alive for the sole purpose of tracking activity.

#### Scenario: User action in an extension surface records activity

- **GIVEN** the vault is unlocked
- **WHEN** the user unlocks the vault, selects a key, resolves an approval, or changes a setting from the popup, sidepanel, options tab, or approval window
- **THEN** the last-activity timestamp is updated
- **AND** the inactivity deadline is recomputed

#### Scenario: A signature records activity while the user is present

- **GIVEN** the vault is unlocked with an inactivity timeout of `5` minutes
- **AND** the user reacts to a post, which is signed without an approval prompt
- **AND** the user then reads for four minutes, giving the machine input as they read
- **WHEN** the user reacts to a second post
- **THEN** the second reaction is signed
- **AND** the last-activity timestamp is updated

#### Scenario: A signature does not record activity while the user is away

- **GIVEN** the vault is unlocked
- **AND** the browser reports the user as idle
- **WHEN** an origin request is signed without an approval prompt
- **THEN** the last-activity timestamp is not updated
- **AND** the inactivity deadline is unchanged

#### Scenario: A signature does not record activity behind an operating-system lock

- **GIVEN** the vault is unlocked
- **AND** the operating-system session is locked
- **WHEN** an origin request is signed without an approval prompt
- **THEN** the last-activity timestamp is not updated

#### Scenario: A signing origin cannot hold the vault open once the user leaves

- **GIVEN** the vault is unlocked with an inactivity timeout of `5` minutes
- **AND** an origin whose requests are signed without an approval prompt sends one request every minute
- **WHEN** the user leaves the machine and gives it no input for the whole window
- **THEN** the vault is locked
- **AND** subsequent requests from that origin are refused with the `locked` error code

#### Scenario: Signature activity is throttled

- **GIVEN** the vault is unlocked and the user is present
- **WHEN** an origin's requests are signed repeatedly within the throttle window
- **THEN** at most one activity report is recorded for that window
- **AND** the inactivity deadline is postponed

#### Scenario: An idle open surface does not postpone the lock

- **GIVEN** the vault is unlocked
- **AND** the options page is left open with no user interaction
- **WHEN** the inactivity window elapses
- **THEN** the vault is locked
- **AND** the open surface shows the lock screen

#### Scenario: Locked UI polling does not postpone the lock

- **GIVEN** the vault is locked
- **AND** a UI surface is polling lock state to render the lock screen
- **WHEN** lock state is queried repeatedly
- **THEN** the last-activity timestamp is not updated
- **AND** the vault remains locked

#### Scenario: Repeated interaction is throttled to one report

- **GIVEN** the vault is unlocked
- **AND** several extension surfaces are open
- **WHEN** the user interacts repeatedly within the throttle window
- **THEN** at most one activity report is sent per surface for that window
- **AND** the inactivity deadline is postponed

#### Scenario: Displaying the countdown does not postpone the lock

- **GIVEN** the vault is unlocked
- **AND** a surface is displaying the time remaining before auto-lock
- **WHEN** that display updates with no user interaction
- **THEN** the last-activity timestamp is not updated
- **AND** the vault locks when the inactivity window elapses

## ADDED Requirements

### Requirement: Page-Originated Activity Requires Attested User Presence

The extension SHALL NOT allow a web page to postpone the inactivity deadline by its own action alone. Where a page-originated request postpones the deadline, the postponement SHALL additionally require evidence of user presence that the page cannot produce, cannot influence, and cannot infer. A page-reachable method SHALL NOT record activity directly.

The deadline is the bound on how long an unattended unlocked vault stays open. A page that can move it on its own is an unbounded session held open by something other than a person, so the requirement is on the *source of the evidence*, not on which method was called.

#### Scenario: A page cannot reach the activity method directly

- **GIVEN** the vault is unlocked
- **WHEN** a web page attempts to reach the activity-recording method through the content script
- **THEN** the call is refused
- **AND** the last-activity timestamp is not updated

#### Scenario: Request volume alone does not postpone the deadline

- **GIVEN** the vault is unlocked
- **AND** the browser reports the user as idle
- **WHEN** a page sends signing requests continuously for longer than the inactivity window
- **THEN** the vault is locked at the end of that window
- **AND** no request in the sequence postponed the deadline

#### Scenario: Presence evidence does not come from the request

- **GIVEN** the vault is unlocked
- **WHEN** the extension decides whether a page-originated signature postpones the deadline
- **THEN** the decision reads the browser's idle state
- **AND** the decision does not read the request's origin, kind, frequency, or trust level as evidence of presence

#### Scenario: A newly added activity-recording path is classified

- **WHEN** a code path that records activity is added
- **THEN** the path is classified as reachable or unreachable from a page-originated request
- **AND** a page-reachable path that does not require attested user presence is not permitted to record activity
- **AND** a path that cannot be confirmed unreachable is treated as page-reachable
