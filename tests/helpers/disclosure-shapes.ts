import type { OriginPolicy } from "@/domain/types";

export const A = "a1111111-1111-4111-8111-111111111111";
export const B = "b2222222-2222-4222-8222-222222222222";

export const policy = (fields: Record<string, unknown> = {}): OriginPolicy =>
  ({
    origin: "https://site.example",
    trustLevel: "low",
    rules: {},
    updatedAt: 1,
    ...fields,
  }) as OriginPolicy;

/** Every stored shape the enforcement and the display must read the same way. */
export const SHAPES: Array<readonly [string, OriginPolicy | undefined]> = [
  ["no record", undefined],
  ["no decision", policy()],
  ["a grant for A", policy({ identityDisclosure: "allow", identityDisclosureKeyIds: [A] })],
  ["a grant for A and B", policy({ identityDisclosure: "allow", identityDisclosureKeyIds: [A, B] })],
  ["a legacy allow", policy({ identityDisclosure: "allow" })],
  ["an empty list", policy({ identityDisclosure: "allow", identityDisclosureKeyIds: [] })],
  ["a non-array list", policy({ identityDisclosure: "allow", identityDisclosureKeyIds: A })],
  ["a list with junk", policy({ identityDisclosure: "allow", identityDisclosureKeyIds: [A, 7, "", null] })],
  ["a list under ask", policy({ identityDisclosure: "ask", identityDisclosureKeyIds: [A] })],
  ["a refusal with a list", policy({ identityDisclosure: "deny", identityDisclosureKeyIds: [A] })],
];
