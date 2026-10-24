import { randomBytes } from "node:crypto";

const authSecret = randomBytes(48).toString("base64url");
const encryptionKey = randomBytes(32).toString("base64");

console.log(`AUTH_SECRET="${authSecret}"`);
console.log(`CREDENTIAL_ENCRYPTION_KEY="${encryptionKey}"`);
