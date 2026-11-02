import { test } from "node:test";
import assert from "node:assert/strict";
import { code, verifyCode } from "./totp.js";
test("TOTP matches RFC 6238 SHA1 vector (six trailing digits) and rejects replay", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(code(secret, 1), "287082");
  assert.equal(verifyCode(secret, "287082", -1, 59000), 1);
  assert.equal(verifyCode(secret, "287082", 1, 59000), null);
  assert.equal(verifyCode(secret, "000000", -1, 59000), null);
});
