import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function secret() {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return result;
}
function decode(input) {
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of input) {
    const n = alphabet.indexOf(char);
    if (n < 0) throw Error("Invalid secret");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function code(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export function verifyCode(secret, input, lastStep = -1, now = Date.now()) {
  if (!/^\d{6}$/.test(input)) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step - 1, step, step + 1])
    if (
      candidate > lastStep &&
      timingSafeEqual(Buffer.from(code(secret, candidate)), Buffer.from(input))
    )
      return candidate;
  return null;
}
