# react-native-libsignal-client Android Patch Specification

## Overview

This document describes the patch required to make `react-native-libsignal-client` work on Android devices. The patch addresses a JVM bytecode limitation that causes build failures when the module has too many function registrations in a single method.

## The Problem

### JVM 64KB Method Size Limit

The Java Virtual Machine (JVM) has a hard limit of **64KB (65,535 bytes)** for the bytecode of any single method. When Kotlin compiles a large method, the resulting bytecode can exceed this limit.

### Symptoms

When building without the patch, you'll see an error like:

```
e: /node_modules/react-native-libsignal-client/android/src/main/java/expo/modules/libsignalclient/ReactNativeLibsignalClientModule.kt: 
Method too large: expo/modules/libsignalclient/ReactNativeLibsignalClientModule.definition()Lexpo/modules/kotlin/modules/ModuleDefinition;
```

Or:

```
org.jetbrains.org.objectweb.asm.MethodTooLargeException: Method too large: 
expo/modules/libsignalclient/ReactNativeLibsignalClientModule.definition ()Lexpo/modules/kotlin/modules/ModuleDefinition;
```

### Root Cause

The `ReactNativeLibsignalClientModule.kt` file registers **100+ functions** in a single `definition()` method using Expo Modules API. Each `Function()` registration generates bytecode for:
- Lambda creation
- Method reference
- String constant loading
- Builder calls

With 100+ functions, this exceeds the 64KB limit.

---

## The Solution

### Strategy: Split Into Extension Functions

Split the single large `definition()` method into multiple smaller extension functions, each registering a subset of the functions.

### Architecture

```
Before (FAILS):
┌─────────────────────────────────────────┐
│ definition() {                          │
│   Function("func1", ...)                │
│   Function("func2", ...)                │
│   ... (100+ functions)                  │  ← Exceeds 64KB
│   Function("func100", ...)              │
│ }                                       │
└─────────────────────────────────────────┘

After (WORKS):
┌─────────────────────────────────────────┐
│ definition() {                          │
│   registerServiceIdAndCertificateFns()  │
│   registerKeyFunctions()                │  ← Each < 64KB
│   registerSessionAndMessageFns()        │
│   registerGroupAndProfileFns()          │
│   registerCryptoAndGroupSendFns()       │
│   registerBackupFunctions()             │
│ }                                       │
└─────────────────────────────────────────┘
```

---

## Patch Details

### File Modified

```
node_modules/react-native-libsignal-client/android/src/main/java/expo/modules/libsignalclient/ReactNativeLibsignalClientModule.kt
```

### Changes

#### 1. Add Import

```kotlin
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
```

#### 2. Create Extension Functions

Split the function registrations into 6 logical groups:

| Function | Purpose | ~Functions |
|----------|---------|------------|
| `registerServiceIdAndCertificateFunctions()` | ServiceId, certificates | ~20 |
| `registerKeyFunctions()` | Key generation, pre-keys | ~25 |
| `registerSessionAndMessageFunctions()` | Sessions, messages, decryption | ~35 |
| `registerGroupAndProfileFunctions()` | Groups, profiles | ~30 |
| `registerCryptoAndGroupSendFunctions()` | AES, sealed sender | ~25 |
| `registerBackupFunctions()` | Backup/restore | ~25 |

#### 3. Modify `definition()` Method

The `definition()` method now just calls the extension functions:

```kotlin
override fun definition() = ModuleDefinition {
    Name("ReactNativeLibsignalClient")
    OnCreate {
        ReactNativeLibsignalClientLogger.addCallback(logListener)
        ReactNativeLibsignalClientLogger.initiate()
    }
    Events("onLogGenerated")

    // Call extension functions to register all functions
    registerServiceIdAndCertificateFunctions()
    registerKeyFunctions()
    registerSessionAndMessageFunctions()
    registerGroupAndProfileFunctions()
    registerCryptoAndGroupSendFunctions()
    registerBackupFunctions()
}
```

---

## Complete Patch

Create file: `patches/react-native-libsignal-client+0.1.44.patch`

```diff
diff --git a/node_modules/react-native-libsignal-client/android/src/main/java/expo/modules/libsignalclient/ReactNativeLibsignalClientModule.kt b/node_modules/react-native-libsignal-client/android/src/main/java/expo/modules/libsignalclient/ReactNativeLibsignalClientModule.kt
index 0400483..4e2ea04 100644
--- a/node_modules/react-native-libsignal-client/android/src/main/java/expo/modules/libsignalclient/ReactNativeLibsignalClientModule.kt
+++ b/node_modules/react-native-libsignal-client/android/src/main/java/expo/modules/libsignalclient/ReactNativeLibsignalClientModule.kt
@@ -3,6 +3,7 @@ package expo.modules.libsignalclient
 import android.util.Base64
 import expo.modules.kotlin.modules.Module
 import expo.modules.kotlin.modules.ModuleDefinition
+import expo.modules.kotlin.modules.ModuleDefinitionBuilder
 import expo.modules.kotlin.types.toJSValue
 // ... rest of imports
```

The full patch splits ~160 `Function()` calls into 6 extension functions.

---

## Applying the Patch

### Using patch-package

1. **Install patch-package** (if not already installed):
   ```bash
   npm install patch-package --save-dev
   # or
   yarn add patch-package --dev
   ```

2. **Add postinstall script** to `package.json`:
   ```json
   {
     "scripts": {
       "postinstall": "patch-package"
     }
   }
   ```

3. **Place the patch file** at:
   ```
   patches/react-native-libsignal-client+0.1.44.patch
   ```

4. **Run install** to apply:
   ```bash
   npm install
   # or
   yarn install
   ```

### Manual Application

If not using patch-package:

```bash
cd node_modules/react-native-libsignal-client
patch -p1 < ../../patches/react-native-libsignal-client+0.1.44.patch
```

---

## Verification

### Build Test

```bash
cd android
./gradlew assembleDebug
```

Should complete without "Method too large" errors.

### Runtime Test

```typescript
import * as SignalClient from 'react-native-libsignal-client';

// Test a few functions from different groups
const privateKey = SignalClient.PrivateKey.generate();
console.log('PrivateKey generated:', privateKey);

const publicKey = privateKey.getPublicKey();
console.log('PublicKey:', publicKey);
```

---

## Function Groupings Reference

### Group 1: ServiceId and Certificate Functions
```kotlin
private fun ModuleDefinitionBuilder.registerServiceIdAndCertificateFunctions() {
    Function("serviceIdServiceIdBinary", ...)
    Function("serviceIdServiceIdString", ...)
    Function("serviceIdServiceIdLog", ...)
    Function("serviceIdParseFromServiceIdBinary", ...)
    Function("serviceIdParseFromServiceIdString", ...)
    // ... server certificate functions
    // ... sender certificate functions
}
```

### Group 2: Key Functions
```kotlin
private fun ModuleDefinitionBuilder.registerKeyFunctions() {
    Function("privateKeyGenerate", ...)
    Function("privateKeySign", ...)
    Function("privateKeyAgree", ...)
    Function("publicKeyCompare", ...)
    Function("publicKeyGetPublicKeyBytes", ...)
    // ... identity key functions
    // ... pre-key functions
}
```

### Group 3: Session and Message Functions
```kotlin
private fun ModuleDefinitionBuilder.registerSessionAndMessageFunctions() {
    Function("sessionRecordArchiveCurrentState", ...)
    Function("sessionRecordGetLocalRegistrationId", ...)
    Function("signalMessageGetBody", ...)
    Function("preKeySignalMessageGetVersion", ...)
    // ... decryption error functions
    // ... unidentified sender functions
}
```

### Group 4: Group and Profile Functions
```kotlin
private fun ModuleDefinitionBuilder.registerGroupAndProfileFunctions() {
    Function("generateRegistrationId", ...)
    Function("groupPublicParamsGetGroupIdentifier", ...)
    Function("groupSecretParamsGenerateDeterministic", ...)
    Function("profileKeyCipherTextGetProfileKey", ...)
    // ... credential functions
}
```

### Group 5: Crypto and Group Send Functions
```kotlin
private fun ModuleDefinitionBuilder.registerCryptoAndGroupSendFunctions() {
    Function("Aes256GcmEncrypt", ...)
    Function("Aes256GcmDecrypt", ...)
    Function("Aes256CbcEncrypt", ...)
    Function("sealedSenderEncrypt", ...)
    // ... HKDF functions
    // ... group send functions
}
```

### Group 6: Backup Functions
```kotlin
private fun ModuleDefinitionBuilder.registerBackupFunctions() {
    Function("backupAuthCredentialRequestContextNew", ...)
    Function("backupAuthCredentialGetBackupId", ...)
    Function("backupKeyDeriveBackupId", ...)
    Function("comparableBackupGetInfo", ...)
    // ... message backup functions
}
```

---

## Troubleshooting

### Patch Doesn't Apply

If the patch fails to apply, it may be due to version mismatch:

1. Check the version in `package.json`:
   ```json
   "react-native-libsignal-client": "^0.1.44"
   ```

2. If different, regenerate the patch:
   ```bash
   # Make changes manually to node_modules
   npx patch-package react-native-libsignal-client
   ```

### Still Getting "Method too large"

If the error persists after patching:

1. Verify patch was applied:
   ```bash
   grep "registerServiceIdAndCertificateFunctions" \
     node_modules/react-native-libsignal-client/android/src/main/java/expo/modules/libsignalclient/ReactNativeLibsignalClientModule.kt
   ```

2. Clean and rebuild:
   ```bash
   cd android
   ./gradlew clean
   ./gradlew assembleDebug
   ```

3. If new functions were added upstream, you may need to add another extension function group.

### Version Updates

When updating `react-native-libsignal-client`:

1. Remove old patch
2. Install new version
3. Check if patch is still needed (try building)
4. If needed, reapply changes and regenerate patch:
   ```bash
   npx patch-package react-native-libsignal-client
   ```

---

## Contributing Back

Consider submitting this fix upstream:

1. Fork https://github.com/nicklockwood/react-native-libsignal-client
2. Apply the changes to `ReactNativeLibsignalClientModule.kt`
3. Submit a PR with this explanation

This is a common issue with large Expo modules and benefits all users.

---

## References

- [JVM Method Size Limit](https://docs.oracle.com/javase/specs/jvms/se8/html/jvms-4.html#jvms-4.7.3)
- [Expo Modules API](https://docs.expo.dev/modules/module-api/)
- [patch-package](https://github.com/ds300/patch-package)
- [react-native-libsignal-client](https://github.com/nicklockwood/react-native-libsignal-client)
