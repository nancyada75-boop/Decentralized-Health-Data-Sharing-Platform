import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_DATA_ID = 101;
const ERR_INVALID_DURATION = 102;
const ERR_INVALID_RESEARCHER = 103;
const ERR_CONSENT_NOT_FOUND = 104;
const ERR_INVALID_PATIENT = 106;
const ERR_ALREADY_REVOKED = 107;
const ERR_INVALID_ACCESS_TYPE = 108;
const ERR_MAX_CONSENTS_EXCEEDED = 110;

interface Consent {
  researcher: string;
  expiry: number;
  allowed: boolean;
  accessType: string;
  timestamp: number;
}

interface ConsentCount {
  count: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ConsentManagerMock {
  state: {
    consentCounter: number;
    maxConsents: number;
    authorityContract: string | null;
    consents: Map<string, Consent>;
    consentCounts: Map<string, ConsentCount>;
  } = {
    consentCounter: 0,
    maxConsents: 10000,
    authorityContract: null,
    consents: new Map(),
    consentCounts: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1PATIENT";
  authorities: Set<string> = new Set(["ST1PATIENT"]);

  reset(): void {
    this.state = {
      consentCounter: 0,
      maxConsents: 10000,
      authorityContract: null,
      consents: new Map(),
      consentCounts: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1PATIENT";
    this.authorities = new Set(["ST1PATIENT"]);
  }

  getConsent(patient: string, dataId: number): Result<Consent | null> {
    return { ok: true, value: this.state.consents.get(`${patient}-${dataId}`) || null };
  }

  getConsentCount(patient: string): Result<ConsentCount> {
    return { ok: true, value: this.state.consentCounts.get(patient) || { count: 0 } };
  }

  checkConsent(patient: string, dataId: number, researcher: string): Result<boolean> {
    const consent = this.state.consents.get(`${patient}-${dataId}`);
    if (!consent) return { ok: true, value: false };
    return { ok: true, value: consent.allowed && consent.expiry >= this.blockHeight };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_RESEARCHER };
    if (this.state.authorityContract !== null) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMaxConsents(newMax: number): Result<boolean> {
    if (newMax <= 0) return { ok: false, value: ERR_MAX_CONSENTS_EXCEEDED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.maxConsents = newMax;
    return { ok: true, value: true };
  }

  setConsent(dataId: number, researcher: string, duration: number, accessType: string): Result<boolean> {
    if (dataId <= 0) return { ok: false, value: ERR_INVALID_DATA_ID };
    if (duration <= 0) return { ok: false, value: ERR_INVALID_DURATION };
    if (researcher === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_RESEARCHER };
    if (!["read-only", "read-write"].includes(accessType)) return { ok: false, value: ERR_INVALID_ACCESS_TYPE };
    if (!this.authorities.has(this.caller)) return { ok: false, value: ERR_INVALID_PATIENT };
    const currentCount = (this.state.consentCounts.get(this.caller) || { count: 0 }).count;
    if (currentCount >= this.state.maxConsents) return { ok: false, value: ERR_MAX_CONSENTS_EXCEEDED };

    const key = `${this.caller}-${dataId}`;
    this.state.consents.set(key, {
      researcher,
      expiry: this.blockHeight + duration,
      allowed: true,
      accessType,
      timestamp: this.blockHeight,
    });
    this.state.consentCounts.set(this.caller, { count: currentCount + 1 });
    this.state.consentCounter++;
    return { ok: true, value: true };
  }

  revokeConsent(dataId: number, researcher: string): Result<boolean> {
    const key = `${this.caller}-${dataId}`;
    const consent = this.state.consents.get(key);
    if (!consent) return { ok: false, value: ERR_CONSENT_NOT_FOUND };
    if (!consent.allowed) return { ok: false, value: ERR_ALREADY_REVOKED };
    if (!this.authorities.has(this.caller)) return { ok: false, value: ERR_INVALID_PATIENT };
    this.state.consents.set(key, { ...consent, allowed: false, expiry: 0, timestamp: this.blockHeight });
    return { ok: true, value: true };
  }
}

describe("ConsentManager", () => {
  let contract: ConsentManagerMock;

  beforeEach(() => {
    contract = new ConsentManagerMock();
    contract.reset();
  });

  it("sets consent successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setConsent(1, "ST3RESEARCHER", 100, "read-only");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const consent = contract.getConsent("ST1PATIENT", 1).value;
    expect(consent?.researcher).toBe("ST3RESEARCHER");
    expect(consent?.expiry).toBe(100);
    expect(consent?.allowed).toBe(true);
    expect(consent?.accessType).toBe("read-only");
    expect(consent?.timestamp).toBe(0);
    expect(contract.getConsentCount("ST1PATIENT").value.count).toBe(1);
  });

  it("rejects invalid data ID", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setConsent(0, "ST3RESEARCHER", 100, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DATA_ID);
  });

  it("rejects invalid duration", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setConsent(1, "ST3RESEARCHER", 0, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DURATION);
  });

  it("rejects invalid researcher", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setConsent(1, "SP000000000000000000002Q6VF78", 100, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RESEARCHER);
  });

  it("rejects invalid access type", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setConsent(1, "ST3RESEARCHER", 100, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ACCESS_TYPE);
  });

  it("rejects invalid patient", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.caller = "ST2FAKE";
    contract.authorities = new Set();
    const result = contract.setConsent(1, "ST3RESEARCHER", 100, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PATIENT);
  });

  it("rejects max consents exceeded", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.state.maxConsents = 1;
    contract.setConsent(1, "ST3RESEARCHER", 100, "read-only");
    const result = contract.setConsent(2, "ST3RESEARCHER", 100, "read-only");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_CONSENTS_EXCEEDED);
  });

  it("revokes consent successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.setConsent(1, "ST3RESEARCHER", 100, "read-only");
    const result = contract.revokeConsent(1, "ST3RESEARCHER");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const consent = contract.getConsent("ST1PATIENT", 1).value;
    expect(consent?.allowed).toBe(false);
    expect(consent?.expiry).toBe(0);
  });

  it("rejects revoke for non-existent consent", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.revokeConsent(1, "ST3RESEARCHER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONSENT_NOT_FOUND);
  });

  it("rejects revoke for already revoked consent", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.setConsent(1, "ST3RESEARCHER", 100, "read-only");
    contract.revokeConsent(1, "ST3RESEARCHER");
    const result = contract.revokeConsent(1, "ST3RESEARCHER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_REVOKED);
  });

  it("checks consent correctly", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.setConsent(1, "ST3RESEARCHER", 100, "read-only");
    const result = contract.checkConsent("ST1PATIENT", 1, "ST3RESEARCHER");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    contract.blockHeight = 101;
    const result2 = contract.checkConsent("ST1PATIENT", 1, "ST3RESEARCHER");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2AUTH");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2AUTH");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RESEARCHER);
  });
});