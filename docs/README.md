# Ostrilo documentation

Where each document fits. The normative requirements live in
[`openspec/specs/`](../openspec/specs/); these documents explain them, and the
code is the final authority where the two disagree.

## Using Ostrilo

| Document | What it covers |
| --- | --- |
| [Managing multiple keys](managing-multiple-keys.md) | Adding, switching, renaming and deleting keys |
| [Key backup](key-backup.md) | Saving and restoring an encrypted backup; the plaintext-backup migration warning |
| [Privacy policy](../PRIVACY.md) | What the extension stores, what it sends to relays, and what browser sync copies |

## Building a dApp against Ostrilo

| Document | What it covers |
| --- | --- |
| [RPC error codes](rpc-error-codes.md) | Every error code a page can receive, and when |
| [Testing against a local dApp](local-https-development.md) | Why the provider needs `https://`, and a local HTTPS setup |

## Security design

| Document | What it covers |
| --- | --- |
| [Vault storage format](vault-storage-format.md) | How keys are encrypted at rest, and the rules for changing it |
| [Relay trust boundary](relay-trust-boundary.md) | What Ostrilo accepts from relays and what it refuses to fetch |
| [Extension manifest](extension-manifest.md) | Every permission and manifest declaration, and why |
| [CI verification](ci-verification.md) | The blocking gates, supply-chain policy and reproducible build |

## Contributing

| Document | What it covers |
| --- | --- |
| [Development standards](development-standards.md) | The binding rules and the verification checklist; start here |
| [Architecture primer](architecture_primer.md) | Ports and adapters, the RPC layer, and a signing request traced end to end |
| [Developer guide](developers_readme.md) | The source tree layer by layer, the NIP-07 provider and profile management |
| [RPC architecture](rpc-architecture.md) | Handler structure and the privilege boundary between page and UI methods |
| [Multi-key developer guide](multi-key-management-developer-guide.md) | Key selector components, key RPC methods and data flow |
| [Testing](TESTING.md) | The test suites, what each one proves, and how to run them |
| [Driving the extension](agent-loop.md) | Screenshots, console output and a real signing flow from a script |
| [Design rules](design/DESIGN_RULES.md) | The Inkline UI system and its banned patterns |
| [Design review](design-review/README.md) | The September 2026 review and how to reproduce its captures |

## Requirements and roadmap

| Document | What it covers |
| --- | --- |
| [Signer requirements](ostrilo-signer-requirements.md) | Traceable functional and non-functional requirements |
| [Onboarding requirements](ostrilo-onboarding-requirements.md) | First-run key creation, import and password setup |
| [Settings and permissions](ostrilo-settings-permissions-v1.md) | Stored settings, per-origin permissions and trust levels |
| [Roadmap](roadmap.md) | Planned work and the status of each requirement; not a list of shipped features |
