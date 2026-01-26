package com.bitkit.modules

import android.content.Context
import com.facebook.react.modules.network.CustomClientBuilder
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.network.ReactCookieJarContainer
import com.facebook.react.modules.websocket.WebSocketModule
import okhttp3.OkHttpClient
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Trust-all SSL configuration for development/testing.
 * WARNING: This disables SSL certificate validation - DO NOT use in production!
 */
class SignalTrustingClientFactory(private val context: Context) : OkHttpClientFactory {
    
    override fun createNewNetworkModuleClient(): OkHttpClient {
        return try {
            val (sslContext, trustManager) = SignalCertificateTrust.createTrustAllSSLContext()
            
            android.util.Log.i("SignalTrust", "Trust-all SSL client created (DEV MODE)")
            
            OkHttpClient.Builder()
                .connectTimeout(0, TimeUnit.MILLISECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .writeTimeout(0, TimeUnit.MILLISECONDS)
                .cookieJar(ReactCookieJarContainer())
                .sslSocketFactory(sslContext.socketFactory, trustManager)
                .hostnameVerifier { _, _ -> true }
                .build()
        } catch (e: Exception) {
            android.util.Log.e("SignalTrust", "Failed to create trust-all SSL client", e)
            OkHttpClient.Builder()
                .connectTimeout(0, TimeUnit.MILLISECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .writeTimeout(0, TimeUnit.MILLISECONDS)
                .cookieJar(ReactCookieJarContainer())
                .build()
        }
    }
}

/**
 * Custom client builder for WebSocket module to trust all certificates.
 */
class TrustAllWebSocketClientBuilder : CustomClientBuilder {
    override fun apply(builder: OkHttpClient.Builder) {
        try {
            val (sslContext, trustManager) = SignalCertificateTrust.createTrustAllSSLContext()
            builder.sslSocketFactory(sslContext.socketFactory, trustManager)
            builder.hostnameVerifier { _, _ -> true }
            android.util.Log.i("SignalTrust", "Applied trust-all SSL to WebSocket client")
        } catch (e: Exception) {
            android.util.Log.e("SignalTrust", "Failed to apply trust-all to WebSocket", e)
        }
    }
}

/**
 * Initializes trust-all SSL configuration for development.
 * WARNING: This disables SSL certificate validation - DO NOT use in production!
 */
object SignalCertificateTrust {
    
    private val trustAllManager = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
    
    private val trustAllHostnameVerifier = HostnameVerifier { _, _ -> true }
    
    fun initialize(context: Context) {
        try {
            android.util.Log.w("SignalTrust", "⚠️ Initializing TRUST-ALL SSL mode (DEV ONLY)...")
            
            val (sslContext, _) = createTrustAllSSLContext()
            
            // Set as default for ALL HTTPS connections (including WebSocket)
            HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.socketFactory)
            HttpsURLConnection.setDefaultHostnameVerifier(trustAllHostnameVerifier)
            android.util.Log.i("SignalTrust", "Set default trust-all SSLSocketFactory")
            
            // Set custom OkHttpClient for RN network modules
            OkHttpClientProvider.setOkHttpClientFactory(SignalTrustingClientFactory(context))
            android.util.Log.i("SignalTrust", "Set trust-all OkHttpClientFactory")
            
            // IMPORTANT: Set custom client builder for WebSocket module!
            WebSocketModule.setCustomClientBuilder(TrustAllWebSocketClientBuilder())
            android.util.Log.i("SignalTrust", "Set trust-all WebSocket CustomClientBuilder")
            
            android.util.Log.w("SignalTrust", "⚠️ Trust-all SSL initialized - ALL CERTS ACCEPTED!")
        } catch (e: Exception) {
            android.util.Log.e("SignalTrust", "Failed to initialize trust-all SSL", e)
        }
    }
    
    fun createTrustAllSSLContext(): Pair<SSLContext, X509TrustManager> {
        val sslContext = SSLContext.getInstance("TLS").apply {
            init(null, arrayOf(trustAllManager), SecureRandom())
        }
        return Pair(sslContext, trustAllManager)
    }
}
