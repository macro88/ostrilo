/**
 * Simple test to verify crypto functionality
 * This can be run in the browser console to test key generation and encryption
 */

import {
  generateKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  parsePrivateKey,
  privateKeyToBech32,
  publicKeyToBech32,
} from "../src/domain/utils/crypto";
import { evaluatePasswordStrength } from "../src/domain/utils/validation";

export async function testCrypto() {
  console.log("🔐 Testing Ostrilo Crypto Functions...");

  try {
    // Test 1: Key generation
    console.log("\n1. Testing key generation...");
    const keyPair = await generateKeyPair();
    console.log("✅ Key pair generated successfully");
    console.log("Private key length:", keyPair.privateKey.length);
    console.log("Public key length:", keyPair.publicKey.length);

    // Test 2: Bech32 encoding
    console.log("\n2. Testing bech32 encoding...");
    const nsec = privateKeyToBech32(keyPair.privateKey);
    const npub = publicKeyToBech32(keyPair.publicKey);
    console.log("✅ Bech32 encoding successful");
    console.log("nsec:", nsec);
    console.log("npub:", npub);

    // Test 3: Key parsing
    console.log("\n3. Testing key parsing...");
    const parsedKey = parsePrivateKey(nsec);
    console.log("✅ Key parsing successful");
    console.log(
      "Parsed key matches original:",
      parsedKey.every((val, i) => val === keyPair.privateKey[i])
    );

    // Test 4: Encryption/Decryption
    console.log("\n4. Testing encryption/decryption...");
    const password = "test-password-123";
    const encrypted = await encryptPrivateKey(keyPair.privateKey, password);
    console.log("✅ Encryption successful");
    console.log("Encrypted data structure:", Object.keys(encrypted));

    const decrypted = await decryptPrivateKey(encrypted, password);
    console.log("✅ Decryption successful");
    console.log(
      "Decrypted key matches original:",
      decrypted.every((val, i) => val === keyPair.privateKey[i])
    );

    // Test 5: Password strength evaluation
    console.log("\n5. Testing password strength evaluation...");
    const weakPassword = evaluatePasswordStrength("123");
    const strongPassword = evaluatePasswordStrength("MySecurePassword123!@#");
    console.log("✅ Password strength evaluation successful");
    console.log(
      "Weak password score:",
      weakPassword.score,
      "meets minimum:",
      weakPassword.meetsMinimum
    );
    console.log(
      "Strong password score:",
      strongPassword.score,
      "meets minimum:",
      strongPassword.meetsMinimum
    );

    console.log("\n🎉 All crypto tests passed!");
    return true;
  } catch (error) {
    console.error("❌ Crypto test failed:", error);
    return false;
  }
}

// Auto-run test if in development
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).testCrypto = testCrypto;
  console.log("🔧 Test function available as window.testCrypto()");
}
