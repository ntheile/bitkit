# Adding CDSI Support to react-native-libsignal-client

## Overview

This specification describes how to add Contact Discovery Service (CDSI) support to the `react-native-libsignal-client` package. CDSI enables privacy-preserving phone number to ACI/PNI lookups using Intel SGX secure enclaves.

## Background

### What is CDSI?

CDSI (Contact Discovery Service) is Signal's privacy-preserving contact discovery system. It allows clients to look up which of their contacts are registered Signal users without revealing their entire contact list to Signal's servers.

Key properties:
- Uses Intel SGX secure enclaves
- Server cannot see plaintext phone numbers
- Rate-limited to prevent enumeration attacks
- Returns ACI (Account Identity) and PNI (Phone Number Identity) for matches

### Current State

The `react-native-libsignal-client` package wraps `libsignal` but does **not** expose CDSI functionality. The upstream `libsignal` library (Rust) has full CDSI support with bindings for:
- Node.js (`@signalapp/libsignal-client`)
- Swift (iOS native)
- Java/Kotlin (Android native)

### Goal

Add React Native bindings for CDSI that work on both iOS and Android by leveraging the existing native libsignal implementations.

---

## Architecture

### Upstream libsignal CDSI Classes

From `libsignal` (Rust with language bindings):

```
// Core types needed
- Net (network layer)
- CdsiLookup
- LookupRequest
- LookupResponse
- AciAndAccessKey
- Environment (Production/Staging)
```

### React Native Bridge Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    JavaScript Layer                          │
│  CdsiLookup.lookup(phoneNumbers, auth) → Promise<Results>   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Native Module Bridge                       │
│         NativeModules.SignalClientCdsi.lookup()             │
└─────────────────────────────────────────────────────────────┘
           │                                    │
           ▼                                    ▼
┌─────────────────────┐            ┌─────────────────────────┐
│    iOS (Swift)      │            │   Android (Kotlin)      │
│  LibSignalClient    │            │   org.signal.libsignal  │
│  - Net              │            │   - Net                 │
│  - CdsiLookup       │            │   - CdsiLookup          │
└─────────────────────┘            └─────────────────────────┘
```

---

## Implementation Steps

### Step 1: Update libsignal Dependencies

#### iOS (Podspec)

File: `react-native-libsignal-client.podspec`

```ruby
Pod::Spec.new do |s|
  s.name         = "react-native-libsignal-client"
  # ... existing config ...
  
  # Ensure LibSignalClient pod includes net/cdsi modules
  s.dependency "LibSignalClient", "~> 0.58.0"  # or latest version with CDSI
end
```

#### Android (build.gradle)

File: `android/build.gradle`

```gradle
dependencies {
    implementation "org.signal:libsignal-client:0.58.0"  // or latest
    // Ensure the full library with net module is included
}
```

### Step 2: Create JavaScript API

File: `src/Cdsi.ts`

```typescript
import { NativeModules } from 'react-native';

const { SignalClientCdsi } = NativeModules;

export interface CdsiAuthCredentials {
  username: string;
  password: string;
}

export interface AciAndAccessKey {
  aci: string;           // UUID string
  accessKey: Uint8Array; // 16 bytes
}

export interface CdsiLookupRequest {
  /** E.164 phone numbers to look up */
  e164s: string[];
  /** Previously returned token for rate limiting (optional for first request) */
  token?: Uint8Array;
  /** ACIs with access keys for existing contacts */
  acisAndAccessKeys?: AciAndAccessKey[];
  /** Whether to return ACI+PNI or just indicate registered */
  returnAcisWithoutUaks?: boolean;
}

export interface CdsiLookupResult {
  e164: string;
  aci: string | null;
  pni: string | null;
}

export interface CdsiLookupResponse {
  results: CdsiLookupResult[];
  /** Token to use for subsequent requests (for rate limiting) */
  token: Uint8Array;
  /** Debug info about rate limit quota used */
  debugPermitsUsed: number;
}

export enum CdsiEnvironment {
  Production = 'production',
  Staging = 'staging',
}

/**
 * Perform a CDSI lookup to find ACIs for phone numbers.
 * 
 * @param auth - CDSI auth credentials from /v2/directory/auth
 * @param request - The lookup request with phone numbers
 * @param environment - Production or Staging (default: Production)
 * @returns Promise resolving to lookup results
 */
export async function lookup(
  auth: CdsiAuthCredentials,
  request: CdsiLookupRequest,
  environment: CdsiEnvironment = CdsiEnvironment.Production
): Promise<CdsiLookupResponse> {
  // Convert Uint8Arrays to base64 for native bridge
  const serializedRequest = {
    e164s: request.e164s,
    token: request.token ? Buffer.from(request.token).toString('base64') : null,
    acisAndAccessKeys: request.acisAndAccessKeys?.map(a => ({
      aci: a.aci,
      accessKey: Buffer.from(a.accessKey).toString('base64'),
    })),
    returnAcisWithoutUaks: request.returnAcisWithoutUaks ?? false,
  };

  const response = await SignalClientCdsi.lookup(
    auth.username,
    auth.password,
    serializedRequest,
    environment
  );

  return {
    results: response.results,
    token: Buffer.from(response.token, 'base64'),
    debugPermitsUsed: response.debugPermitsUsed,
  };
}

/**
 * Check if CDSI is available on this platform.
 */
export function isAvailable(): boolean {
  return SignalClientCdsi != null && typeof SignalClientCdsi.lookup === 'function';
}
```

### Step 3: iOS Native Module

File: `ios/SignalClientCdsi.swift`

```swift
import Foundation
import LibSignalClient

@objc(SignalClientCdsi)
class SignalClientCdsi: NSObject {
    
    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
    
    @objc
    func lookup(
        _ username: String,
        password: String,
        request: NSDictionary,
        environment: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            do {
                let result = try await performLookup(
                    username: username,
                    password: password,
                    request: request,
                    environment: environment
                )
                resolve(result)
            } catch {
                reject("CDSI_ERROR", error.localizedDescription, error)
            }
        }
    }
    
    private func performLookup(
        username: String,
        password: String,
        request: NSDictionary,
        environment: String
    ) async throws -> NSDictionary {
        // Parse environment
        let env: Net.Environment = environment == "staging" ? .staging : .production
        
        // Create network instance
        let net = Net(env: env)
        
        // Parse request
        guard let e164s = request["e164s"] as? [String] else {
            throw NSError(domain: "CDSI", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Missing e164s in request"
            ])
        }
        
        // Parse optional token
        var token: Data? = nil
        if let tokenBase64 = request["token"] as? String {
            token = Data(base64Encoded: tokenBase64)
        }
        
        // Parse ACIs and access keys
        var acisAndAccessKeys: [AciAndAccessKey] = []
        if let aciList = request["acisAndAccessKeys"] as? [[String: Any]] {
            for item in aciList {
                if let aciStr = item["aci"] as? String,
                   let accessKeyBase64 = item["accessKey"] as? String,
                   let accessKeyData = Data(base64Encoded: accessKeyBase64) {
                    let aci = try Aci.parseFrom(serviceIdString: aciStr)
                    acisAndAccessKeys.append(AciAndAccessKey(
                        aci: aci,
                        accessKey: [UInt8](accessKeyData)
                    ))
                }
            }
        }
        
        let returnAcisWithoutUaks = request["returnAcisWithoutUaks"] as? Bool ?? false
        
        // Build lookup request
        let lookupRequest = try CdsiLookupRequest(
            e164s: e164s,
            acisAndAccessKeys: acisAndAccessKeys,
            prevE164s: [],
            token: token.map { [UInt8]($0) },
            returnAcisWithoutUaks: returnAcisWithoutUaks
        )
        
        // Perform CDSI lookup
        let auth = Auth(username: username, password: password)
        let cdsiLookup = try await net.cdsiLookup(
            auth: auth,
            request: lookupRequest,
            timeout: 30.0
        )
        
        // Get response
        let response = try await cdsiLookup.complete()
        
        // Convert results to dictionary
        var results: [[String: Any?]] = []
        for entry in response.entries {
            results.append([
                "e164": entry.e164,
                "aci": entry.aci?.serviceIdString,
                "pni": entry.pni?.serviceIdString,
            ])
        }
        
        return [
            "results": results,
            "token": Data(response.token).base64EncodedString(),
            "debugPermitsUsed": response.debugPermitsUsed,
        ]
    }
}
```

File: `ios/SignalClientCdsi.m` (Objective-C bridge)

```objc
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SignalClientCdsi, NSObject)

RCT_EXTERN_METHOD(lookup:(NSString *)username
                  password:(NSString *)password
                  request:(NSDictionary *)request
                  environment:(NSString *)environment
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
```

### Step 4: Android Native Module

File: `android/src/main/java/com/signalclient/SignalClientCdsiModule.kt`

```kotlin
package com.signalclient

import com.facebook.react.bridge.*
import kotlinx.coroutines.*
import org.signal.libsignal.net.CdsiLookupRequest
import org.signal.libsignal.net.CdsiLookupResponse
import org.signal.libsignal.net.Network
import org.signal.libsignal.protocol.ServiceId
import java.util.Base64

class SignalClientCdsiModule(reactContext: ReactApplicationContext) : 
    ReactContextBaseJavaModule(reactContext) {
    
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    override fun getName() = "SignalClientCdsi"
    
    @ReactMethod
    fun lookup(
        username: String,
        password: String,
        request: ReadableMap,
        environment: String,
        promise: Promise
    ) {
        scope.launch {
            try {
                val result = performLookup(username, password, request, environment)
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("CDSI_ERROR", e.message, e)
            }
        }
    }
    
    private suspend fun performLookup(
        username: String,
        password: String,
        request: ReadableMap,
        environment: String
    ): WritableMap {
        // Parse environment
        val env = if (environment == "staging") {
            Network.Environment.STAGING
        } else {
            Network.Environment.PRODUCTION
        }
        
        // Create network instance
        val network = Network(env)
        
        // Parse e164s
        val e164sArray = request.getArray("e164s") 
            ?: throw IllegalArgumentException("Missing e164s")
        val e164s = mutableListOf<String>()
        for (i in 0 until e164sArray.size()) {
            e164s.add(e164sArray.getString(i))
        }
        
        // Parse optional token
        val tokenBase64 = request.getString("token")
        val token = tokenBase64?.let { Base64.getDecoder().decode(it) }
        
        // Parse ACIs and access keys
        val acisAndAccessKeys = mutableListOf<CdsiLookupRequest.AciAndAccessKey>()
        request.getArray("acisAndAccessKeys")?.let { array ->
            for (i in 0 until array.size()) {
                val item = array.getMap(i)
                val aciStr = item?.getString("aci")
                val accessKeyBase64 = item?.getString("accessKey")
                if (aciStr != null && accessKeyBase64 != null) {
                    val aci = ServiceId.Aci.parseFromString(aciStr)
                    val accessKey = Base64.getDecoder().decode(accessKeyBase64)
                    acisAndAccessKeys.add(
                        CdsiLookupRequest.AciAndAccessKey(aci, accessKey)
                    )
                }
            }
        }
        
        val returnAcisWithoutUaks = request.getBoolean("returnAcisWithoutUaks")
        
        // Build request
        val lookupRequest = CdsiLookupRequest.Builder()
            .e164s(e164s)
            .acisAndAccessKeys(acisAndAccessKeys)
            .token(token)
            .returnAcisWithoutUaks(returnAcisWithoutUaks)
            .build()
        
        // Perform lookup
        val cdsiLookup = network.cdsiLookup(username, password, lookupRequest)
        val response = cdsiLookup.complete()
        
        // Convert to WritableMap
        val resultsArray = Arguments.createArray()
        for (entry in response.entries) {
            val resultMap = Arguments.createMap()
            resultMap.putString("e164", entry.e164)
            resultMap.putString("aci", entry.aci?.toString())
            resultMap.putString("pni", entry.pni?.toString())
            resultsArray.pushMap(resultMap)
        }
        
        val result = Arguments.createMap()
        result.putArray("results", resultsArray)
        result.putString("token", Base64.getEncoder().encodeToString(response.token))
        result.putInt("debugPermitsUsed", response.debugPermitsUsed)
        
        return result
    }
    
    override fun onCatalystInstanceDestroy() {
        scope.cancel()
        super.onCatalystInstanceDestroy()
    }
}
```

File: `android/src/main/java/com/signalclient/SignalClientCdsiPackage.kt`

```kotlin
package com.signalclient

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SignalClientCdsiPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> {
        return listOf(SignalClientCdsiModule(reactContext))
    }

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> {
        return emptyList()
    }
}
```

### Step 5: Export from Package Index

File: `src/index.ts`

```typescript
// ... existing exports ...

// CDSI exports
export * as Cdsi from './Cdsi';
export { 
  CdsiAuthCredentials,
  CdsiLookupRequest,
  CdsiLookupResponse,
  CdsiLookupResult,
  CdsiEnvironment,
} from './Cdsi';
```

---

## Usage Example

```typescript
import { Cdsi } from 'react-native-libsignal-client';

// 1. Get CDSI auth from Signal server
const authResponse = await fetch('https://chat.signal.org/v2/directory/auth', {
  headers: { Authorization: `Basic ${btoa(`${aci}.${deviceId}:${password}`)}` }
});
const auth = await authResponse.json();

// 2. Perform lookup
const response = await Cdsi.lookup(
  { username: auth.username, password: auth.password },
  { 
    e164s: ['+14155551234', '+14155555678'],
    returnAcisWithoutUaks: true,
  }
);

// 3. Process results
for (const result of response.results) {
  console.log(`${result.e164}: ACI=${result.aci}, PNI=${result.pni}`);
}

// 4. Store token for next request (rate limiting)
await saveToken(response.token);
```

---

## Testing

### Unit Tests

File: `__tests__/Cdsi.test.ts`

```typescript
import { formatE164 } from '../src/Cdsi';

describe('Cdsi', () => {
  describe('formatE164', () => {
    it('formats US numbers correctly', () => {
      expect(formatE164('4155551234')).toBe('+14155551234');
      expect(formatE164('14155551234')).toBe('+14155551234');
      expect(formatE164('+14155551234')).toBe('+14155551234');
    });
  });
});
```

### Integration Tests

Requires a Signal account with valid credentials:

```typescript
import { Cdsi } from 'react-native-libsignal-client';

describe('Cdsi Integration', () => {
  it('performs lookup against staging', async () => {
    const auth = { username: 'test', password: 'test' };
    
    // This will fail with invalid creds, but tests the bridge
    await expect(
      Cdsi.lookup(auth, { e164s: ['+14155551234'] }, Cdsi.CdsiEnvironment.Staging)
    ).rejects.toThrow();
  });
});
```

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `CDSI_ERROR: Invalid credentials` | Bad username/password | Refresh auth from /v2/directory/auth |
| `CDSI_ERROR: Rate limited` | Too many requests | Use token from previous response |
| `CDSI_ERROR: Attestation failed` | SGX verification failed | Ensure libsignal is up to date |
| `CDSI_ERROR: Network error` | Connection issues | Retry with backoff |

### Rate Limiting

CDSI uses a token-based rate limiting system:
1. First request: No token needed
2. Response includes a token
3. Subsequent requests: Include the token
4. Token tracks "permits" (quota used)

---

## Security Considerations

1. **Auth Credentials**: CDSI credentials are separate from account credentials. They expire after 24 hours.

2. **Token Storage**: Store the CDSI token securely (e.g., encrypted storage) as it's tied to your rate limit quota.

3. **Phone Numbers**: Phone numbers are encrypted before being sent to the enclave. The server never sees plaintext numbers.

4. **SGX Attestation**: The library verifies the enclave's MRENCLAVE value to ensure code hasn't been tampered with.

---

## References

- [libsignal source](https://github.com/signalapp/libsignal)
- [Signal CDSI protocol](https://github.com/signalapp/libsignal/tree/main/rust/net/src/cdsi)
- [Signal Private Contact Discovery Blog](https://signal.org/blog/private-contact-discovery/)
- [react-native-libsignal-client](https://github.com/nicklockwood/react-native-libsignal-client)

---

## Checklist for Implementation

- [ ] Update libsignal dependency versions (iOS/Android)
- [ ] Verify libsignal includes net/cdsi modules
- [ ] Create `src/Cdsi.ts` with TypeScript API
- [ ] Create `ios/SignalClientCdsi.swift` native module
- [ ] Create `ios/SignalClientCdsi.m` bridge file
- [ ] Create `android/.../SignalClientCdsiModule.kt`
- [ ] Create `android/.../SignalClientCdsiPackage.kt`
- [ ] Register package in Android's `MainApplication`
- [ ] Add exports to `src/index.ts`
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Update README with CDSI documentation
- [ ] Test on iOS device/simulator
- [ ] Test on Android device/emulator
