import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, credentialHint } from "@/lib/crypto";

describe("credential encryption", () => {
  it("round-trips a secret with AES-256-GCM", () => {
    const secret = "thk_live_example_key_value_123456";
    const envelope = encryptSecret(secret);

    expect(envelope.keyVersion).toBe(1);
    expect(envelope.ciphertext).not.toContain(secret);
    expect(decryptSecret(envelope)).toBe(secret);
  });

  it("uses a unique IV for every encryption", () => {
    const first = encryptSecret("same-secret");
    const second = encryptSecret("same-secret");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects tampered ciphertext", () => {
    const envelope = encryptSecret("secret-value");
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;

    expect(() =>
      decryptSecret({ ...envelope, ciphertext: bytes.toString("base64") }),
    ).toThrow(/could not be decrypted/i);
  });

  it("rejects an unknown key version", () => {
    const envelope = encryptSecret("secret-value");
    expect(() => decryptSecret({ ...envelope, keyVersion: 99 })).toThrow(
      /not available/i,
    );
  });

  it("rejects empty secrets", () => {
    expect(() => encryptSecret("   ")).toThrow(/must not be empty/i);
  });

  it("returns only the trailing hint", () => {
    expect(credentialHint("oc_sk_abcdef1234")).toBe("…1234");
    expect(credentialHint("abc")).toBe("••••");
  });
});
