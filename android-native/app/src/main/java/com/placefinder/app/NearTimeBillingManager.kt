package com.placefinder.app

import android.app.Activity
import android.content.Context
import android.provider.Settings
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

internal data class BillingUiState(
    val ready: Boolean = false,
    val busy: Boolean = false,
    val monthlyPrice: String? = null,
    val extraPrice: String? = null,
    val monthlyAvailable: Boolean = false,
    val extraAvailable: Boolean = false,
    val entitlementSession: String? = null,
    val message: String? = null,
    val isError: Boolean = false,
    val revision: Int = 0
)

internal class NearTimeBillingManager(
    private val activity: Activity
) : PurchasesUpdatedListener {

    companion object {
        const val MONTHLY_PRODUCT_ID = "neartime_monthly"
        const val EXTRA_PRODUCT_ID = "neartime_search_pack_20"
        private const val VERIFY_SUBSCRIPTION_URL =
            "https://neartime.vercel.app/api/entitlement/verify"
        private const val VERIFY_TOPUP_URL =
            "https://neartime.vercel.app/api/entitlement/topup"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(
        BillingUiState(entitlementSession = loadEntitlementSession(activity))
    )
    val state: StateFlow<BillingUiState> = _state.asStateFlow()

    private var monthlyProduct: ProductDetails? = null
    private var extraProduct: ProductDetails? = null

    private val billingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .build()
        )
        .enableAutoServiceReconnection()
        .build()

    init { connect() }

    private fun connect() {
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    _state.value = _state.value.copy(ready = true, message = null, isError = false)
                    queryProducts()
                    restorePurchases(showMessage = false)
                } else {
                    _state.value = _state.value.copy(
                        ready = false,
                        message = null,
                        isError = false
                    )
                }
            }

            override fun onBillingServiceDisconnected() {
                _state.value = _state.value.copy(ready = false)
            }
        })
    }

    private fun queryProducts() {
        val subscriptionParams = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(MONTHLY_PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                )
            )
            .build()

        val inAppParams = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(EXTRA_PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                )
            )
            .build()

        billingClient.queryProductDetailsAsync(subscriptionParams) { subscriptionResult, subscriptionDetails ->
            if (subscriptionResult.responseCode == BillingClient.BillingResponseCode.OK) {
                monthlyProduct = subscriptionDetails.productDetailsList.firstOrNull {
                    it.productId == MONTHLY_PRODUCT_ID
                }
            }

            billingClient.queryProductDetailsAsync(inAppParams) { inAppResult, inAppDetails ->
                if (inAppResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    extraProduct = inAppDetails.productDetailsList.firstOrNull {
                        it.productId == EXTRA_PRODUCT_ID
                    }
                }

                val monthlyPrice = monthlyProduct
                    ?.subscriptionOfferDetails
                    ?.firstOrNull()
                    ?.pricingPhases
                    ?.pricingPhaseList
                    ?.lastOrNull()
                    ?.formattedPrice
                val extraPrice = extraProduct
                    ?.oneTimePurchaseOfferDetailsList
                    ?.firstOrNull()
                    ?.formattedPrice

                val productQueryFailed =
                    subscriptionResult.responseCode != BillingClient.BillingResponseCode.OK ||
                    inAppResult.responseCode != BillingClient.BillingResponseCode.OK

                _state.value = _state.value.copy(
                    monthlyPrice = monthlyPrice,
                    extraPrice = extraPrice,
                    monthlyAvailable = monthlyProduct != null,
                    extraAvailable = extraProduct != null,
                    message = if (productQueryFailed) {
                        "Google Play could not load one or more purchase products."
                    } else {
                        null
                    },
                    isError = productQueryFailed
                )
            }
        }
    }

    fun launchSubscription() {
        launchProduct(
            product = monthlyProduct,
            kind = BillingClient.ProductType.SUBS,
            fallbackMessage = "The monthly subscription is not available from Google Play yet."
        )
    }

    fun launchExtraSearchPack() {
        if (_state.value.entitlementSession.isNullOrBlank()) {
            _state.value = _state.value.copy(
                message = "Restore or activate the monthly subscription before buying extra searches.",
                isError = true
            )
            return
        }
        launchProduct(
            product = extraProduct,
            kind = BillingClient.ProductType.INAPP,
            fallbackMessage = "The 20-search pack is not available from Google Play yet."
        )
    }

    private fun launchProduct(product: ProductDetails?, kind: String, fallbackMessage: String) {
        if (!billingClient.isReady || product == null) {
            _state.value = _state.value.copy(message = fallbackMessage, isError = true)
            return
        }

        val offerToken = if (kind == BillingClient.ProductType.SUBS) {
            product.subscriptionOfferDetails?.firstOrNull()?.offerToken
        } else {
            product.oneTimePurchaseOfferDetailsList?.firstOrNull()?.offerToken
        }

        val item = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(product)
        if (!offerToken.isNullOrBlank()) item.setOfferToken(offerToken)

        val result = billingClient.launchBillingFlow(
            activity,
            BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(item.build()))
                .build()
        )
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            _state.value = _state.value.copy(
                message = "Google Play could not start checkout: " + result.debugMessage,
                isError = true
            )
        }
    }

    override fun onPurchasesUpdated(
        billingResult: BillingResult,
        purchases: MutableList<Purchase>?
    ) {
        when (billingResult.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach(::processPurchase)
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                _state.value = _state.value.copy(busy = false, message = "Purchase cancelled.", isError = false)
            }
            else -> {
                _state.value = _state.value.copy(
                    busy = false,
                    message = "Google Play purchase failed: " + billingResult.debugMessage,
                    isError = true
                )
            }
        }
    }

    private fun processPurchase(purchase: Purchase) {
        if (purchase.purchaseState == Purchase.PurchaseState.PENDING) {
            _state.value = _state.value.copy(
                busy = false,
                message = "Payment is pending in Google Play. Searches unlock after payment completes.",
                isError = false
            )
            return
        }
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return

        when {
            purchase.products.contains(MONTHLY_PRODUCT_ID) -> activateSubscription(purchase)
            purchase.products.contains(EXTRA_PRODUCT_ID) -> activateExtraPack(purchase)
        }
    }

    private fun activateSubscription(purchase: Purchase) {
        _state.value = _state.value.copy(busy = true, message = "Verifying subscription…", isError = false)
        scope.launch {
            try {
                val sessionToken = verifySubscriptionOnServer(purchase.purchaseToken)
                saveEntitlementSession(activity, sessionToken)
                _state.value = _state.value.copy(
                    busy = false,
                    entitlementSession = sessionToken,
                    message = "Subscription active · 30 searches available this billing period.",
                    isError = false,
                    revision = _state.value.revision + 1
                )

                if (!purchase.isAcknowledged) {
                    billingClient.acknowledgePurchase(
                        AcknowledgePurchaseParams.newBuilder()
                            .setPurchaseToken(purchase.purchaseToken)
                            .build()
                    ) { result ->
                        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                            _state.value = _state.value.copy(
                                message = "Subscription is active; Google Play acknowledgement will retry on restore.",
                                isError = false
                            )
                        }
                    }
                }
                queryUnconsumedExtraPurchases()
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    busy = false,
                    message = e.message ?: "Subscription verification failed.",
                    isError = true
                )
            }
        }
    }

    private fun activateExtraPack(purchase: Purchase) {
        val sessionToken = _state.value.entitlementSession
        if (sessionToken.isNullOrBlank()) {
            _state.value = _state.value.copy(
                busy = false,
                message = "An active subscription is required for extra searches.",
                isError = true
            )
            return
        }

        _state.value = _state.value.copy(busy = true, message = "Adding 20 searches…", isError = false)
        scope.launch {
            try {
                verifyTopupOnServer(purchase.purchaseToken, sessionToken)
                _state.value = _state.value.copy(
                    busy = false,
                    message = "20 extra searches added.",
                    isError = false,
                    revision = _state.value.revision + 1
                )

                billingClient.consumeAsync(
                    ConsumeParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
                ) { result, _ ->
                    if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                        _state.value = _state.value.copy(
                            message = "20 searches were added; Google Play consumption will retry on restore.",
                            isError = false
                        )
                    }
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    busy = false,
                    message = e.message ?: "Could not activate the extra-search pack.",
                    isError = true
                )
            }
        }
    }

    fun restorePurchases(showMessage: Boolean) {
        if (!billingClient.isReady) {
            if (showMessage) {
                _state.value = _state.value.copy(
                    message = "Google Play Billing is not connected yet.",
                    isError = true
                )
            }
            return
        }

        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()
        billingClient.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                if (showMessage) {
                    _state.value = _state.value.copy(
                        message = "Could not restore Google Play purchases.",
                        isError = true
                    )
                }
                return@queryPurchasesAsync
            }

            val active = purchases.firstOrNull {
                it.purchaseState == Purchase.PurchaseState.PURCHASED &&
                    it.products.contains(MONTHLY_PRODUCT_ID)
            }
            if (active != null) {
                activateSubscription(active)
            } else {
                if (showMessage) {
                    _state.value = _state.value.copy(
                        message = "No active monthly subscription found in Google Play.",
                        isError = false
                    )
                }
                queryUnconsumedExtraPurchases()
            }
        }
    }

    private fun queryUnconsumedExtraPurchases() {
        if (_state.value.entitlementSession.isNullOrBlank() || !billingClient.isReady) return
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        billingClient.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                purchases.filter {
                    it.purchaseState == Purchase.PurchaseState.PURCHASED &&
                        it.products.contains(EXTRA_PRODUCT_ID)
                }.forEach(::activateExtraPack)
            }
        }
    }

    private suspend fun verifySubscriptionOnServer(purchaseToken: String): String =
        withContext(Dispatchers.IO) {
            val json = postBillingJson(
                VERIFY_SUBSCRIPTION_URL,
                JSONObject().put("platform", "android").put("purchaseToken", purchaseToken),
                null
            )
            json.optString("sessionToken").takeIf { it.length >= 20 }
                ?: throw IllegalStateException("NearTime did not receive a valid subscription session.")
        }

    private suspend fun verifyTopupOnServer(purchaseToken: String, entitlementSession: String) =
        withContext(Dispatchers.IO) {
            postBillingJson(
                VERIFY_TOPUP_URL,
                JSONObject()
                    .put("platform", "android")
                    .put("productId", EXTRA_PRODUCT_ID)
                    .put("purchaseToken", purchaseToken),
                entitlementSession
            )
        }

    private fun postBillingJson(url: String, payload: JSONObject, entitlementSession: String?): JSONObject {
        val body = payload.toString()
            .toByteArray(StandardCharsets.UTF_8)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val builder = Request.Builder()
            .url(url)
            .post(body)
            .header("Accept", "application/json")
            .header("x-neartime-device-id", getOrCreateInstallId(activity))
        if (!entitlementSession.isNullOrBlank()) {
            builder.header("Authorization", "Bearer " + entitlementSession)
        }

        BILLING_HTTP_CLIENT.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!response.isSuccessful) {
                throw IllegalStateException(
                    json.optString("error").ifBlank {
                        "Billing server HTTP " + response.code.toString()
                    }
                )
            }
            return json
        }
    }

    fun close() {
        scope.cancel()
        billingClient.endConnection()
    }
}

private const val ACCESS_PREFS = "neartime_access"
private const val INSTALL_ID_KEY = "install_id"
private const val ENTITLEMENT_SESSION_KEY = "entitlement_session"

private val BILLING_HTTP_CLIENT = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(25, TimeUnit.SECONDS)
    .writeTimeout(10, TimeUnit.SECONDS)
    .build()

internal fun getOrCreateInstallId(context: Context): String {
    val prefs = context.getSharedPreferences(ACCESS_PREFS, Context.MODE_PRIVATE)
    val existing = prefs.getString(INSTALL_ID_KEY, null)?.trim()
    if (!existing.isNullOrBlank()) return existing

    val created = UUID.randomUUID().toString()
    prefs.edit().putString(INSTALL_ID_KEY, created).apply()
    return created
}

internal fun getOrCreateInstallHash(context: Context): String {
    val androidId = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ANDROID_ID
    )?.trim().orEmpty()

    val stableQuotaIdentity = if (androidId.isNotBlank()) {
        "android-device-v1:$androidId"
    } else {
        // Defensive fallback for broken/modified devices. Normal Android
        // installs expose ANDROID_ID on every supported API level.
        "install-fallback-v1:${getOrCreateInstallId(context)}"
    }

    return MessageDigest.getInstance("SHA-256")
        .digest(stableQuotaIdentity.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte) }
}

internal fun loadEntitlementSession(context: Context): String? =
    context.getSharedPreferences(ACCESS_PREFS, Context.MODE_PRIVATE)
        .getString(ENTITLEMENT_SESSION_KEY, null)
        ?.trim()
        ?.takeIf { it.isNotBlank() }

private fun saveEntitlementSession(context: Context, token: String) {
    context.getSharedPreferences(ACCESS_PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(ENTITLEMENT_SESSION_KEY, token)
        .apply()
}
