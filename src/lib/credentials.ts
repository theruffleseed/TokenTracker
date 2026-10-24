import type { ProviderAccount } from "@prisma/client";
import { decryptSecret } from "./crypto";
import { AppError } from "./errors";

export async function readAccountCredential(account: ProviderAccount): Promise<string | null> {
  if (!account.credentialCiphertext || !account.credentialIv || !account.credentialTag) {
    return null;
  }
  if (account.credentialKeyVersion === null) {
    throw new AppError("INTERNAL_ERROR", "Credential is missing a key version");
  }

  return decryptSecret({
    ciphertext: account.credentialCiphertext,
    iv: account.credentialIv,
    tag: account.credentialTag,
    keyVersion: account.credentialKeyVersion,
  });
}
