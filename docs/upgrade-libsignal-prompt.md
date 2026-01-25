# Fix "Method too large" Kotlin Compilation Error

## Problem

The `react-native-libsignal-client` library fails to compile with:

```
org.jetbrains.org.objectweb.asm.MethodTooLargeException: Method too large: 
expo/modules/libsignalclient/ReactNativeLibsignalClientModule.definition ()Lexpo/modules/kotlin/modules/ModuleDefinitionData;
```

**Root Cause:** The JVM has a 64KB limit on method bytecode size. The `definition()` method in `ReactNativeLibsignalClientModule.kt` has too many `Function()` declarations (100+), causing the compiled bytecode to exceed this limit.

## Repository

- Repository: `github.com/ntheile/react-native-libsignal-client`
- Branch: `copilot/add-cdsi-support`
- File: `android/src/main/java/expo/modules/libsignalclient/ReactNativeLibsignalClientModule.kt`
- Size: **2015 lines** with 100+ function registrations

## Current Structure

The module uses Expo Modules API where all functions are registered in a single `definition()` block:

```kotlin
class ReactNativeLibsignalClientModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReactNativeLibsignalClient")
    
    // 100+ Function() declarations like:
    Function("privateKeyGenerate", this@ReactNativeLibsignalClientModule::privateKeyGenerate)
    Function("privateKeySign", this@ReactNativeLibsignalClientModule::privateKeySign)
    Function("sessionCipherEncryptMessage", this@ReactNativeLibsignalClientModule::sessionCipherEncryptMessage)
    // ... many more
  }
}
```

## Solution Required

Split the monolithic module into **multiple smaller modules** by functionality:

1. **ReactNativeLibsignalClientModule.kt** - Main module (coordinates sub-modules)
2. **KeyModule.kt** - Key generation/management (privateKey*, publicKey*, identityKey*)
3. **SessionModule.kt** - Session cipher operations (sessionCipher*, sessionRecord*)
4. **MessageModule.kt** - Message handling (signalMessage*, preKeySignalMessage*, senderKeyMessage*)
5. **CertificateModule.kt** - Certificates (serverCertificate*, senderCertificate*)
6. **GroupModule.kt** - Group operations (group*, senderKey*)
7. **ZkGroupModule.kt** - Zero-knowledge group operations (serverPublicParams*, groupSecretParams*, profileKey*)
8. **CryptoModule.kt** - Low-level crypto (Aes256*, Hmac*, hkdf*)
9. **BackupModule.kt** - Backup operations (backup*, messageBackup*, accountEntropyPool*)

## Implementation Notes

### Expo Modules Pattern
Each module should follow this pattern:

```kotlin
// KeyModule.kt
package expo.modules.libsignalclient

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KeyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LibsignalKeys")
    
    Function("privateKeyGenerate", this@KeyModule::privateKeyGenerate)
    Function("privateKeySign", this@KeyModule::privateKeySign)
    // etc...
  }
  
  private fun privateKeyGenerate(): ByteArray { ... }
  private fun privateKeySign(...): ByteArray { ... }
}
```

### expo-module.config.json
Update to register multiple modules:

```json
{
  "platforms": ["ios", "android"],
  "ios": { ... },
  "android": {
    "modules": [
      "expo.modules.libsignalclient.ReactNativeLibsignalClientModule",
      "expo.modules.libsignalclient.KeyModule",
      "expo.modules.libsignalclient.SessionModule",
      "expo.modules.libsignalclient.MessageModule",
      "expo.modules.libsignalclient.CertificateModule",
      "expo.modules.libsignalclient.GroupModule",
      "expo.modules.libsignalclient.ZkGroupModule",
      "expo.modules.libsignalclient.CryptoModule",
      "expo.modules.libsignalclient.BackupModule"
    ]
  }
}
```

### TypeScript Side
Update `src/ReactNativeLibsignalClientModule.ts`:

```typescript
import { requireNativeModule } from 'expo-modules-core';

export const LibsignalClient = requireNativeModule('ReactNativeLibsignalClient');
export const LibsignalKeys = requireNativeModule('LibsignalKeys');
export const LibsignalSession = requireNativeModule('LibsignalSession');
// etc...
```

## Function Groupings

### KeyModule (~15 functions)
- privateKeyGenerate, privateKeySign, privateKeyAgree, privateKeyGetPublicKey
- publicKeyCompare, publicKeyGetPublicKeyBytes, publicKeyVerify
- identityKeyPairSerialize, identityKeyPairDeserialize, identityKeyPairSignAlternateIdentity, identityKeyVerifyAlternateIdentity
- generateKyberKeyPair, generateKyberRecord, kyberPreKeyRecord*

### SessionModule (~15 functions)
- createAndProcessPreKeyBundle
- signedPreKeyRecord*, preKeyRecord*
- sessionRecord*, sessionCipher*

### MessageModule (~20 functions)
- signalMessage*, preKeySignalMessage*
- senderKeyMessage*, plaintextContent*
- decryptionErrorMessage*

### CertificateModule (~15 functions)
- serverCertificate*, senderCertificate*
- unidentifiedSenderMessageContent*
- sealedSender*

### GroupModule (~10 functions)
- groupCipher*, senderKeyDistributionMessage*
- groupSend*

### ZkGroupModule (~30 functions)
- serverPublicParams*, serverSecretParams*
- groupPublicParams*, groupSecretParams*
- profileKey*, authCredential*
- groupSendEndorsement*

### CryptoModule (~10 functions)
- Aes256GcmEncrypt/Decrypt, Aes256CbcEncrypt/Decrypt, Aes256CtrEncrypt/Decrypt
- HmacSHA256, ConstantTimeEqual, hkdfDeriveSecrets
- generateRandomBytes, generateRegistrationId

### BackupModule (~15 functions)
- backupKey*, backupAuthCredential*
- accountEntropyPool*, messageBackup*
- onlineBackupValidator*, comparableBackup*

## Important

1. Keep shared utilities/helper functions in a separate `Utils.kt` file
2. Each module should have its own imports
3. The `handles` map for object references should be shared or in main module
4. Test compilation after each module split to catch issues early
5. Update iOS Swift files similarly if needed

## Verification

After splitting, each module's `definition()` method should have ~10-30 functions max.
Build should succeed without "Method too large" error.
