const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]+$/

export function isValidSolanaAddress(address: string): boolean {
  return address.length >= 32 && address.length <= 44 && BASE58_ADDRESS.test(address)
}
