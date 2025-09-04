// Utils functions.

import * as crypto from "crypto";

export function generateNonce(): string {
  return Array.from({ length: 16 }, () =>
    crypto.randomBytes(1).toString("hex")
  ).join("");
}

export function encryptPassword(pubKeyPem: string, password: string): string {
  // Load public key
  const publicKey = crypto.createPublicKey(pubKeyPem);

  // Encrypt password
  const encryptedPassword = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha384",
    },
    Buffer.from(password)
  );

  return encryptedPassword.toString("base64");
}

export function extractNumeric(valueWithUnit: string): number {
  try {
    return parseFloat(valueWithUnit.split(" ")[0]);
  } catch {
    return 0;
  }
}
