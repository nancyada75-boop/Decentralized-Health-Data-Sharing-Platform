import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  uintCV,
  stringUtf8CV,
  principalCV,
  someCV,
  noneCV,
  trueCV,
  falseCV,
} from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_CONSENT_REQUIRED = 101;
const ERR_RESEARCHER_NOT_VERIFIED = 102;
const ERR_DATA_NOT_FOUND = 103;
const ERR_INVALID_ACCESS_TYPE = 104;
const ERR_ACCESS_LIMIT_EXCEEDED = 105;
const ERR_DATA_INACTIVE = 107;

interface AccessLog {
  dataId: number;
  researcher: string;
  patient: string;
  accessType: string;
  timestamp: number;
}

interface Result<T> {
  ok: boolean;
  value: T | number;
}

class AccessControlMock {
  state: {
    accessCounter: number;
    accessLimitPerCycle: number;
    cycleDuration: number;
    lastCycleStart: number;
    authorityContract: string;
    verifiedResearchers: Set<string>;
    accessLogs: Map<number, AccessLog>;
    researcherAccessCount: Map<string, number>;
  };
  blockHeight: number = 0;
  caller: string = "ST1RESEARCHER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      accessCounter: 0,
      accessLimitPerCycle: 10,
      cycleDuration: 1000,
      lastCycleStart: 0,
      authorityContract: "ST1AUTH",
      verifiedResearchers: new Set(),
      accessLogs: new Map(),
      researcherAccessCount: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1RESEARCHER";
  }

  getAccessLog(logId: number): Result<AccessLog | null> {
    return { ok: true, value: this.state.accessLogs.get(logId) ?? null };
  }

  getAccessCountByResearcher(researcher: string): number {
    const cycle = this.getCurrentCycle();
    return this.state.researcherAccessCount.get(`${researcher}-${cycle}`) ?? 0;
  }

  isResearcherVerified(researcher: string): boolean {
    return this.state.verifiedResearchers.has(researcher);
  }

  private getCurrentCycle(): number {
    if (this.blockHeight < this.state.lastCycleStart) return 0;
    return Math.floor(
      (this.blockHeight - this.state.lastCycleStart) / this.state.cycleDuration
    );
  }

  private updateCycle(): void {
    const cycle = this.getCurrentCycle();
    if (cycle === 0 && this.blockHeight >= this.state.lastCycleStart) {
      this.state.lastCycleStart = this.blockHeight;
    }
  }

  verifyResearcher(researcher: string): Result<boolean> {
    if (this.caller !== this.state.authorityContract)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.verifiedResearchers.add(researcher);
    return { ok: true, value: true };
  }

  setAccessLimitPerCycle(limit: number): Result<boolean> {
    if (this.caller !== this.state.authorityContract)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (limit <= 0) return { ok: false, value: ERR_INVALID_ACCESS_TYPE };
    this.state.accessLimitPerCycle = limit;
    return { ok: true, value: true };
  }

  setCycleDuration(duration: number): Result<boolean> {
    if (this.caller !== this.state.authorityContract)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (duration <= 0) return { ok: false, value: ERR_INVALID_ACCESS_TYPE };
    this.state.cycleDuration = duration;
    return { ok: true, value: true };
  }

  requestAccess(dataId: number, accessType: string): Result<number> {
    this.updateCycle();
    const currentCount = this.getAccessCountByResearcher(this.caller);
    if (!this.isResearcherVerified(this.caller))
      return { ok: false, value: ERR_RESEARCHER_NOT_VERIFIED };
    if (currentCount >= this.state.accessLimitPerCycle)
      return { ok: false, value: ERR_ACCESS_LIMIT_EXCEEDED };
    if (!["read-only", "read-write"].includes(accessType))
      return { ok: false, value: ERR_INVALID_ACCESS_TYPE };

    const dataResult = this.mockDataRegistryGetData(dataId);
    if (!dataResult.ok) return dataResult as Result<number>;
    const data = (dataResult as any).value;
    if (!data.status) return { ok: false, value: ERR_DATA_INACTIVE };

    const consentResult = this.mockConsentManagerCheckConsent(
      data.owner,
      dataId,
      this.caller
    );
    if (!consentResult.ok) return consentResult as Result<number>;
    if (!(consentResult as any).value)
      return { ok: false, value: ERR_CONSENT_REQUIRED };

    const logId = this.state.accessCounter;
    const cycleKey = `${this.caller}-${this.getCurrentCycle()}`;
    this.state.accessLogs.set(logId, {
      dataId,
      researcher: this.caller,
      patient: data.owner,
      accessType,
      timestamp: this.blockHeight,
    });
    this.state.researcherAccessCount.set(cycleKey, currentCount + 1);
    this.state.accessCounter++;
    return { ok: true, value: logId };
  }

  getTotalAccessCount(): number {
    return this.state.accessCounter;
  }

  private mockDataRegistryGetData(
    dataId: number
  ): Result<{ owner: string; status: boolean }> | Result<null> {
    if (dataId === 999) return { ok: false, value: ERR_DATA_NOT_FOUND };
    return {
      ok: true,
      value: { owner: "ST1PATIENT", status: dataId !== 888 },
    };
  }

  private mockConsentManagerCheckConsent(
    patient: string,
    dataId: number,
    researcher: string
  ): Result<boolean> {
    if (dataId === 777) return { ok: false, value: 106 };
    return { ok: true, value: dataId !== 666 };
  }
}

describe("AccessControl", () => {
  let contract: AccessControlMock;

  beforeEach(() => {
    contract = new AccessControlMock();
    contract.reset();
  });

  it("verifies researcher successfully", () => {
    contract.caller = "ST1AUTH";
    const result = contract.verifyResearcher("ST2RESEARCHER");
    expect(result.ok).toBe(true);
    expect(contract.isResearcherVerified("ST2RESEARCHER")).toBe(true);
  });

  it("rejects verify by non-authority", () => {
    const result = contract.verifyResearcher("ST2RESEARCHER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("sets access limit successfully", () => {
    contract.caller = "ST1AUTH";
    const result = contract.setAccessLimitPerCycle(5);
    expect(result.ok).toBe(true);
    expect((contract as any).state.accessLimitPerCycle).toBe(5);
  });

  it("rejects invalid access limit", () => {
    contract.caller = "ST1AUTH";
    const result = contract.setAccessLimitPerCycle(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ACCESS_TYPE);
  });

  it("requests access successfully", () => {
    contract.caller = "ST1AUTH";
    contract.verifyResearcher("ST2RESEARCHER");
    contract.caller = "ST2RESEARCHER";
    const result = contract.requestAccess(1, "read-only");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const log = contract.getAccessLog(0).value;
    expect(log?.dataId).toBe(1);
    expect(log?.researcher).toBe("ST2RESEARCHER");
    expect(log?.accessType).toBe("read-only");
  });

  it("rejects access by unverified researcher", () => {
    const result = contract.requestAccess(1, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RESEARCHER_NOT_VERIFIED);
  });

  it("rejects access without consent", () => {
    contract.caller = "ST1AUTH";
    contract.verifyResearcher("ST2RESEARCHER");
    contract.caller = "ST2RESEARCHER";
    const result = contract.requestAccess(666, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONSENT_REQUIRED);
  });

  it("rejects access to inactive data", () => {
    contract.caller = "ST1AUTH";
    contract.verifyResearcher("ST2RESEARCHER");
    contract.caller = "ST2RESEARCHER";
    const result = contract.requestAccess(888, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DATA_INACTIVE);
  });

  it("rejects access to non-existent data", () => {
    contract.caller = "ST1AUTH";
    contract.verifyResearcher("ST2RESEARCHER");
    contract.caller = "ST2RESEARCHER";
    const result = contract.requestAccess(999, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DATA_NOT_FOUND);
  });

  it("enforces access limit per cycle", () => {
    contract.caller = "ST1AUTH";
    contract.verifyResearcher("ST2RESEARCHER");
    contract.setAccessLimitPerCycle(1);
    contract.caller = "ST2RESEARCHER";
    contract.requestAccess(1, "read-only");
    const result = contract.requestAccess(2, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ACCESS_LIMIT_EXCEEDED);
  });

  it("resets access count after cycle", () => {
    contract.caller = "ST1AUTH";
    contract.verifyResearcher("ST2RESEARCHER");
    contract.setAccessLimitPerCycle(1);
    contract.setCycleDuration(10);
    contract.caller = "ST2RESEARCHER";
    contract.requestAccess(1, "read-only");
    contract.blockHeight = 15;
    const result = contract.requestAccess(2, "read-only");
    expect(result.ok).toBe(true);
  });

  it("rejects invalid access type", () => {
    contract.caller = "ST1AUTH";
    contract.verifyResearcher("ST2RESEARCHER");
    contract.caller = "ST2RESEARCHER";
    const result = contract.requestAccess(1, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ACCESS_TYPE);
  });

  it("returns correct access count", () => {
    contract.caller = "ST1AUTH";
    contract.verifyResearcher("ST2RESEARCHER");
    contract.caller = "ST2RESEARCHER";
    contract.requestAccess(1, "read-only");
    contract.requestAccess(2, "read-write");
    expect(contract.getTotalAccessCount()).toBe(2);
  });
});
