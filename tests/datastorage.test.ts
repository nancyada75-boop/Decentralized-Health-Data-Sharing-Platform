import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_INVALID_HASH = 202;
const ERR_INVALID_DATA_TYPE = 203;
const ERR_INVALID_DESCRIPTION = 204;
const ERR_DATA_NOT_FOUND = 205;
const ERR_MAX_DATA_EXCEEDED = 206;

interface DataEntry {
  hash: string;
  dataType: string;
  description: string;
  timestamp: number;
  version: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class DataStorageMock {
  state: {
    maxDataPerPatient: number;
    dataEntries: Map<string, DataEntry>;
    dataCounters: Map<string, number>;
  } = {
    maxDataPerPatient: 1000,
    dataEntries: new Map(),
    dataCounters: new Map(),
  };
  blockHeight: number = 100;
  caller: string = "ST1PATIENT";

  reset(): void {
    this.state = {
      maxDataPerPatient: 1000,
      dataEntries: new Map(),
      dataCounters: new Map(),
    };
    this.blockHeight = 100;
    this.caller = "ST1PATIENT";
  }

  getDataEntry(patient: string, dataId: number): Result<DataEntry | null> {
    return { ok: true, value: this.state.dataEntries.get(`${patient}-${dataId}`) || null };
  }

  getDataCount(patient: string): Result<number> {
    return { ok: true, value: this.state.dataCounters.get(patient) || 0 };
  }

  registerData(hash: string, dataType: string, description: string): Result<number> {
    const currentCount = this.state.dataCounters.get(this.caller) || 0;
    const newId = currentCount + 1;
    if (newId > this.state.maxDataPerPatient) return { ok: false, value: ERR_MAX_DATA_EXCEEDED };
    if (hash.length !== 64) return { ok: false, value: ERR_INVALID_HASH };
    const validTypes = ["clinical", "wearable", "genomic", "lifestyle", "imaging", "lab"];
    if (!validTypes.includes(dataType)) return { ok: false, value: ERR_INVALID_DATA_TYPE };
    if (description.length > 200) return { ok: false, value: ERR_INVALID_DESCRIPTION };

    const key = `${this.caller}-${newId}`;
    this.state.dataEntries.set(key, {
      hash,
      dataType,
      description,
      timestamp: this.blockHeight,
      version: 1,
    });
    this.state.dataCounters.set(this.caller, newId);
    return { ok: true, value: newId };
  }

  updateMetadata(dataId: number, dataType: string, description: string): Result<boolean> {
    const key = `${this.caller}-${dataId}`;
    const entry = this.state.dataEntries.get(key);
    if (!entry) return { ok: false, value: ERR_DATA_NOT_FOUND };
    const validTypes = ["clinical", "wearable", "genomic", "lifestyle", "imaging", "lab"];
    if (!validTypes.includes(dataType)) return { ok: false, value: ERR_INVALID_DATA_TYPE };
    if (description.length > 200) return { ok: false, value: ERR_INVALID_DESCRIPTION };

    this.state.dataEntries.set(key, {
      ...entry,
      dataType,
      description,
      version: entry.version + 1,
    });
    return { ok: true, value: true };
  }
}

describe("DataStorage", () => {
  let contract: DataStorageMock;

  beforeEach(() => {
    contract = new DataStorageMock();
    contract.reset();
  });

  it("registers data successfully", () => {
    const hash = "a".repeat(64);
    const result = contract.registerData(hash, "clinical", "Blood test results");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
    const entry = contract.getDataEntry("ST1PATIENT", 1).value;
    expect(entry?.hash).toBe(hash);
    expect(entry?.dataType).toBe("clinical");
    expect(entry?.description).toBe("Blood test results");
    expect(entry?.timestamp).toBe(100);
    expect(entry?.version).toBe(1);
    expect(contract.getDataCount("ST1PATIENT").value).toBe(1);
  });

  it("rejects invalid hash length", () => {
    const result = contract.registerData("short", "clinical", "Test");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_HASH);
  });

  it("rejects invalid data type", () => {
    const hash = "a".repeat(64);
    const result = contract.registerData(hash, "invalid", "Test");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DATA_TYPE);
  });

  it("rejects long description", () => {
    const hash = "a".repeat(64);
    const desc = "x".repeat(201);
    const result = contract.registerData(hash, "clinical", desc);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DESCRIPTION);
  });

  it("enforces max data per patient", () => {
    contract.state.maxDataPerPatient = 1;
    const hash = "a".repeat(64);
    contract.registerData(hash, "clinical", "First");
    const result = contract.registerData(hash, "wearable", "Second");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_DATA_EXCEEDED);
  });

  it("updates metadata successfully", () => {
    const hash = "a".repeat(64);
    contract.registerData(hash, "clinical", "Old desc");
    const result = contract.updateMetadata(1, "genomic", "New genome data");
    expect(result.ok).toBe(true);
    const entry = contract.getDataEntry("ST1PATIENT", 1).value;
    expect(entry?.dataType).toBe("genomic");
    expect(entry?.description).toBe("New genome data");
    expect(entry?.version).toBe(2);
    expect(entry?.hash).toBe(hash);
  });

  it("rejects update for non-existent data", () => {
    const result = contract.updateMetadata(99, "clinical", "Test");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DATA_NOT_FOUND);
  });
});