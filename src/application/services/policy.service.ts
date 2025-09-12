import {
  Authorisation,
  EvalReason,
  OriginPolicy,
  PolicyContext,
  PolicyInput,
  PolicyOutput,
} from "@/src/domain/types";
import { evaluatePolicy } from "@/src/domain/policy/evaluate";
import { StorageSuite } from "@/src/application/ports/storage";

const SETTINGS_KEY = "appSettings";

export class PolicyService {
  constructor(private storage: StorageSuite) {}

  async loadContext(): Promise<PolicyContext & { policies: OriginPolicy[] }> {
    const [settings, lock] = await Promise.all([
      this.storage.sync.get<any>(SETTINGS_KEY),
      this.storage.session.get<{ isLocked?: boolean }>("lockState"),
    ]);
    const mediumAllowKinds: number[] = settings?.mediumAllowKinds ?? [
      6, 16, 7, 10002,
    ];
    const origins: OriginPolicy[] = settings?.origins ?? [];
    const unlocked: boolean = lock?.isLocked === false;
    return { unlocked, mediumAllowKinds, policies: origins };
  }

  async evaluate(input: PolicyInput): Promise<PolicyOutput> {
    const { unlocked, mediumAllowKinds, policies } = await this.loadContext();
    return evaluatePolicy(input, { unlocked, mediumAllowKinds }, policies);
  }
}
