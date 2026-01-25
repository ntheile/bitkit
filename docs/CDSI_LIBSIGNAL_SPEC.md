# CDSI Implementation Specification for react-native-libsignal-client

This document specifies the required changes to implement CDSI (Contact Discovery Service) phone number lookup in the `react-native-libsignal-client` library.

## Background

CDSI allows privacy-preserving contact discovery by using Intel SGX secure enclaves. Signal rotated their CDSI enclaves on April 18, 2025, which requires libsignal-client 0.76.1+ with updated attestation data.

## Current State

- The `CdsiModule` exists but throws `CDSI_NOT_IMPLEMENTED`
- Username lookup works via the `usernames` module
- The library uses `libsignal-android:0.76.1` and `libsignal-client:0.76.1`

## Required Implementation

### 1. Android CdsiModule.kt

**File:** `android/src/main/java/expo/modules/libsignalclient/CdsiModule.kt`

The module needs to use the correct libsignal 0.76.1 API. Key differences from earlier versions:

#### API Signature for Network.cdsiLookup

```kotlin
// libsignal 0.76.1 signature:
fun cdsiLookup(
    username: String,
    password: String,
    request: CdsiLookupRequest,
    tokenConsumer: Consumer<ByteArray>
): CompletableFuture<CdsiLookupResponse>
```

Note: It takes `Consumer<ByteArray>` for the token callback, NOT `Function2<Long, Long, Unit>`.

#### CdsiLookupRequest Construction

There is **NO Builder class**. Use the constructor directly:

```kotlin
// Constructor signature:
CdsiLookupRequest(
    previousE164s: Set<String>,    // Previously looked up numbers
    newE164s: Set<String>,          // New numbers to look up
    serviceIds: Map<ServiceId, ProfileKey>,  // Known contacts with profile keys
    token: Optional<ByteArray>      // Previous lookup token for incremental
)
```

#### CdsiLookupResponse Structure

```kotlin
// Response methods:
response.entries()  // Returns Map<String, CdsiLookupResponse.Entry>
response.debugPermitsUsed  // Returns int (field, not method)

// Entry structure - fields are PUBLIC, not getters:
entry.aci  // ServiceId.Aci? (nullable)
entry.pni  // ServiceId.Pni? (nullable)
```

#### Complete Implementation

```kotlin
package expo.modules.libsignalclient

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import org.signal.libsignal.net.Network
import org.signal.libsignal.net.CdsiLookupRequest
import org.signal.libsignal.protocol.ServiceId.Aci
import org.signal.libsignal.zkgroup.profiles.ProfileKey
import java.util.Optional
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CdsiModule : Module() {
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    
    override fun definition() = ModuleDefinition {
        Name("Cdsi")

        AsyncFunction("cdsiLookup") { 
            username: String,
            password: String,
            request: Map<String, Any?>,
            environment: String,
            userAgent: String,
            promise: Promise ->
            
            executor.execute {
                try {
                    val result = performCdsiLookup(username, password, request, environment, userAgent)
                    promise.resolve(result)
                } catch (e: Exception) {
                    promise.reject("CDSI_ERROR", e.message ?: "CDSI lookup failed", e)
                }
            }
        }
    }
    
    private fun performCdsiLookup(
        username: String,
        password: String,
        request: Map<String, Any?>,
        environment: String,
        userAgent: String
    ): Map<String, Any> {
        // Determine environment
        val networkEnv = when (environment.lowercase()) {
            "staging" -> Network.Environment.STAGING
            else -> Network.Environment.PRODUCTION
        }
        
        // Create network instance
        val network = Network(networkEnv, userAgent)
        
        // Parse request parameters
        @Suppress("UNCHECKED_CAST")
        val e164s = (request["e164s"] as? List<String>) ?: emptyList()
        @Suppress("UNCHECKED_CAST")
        val prevE164s = (request["prevE164s"] as? List<String>) ?: emptyList()
        val tokenString = request["token"] as? String
        @Suppress("UNCHECKED_CAST")
        val serviceIdsAndProfileKeys = request["serviceIdsAndProfileKeys"] as? List<Map<String, String>> ?: emptyList()
        
        // Build sets for the request
        val newE164Set = e164s.toMutableSet()
        val prevE164Set = prevE164s.toMutableSet()
        
        // Build service IDs map
        val serviceIdsMap = mutableMapOf<org.signal.libsignal.protocol.ServiceId, ProfileKey>()
        for (entry in serviceIdsAndProfileKeys) {
            val aciString = entry["aci"]
            val profileKeyString = entry["profileKey"]
            if (aciString != null && profileKeyString != null) {
                try {
                    val aci = Aci.parseFromString(aciString)
                    val profileKeyBytes = android.util.Base64.decode(profileKeyString, android.util.Base64.DEFAULT)
                    val profileKey = ProfileKey(profileKeyBytes)
                    serviceIdsMap[aci] = profileKey
                } catch (e: Exception) {
                    // Skip invalid entries
                }
            }
        }
        
        // Parse token
        val tokenOptional: Optional<ByteArray> = if (tokenString != null && tokenString.isNotEmpty()) {
            Optional.of(android.util.Base64.decode(tokenString, android.util.Base64.DEFAULT))
        } else {
            Optional.empty()
        }
        
        // Build the CDSI lookup request - NO BUILDER, use constructor
        val cdsiRequest = CdsiLookupRequest(
            prevE164Set,
            newE164Set,
            serviceIdsMap,
            tokenOptional
        )
        
        // Store token from callback
        var responseToken: ByteArray? = null
        val tokenConsumer: java.util.function.Consumer<ByteArray> = java.util.function.Consumer { token ->
            responseToken = token
        }
        
        // Perform the lookup - returns CompletableFuture
        val responseFuture = network.cdsiLookup(username, password, cdsiRequest, tokenConsumer)
        val response = responseFuture.get()  // Blocking call
        
        // Convert response to map format
        val entries = mutableListOf<Map<String, Any?>>()
        for ((e164, lookupEntry) in response.entries()) {  // entries() is a method
            val entryMap = mutableMapOf<String, Any?>()
            entryMap["e164"] = e164
            entryMap["aci"] = lookupEntry.aci?.toServiceIdString()  // Direct field access
            entryMap["pni"] = lookupEntry.pni?.toServiceIdString()  // Direct field access
            entries.add(entryMap)
        }
        
        // Return result
        val result = mutableMapOf<String, Any>()
        result["entries"] = entries
        result["token"] = if (responseToken != null) {
            android.util.Base64.encodeToString(responseToken, android.util.Base64.NO_WRAP)
        } else {
            ""
        }
        result["debugPermitsUsed"] = response.debugPermitsUsed  // Field, not method
        
        return result
    }
}
```

### 2. iOS CdsiModule.swift

**File:** `ios/CdsiModule.swift`

The iOS implementation needs to use the Swift libsignal-client 0.76.1 API. Key points:

```swift
import ExpoModulesCore
import LibSignalClient

public class CdsiModule: Module {
    public func definition() -> ModuleDefinition {
        Name("Cdsi")

        AsyncFunction("cdsiLookup") { (
            username: String,
            password: String,
            request: [String: Any],
            environment: String,
            userAgent: String,
            promise: Promise
        ) in
            Task {
                do {
                    let result = try await self.performCdsiLookup(
                        username: username,
                        password: password,
                        request: request,
                        environment: environment,
                        userAgent: userAgent
                    )
                    promise.resolve(result)
                } catch {
                    promise.reject("CDSI_ERROR", error.localizedDescription)
                }
            }
        }
    }
    
    private func performCdsiLookup(
        username: String,
        password: String,
        request: [String: Any],
        environment: String,
        userAgent: String
    ) async throws -> [String: Any] {
        // TODO: Implement using Swift libsignal API
        // The Swift API may differ - consult LibSignalClient Swift documentation
        throw NSError(domain: "CDSI", code: -1, userInfo: [
            NSLocalizedDescriptionKey: "iOS CDSI not yet implemented"
        ])
    }
}
```

**Note:** The Swift libsignal API may have different class names and method signatures. Consult the libsignal-swift 0.76.1 documentation.

### 3. JavaScript Interface

The JS interface is already correct in `src/Cdsi.ts` and `build/Cdsi.js`. No changes needed.

**Expected JS Interface:**

```typescript
interface CdsiLookupOptions {
  username: string;          // From /v2/directory/auth
  password: string;          // From /v2/directory/auth  
  environment: 'production' | 'staging';
  phoneNumbers: string[];    // E.164 format: +14155551234
  appName: string;           // User-Agent string
  prevPhoneNumbers?: string[];
  serviceIdsAndProfileKeys?: Array<{aci: string, profileKey: string}>;
  token?: string;            // Base64 encoded token from previous lookup
}

interface CdsiLookupResponse {
  entries: Array<{
    e164: string;
    aci: string | null;
    pni: string | null;
  }>;
  token: string;             // Base64 encoded token for next lookup
  debugPermitsUsed: number;
}
```

### 4. expo-module.config.json

Already correct:

```json
{
  "platforms": ["ios", "tvos", "android", "web"],
  "ios": {
    "modules": ["ReactNativeLibsignalClientModule", "ElasticCipherModule", "CdsiModule"]
  },
  "android": {
    "modules": [
      "expo.modules.libsignalclient.ReactNativeLibsignalClientModule",
      "expo.modules.libsignalclient.ElasticCipher",
      "expo.modules.libsignalclient.CdsiModule"
    ]
  }
}
```

## Testing

To test CDSI:

1. Link account to Signal (get ACI, deviceId, password)
2. Get CDSI auth credentials from `GET /v2/directory/auth`
3. Call `cdsiLookup()` with the credentials and phone numbers
4. Verify response contains ACIs for registered Signal users

## libsignal JAR Inspection Commands

To inspect the actual API in libsignal-android 0.76.1:

```bash
# Find the JAR
find ~/.gradle -name "libsignal-android-0.76.1.jar" 2>/dev/null

# Extract and inspect classes
cd /tmp
jar xf <path-to-jar> org/signal/libsignal/net/CdsiLookupRequest.class
javap -public org.signal.libsignal.net.CdsiLookupRequest

jar xf <path-to-jar> org/signal/libsignal/net/CdsiLookupResponse.class  
javap -public org.signal.libsignal.net.CdsiLookupResponse

jar xf <path-to-jar> org/signal/libsignal/net/Network.class
javap -public org.signal.libsignal.net.Network
```

## Key API Differences from Earlier libsignal Versions

| Feature | Old API | libsignal 0.76.1 |
|---------|---------|------------------|
| Request builder | `CdsiLookupRequest.Builder()` | Constructor only |
| Auth | `Network.Auth(username, password)` | Pass strings directly |
| Token callback | `Function2<Long, Long, Unit>` | `Consumer<ByteArray>` |
| Response entries | `response.entries` (property) | `response.entries()` (method) |
| Entry ACI/PNI | `entry.aci()` (method) | `entry.aci` (field) |
| Token in response | `response.token` | Via callback only |

## Observed API from JAR Inspection (libsignal-android 0.76.1)

### Network class
```
public org.signal.libsignal.net.Network(org.signal.libsignal.net.Network$Environment, java.lang.String);
public java.util.concurrent.CompletableFuture<org.signal.libsignal.net.CdsiLookupResponse> cdsiLookup(java.lang.String, java.lang.String, org.signal.libsignal.net.CdsiLookupRequest, java.util.function.Consumer<byte[]>);
```

### CdsiLookupRequest class
```
public org.signal.libsignal.net.CdsiLookupRequest(java.util.Set<java.lang.String>, java.util.Set<java.lang.String>, java.util.Map<org.signal.libsignal.protocol.ServiceId, org.signal.libsignal.zkgroup.profiles.ProfileKey>, java.util.Optional<byte[]>);
```

### CdsiLookupResponse class
```
public final int debugPermitsUsed;
public java.util.Map<java.lang.String, org.signal.libsignal.net.CdsiLookupResponse$Entry> entries();
```

### CdsiLookupResponse.Entry class
```
public final org.signal.libsignal.protocol.ServiceId$Aci aci;
public final org.signal.libsignal.protocol.ServiceId$Pni pni;
```

## Known Issues

### "Cannot read property 'prototype' of undefined"

This error occurs when the native module fails to initialize properly. Possible causes:

1. **Missing native dependency**: The libsignal-android/libsignal-client JARs might not be properly included
2. **API mismatch**: Using the wrong API signature causes Kotlin compilation to succeed but runtime to fail
3. **Module registration**: expo-module.config.json might be incorrect
4. **Metro cache**: Stale JS bundle - run `npx react-native start --reset-cache`

### Solution

For the bitkit app, the safest approach is to use a stub implementation that returns a clear error message, then implement CDSI in the upstream `react-native-libsignal-client` library properly.
