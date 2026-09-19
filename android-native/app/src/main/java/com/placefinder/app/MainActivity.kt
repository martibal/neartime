package com.placefinder.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.os.CancellationSignal
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.net.toUri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.math.roundToInt

private const val BACKEND_BASE_URL = "https://pcckllkvnootomwxsmlu.supabase.co/functions/v1/native-search"
private const val SUPABASE_QUOTA_RPC_URL = "https://pcckllkvnootomwxsmlu.supabase.co/rest/v1/rpc/neartime_record_client_quota_usage"
private const val SUPABASE_PUBLISHABLE_KEY = "sb_publishable_dY1cvBi7OU0M3cF3qYusRQ_TpLo7b9Y"
private const val APP_BUILD_ID = "production-20260919-37"
private const val LOG_TAG = "NearTimeNet"
private const val RESULT_LIMIT = 10
private const val DEFAULT_LATITUDE = 59.9110
private const val DEFAULT_LONGITUDE = 10.7522
private const val PRIVACY_POLICY_URL = "https://neartime.vercel.app/privacy"
private const val TERMS_OF_USE_URL = "https://neartime.vercel.app/terms"

private enum class SearchCategory(
    val wireValue: String,
    val displayName: String
) {
    CAFES_COFFEE("cafes_coffee", "Cafés & coffee"),
    RESTAURANTS("restaurants", "Restaurants"),
    FAST_FOOD_TAKEAWAY("fast_food_takeaway", "Fast food & takeaway"),
    BARS_DRINKS("bars_drinks", "Bars & drinks"),
    BAKERIES_SWEETS("bakeries_sweets", "Bakeries & sweets"),
    GROCERIES_SUPERMARKETS("groceries_supermarkets", "Groceries & supermarkets"),
    CLOTHING_FASHION("clothing_fashion", "Clothing & fashion"),
    ELECTRONICS("electronics", "Electronics"),
    HOME_FURNITURE("home_furniture", "Home & furniture"),
    SHOPPING_CENTRES("shopping_centres", "Shopping centres"),
    OTHER_SHOPS("other_shops", "Other shops"),
    PHARMACY("pharmacy", "Pharmacy"),
    DOCTOR_CLINIC("doctor_clinic", "Doctor & clinic"),
    DENTIST("dentist", "Dentist"),
    HOSPITAL("hospital", "Hospital"),
    SPA_WELLNESS("spa_wellness", "Spa & wellness"),
    GYM_FITNESS("gym_fitness", "Gym & fitness"),
    SWIMMING("swimming", "Swimming"),
    SPORTS_FACILITIES("sports_facilities", "Sports facilities"),
    GOLF("golf", "Golf"),
    PARKING("parking", "Parking"),
    PUBLIC_TRANSPORT("public_transport", "Public transport"),
    TRAIN_STATIONS("train_stations", "Train stations"),
    BUS_STATIONS_STOPS("bus_stations_stops", "Bus stations & stops"),
    FUEL_STATIONS("fuel_stations", "Fuel stations"),
    EV_CHARGING("ev_charging", "EV charging"),
    AIRPORTS("airports", "Airports"),
    SCHOOLS("schools", "Schools"),
    PRESCHOOL("preschool", "Preschool"),
    UNIVERSITIES("universities", "Universities"),
    LIBRARIES("libraries", "Libraries"),
    PARKS("parks", "Parks"),
    OUTDOOR_ACTIVITIES("outdoor_activities", "Outdoor activities"),
    MUSEUMS_GALLERIES("museums_galleries", "Museums & galleries"),
    CINEMA("cinema", "Cinema"),
    ENTERTAINMENT("entertainment", "Entertainment"),
    ATTRACTIONS("attractions", "Attractions"),
    PLAYGROUNDS("playgrounds", "Playgrounds"),
    HOTELS("hotels", "Hotels"),
    HOSTELS_GUEST_HOUSES("hostels_guest_houses", "Hostels & guest houses"),
    CAMPING("camping", "Camping"),
    HAIR_BEAUTY("hair_beauty", "Hair & beauty"),
    LAUNDRY("laundry", "Laundry"),
    BANKS("banks", "Banks"),
    ATM("atm", "ATM"),
    POST_OFFICE("post_office", "Post office"),
    SHIPPING_COURIER("shipping_courier", "Shipping & courier"),
    CAR_REPAIR_TYRES("car_repair_tyres", "Car repair & tyres"),
    CAR_WASH("car_wash", "Car wash"),
    VETERINARY("veterinary", "Veterinary"),
    PET_CARE("pet_care", "Pet care"),
    PET_STORES("pet_stores", "Pet stores")
}

private enum class ResultSort {
    NEAREST,
    HIGHEST_RATED
}

private data class GeoPoint(
    val latitude: Double,
    val longitude: Double
)

private data class LocationSuggestion(
    val id: String,
    val type: String,
    val title: String,
    val subtitle: String
)

private data class ResolvedLocation(
    val title: String,
    val address: String,
    val latitude: Double,
    val longitude: Double
)

private data class PlaceResult(
    val id: String,
    val name: String,
    val categoryLabel: String,
    val sourceCategories: List<String>,
    val latitude: Double,
    val longitude: Double,
    val address: String,
    val isOpenNow: Boolean?,
    val minutesUntilClose: Int?,
    val rating: Double?,
    val userRatingCount: Int?,
    val priceLevel: String?,
    val priceRangeText: String?,
    val nationalPhoneNumber: String?,
    val websiteUri: String?,
    val googleMapsUri: String?,
    val providerAttributions: List<String>,
    val businessStatus: String?,
    val sourceVerified: Boolean,
    val walkSeconds: Int,
    val walkMinutes: Int,
    val walkDistanceMeters: Int
)

private data class SearchQuotaStatus(
    val accessMode: String,
    val accountStatus: String,
    val trialIncluded: Int,
    val trialUsed: Int,
    val trialRemaining: Int,
    val monthlyIncluded: Int,
    val monthlyUsed: Int,
    val monthlyRemaining: Int,
    val extraRemaining: Int,
    val totalAvailable: Int,
    val billingPeriodEnd: String?
)

private data class SearchResponse(
    val places: List<PlaceResult>,
    val exhaustedCandidates: Boolean,
    val quotaStatus: SearchQuotaStatus?
)

private sealed interface SearchState {
    data object Idle : SearchState
    data object Loading : SearchState
    data class Success(val response: SearchResponse) : SearchState
    data class Error(val message: String) : SearchState
}

class MainActivity : ComponentActivity() {
    private lateinit var billingManager: NearTimeBillingManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        billingManager = NearTimeBillingManager(this)

        setContent {
            var darkMode by remember { mutableStateOf(false) }
            val billingUiState by billingManager.state.collectAsState()

            MaterialTheme(colorScheme = if (darkMode) darkColorScheme() else lightColorScheme()) {
                NearTimeScreen(
                    darkMode = darkMode,
                    onDarkModeChange = { darkMode = it },
                    billingManager = billingManager,
                    billingUiState = billingUiState
                )
            }
        }
    }

    override fun onDestroy() {
        billingManager.close()
        super.onDestroy()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NearTimeScreen(
    darkMode: Boolean,
    onDarkModeChange: (Boolean) -> Unit,
    billingManager: NearTimeBillingManager,
    billingUiState: BillingUiState
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val installHash = remember { getOrCreateInstallHash(context) }

    var quotaStatus by remember { mutableStateOf<SearchQuotaStatus?>(null) }
    var quotaError by remember { mutableStateOf<String?>(null) }

    var selectedCategory by remember { mutableStateOf(SearchCategory.BARS_DRINKS) }
    var maxWalkMinutes by remember { mutableFloatStateOf(15f) }
    var openNowOnly by remember { mutableStateOf(true) }
    var minOpenMinutes by remember { mutableFloatStateOf(0f) }
    var minRating by remember { mutableFloatStateOf(0f) }
    var moreFiltersExpanded by remember { mutableStateOf(false) }
    var resultSort by remember { mutableStateOf(ResultSort.NEAREST) }

    var useCurrentLocation by remember { mutableStateOf(true) }
    var currentLocation by remember { mutableStateOf<GeoPoint?>(null) }
    var currentLocationLabel by remember { mutableStateOf<String?>(null) }
    var currentLocationLookupFinished by remember { mutableStateOf(false) }
    var infoDialogMessage by remember { mutableStateOf<String?>(null) }
    var customLocation by remember { mutableStateOf<ResolvedLocation?>(null) }
    var customLocationText by remember { mutableStateOf("") }
    var locationSuggestions by remember { mutableStateOf<List<LocationSuggestion>>(emptyList()) }
    var locationSearchBusy by remember { mutableStateOf(false) }
    var locationError by remember { mutableStateOf<String?>(null) }

    var searchState by remember { mutableStateOf<SearchState>(SearchState.Idle) }
    var selectedPlace by remember { mutableStateOf<PlaceResult?>(null) }
    var lastSearchOrigin by remember { mutableStateOf<GeoPoint?>(null) }

    var permissionRevision by remember { mutableIntStateOf(0) }
    val hasLocationPermission = remember(permissionRevision) {
        isLocationPermissionGranted(context)
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        permissionRevision += 1
    }

    val resultListState = rememberLazyListState()

    LaunchedEffect(
        installHash,
        billingUiState.entitlementSession,
        billingUiState.revision
    ) {
        quotaError = null
        try {
            quotaStatus = fetchQuotaStatus(
                installHash = installHash,
                entitlementSession = billingUiState.entitlementSession
            )
        } catch (e: Exception) {
            quotaStatus = null
            quotaError = e.message ?: "Could not load search allowance."
        }
    }

    LaunchedEffect(hasLocationPermission, permissionRevision) {
        currentLocationLookupFinished = false
        if (hasLocationPermission) {
            currentLocation = resolveCurrentLocation(context)
        } else {
            currentLocation = null
            currentLocationLabel = null
        }
        currentLocationLookupFinished = true
    }

    LaunchedEffect(currentLocation?.latitude, currentLocation?.longitude) {
        val gps = currentLocation
        currentLocationLabel = if (gps == null) {
            null
        } else {
            reverseGeocodeLocationLabel(context, gps)
        }
    }

    fun refreshGps() {
        scope.launch {
            locationError = null
            currentLocationLookupFinished = false
            currentLocation = try {
                resolveCurrentLocation(context)
            } catch (e: Exception) {
                Log.w(LOG_TAG, "LOCATION_LOOKUP_FAILED build=$APP_BUILD_ID", e)
                null
            }
            currentLocationLookupFinished = true
        }
    }

    fun selectCurrentLocation() {
        useCurrentLocation = true
        customLocation = null
        customLocationText = ""
        locationSuggestions = emptyList()
        locationError = null
        refreshGps()
    }

    fun runPlaceSearch() {
        scope.launch {
            if (useCurrentLocation && currentLocation == null) {
                infoDialogMessage =
                    "Please select a starting position before searching. " +
                    "Try Current location again or choose Other place."
                return@launch
            }

            if (!useCurrentLocation && customLocation == null) {
                infoDialogMessage =
                    "Please select a starting position before searching."
                return@launch
            }

            val allowance = quotaStatus
            if (allowance == null) {
                searchState = SearchState.Error("Search allowance is still loading.")
                return@launch
            }
            if (allowance.totalAvailable <= 0) {
                searchState = SearchState.Error(
                    if (allowance.accessMode == "trial") {
                        "Your 5 free searches are used. Subscribe to continue."
                    } else {
                        "No searches remaining. Buy 20 extra searches to continue."
                    }
                )
                return@launch
            }

            searchState = SearchState.Loading
            selectedPlace = null
            resultSort = ResultSort.NEAREST

            try {
                val origin = if (useCurrentLocation) {
                    resolveCurrentLocation(context)
                        ?: currentLocation
                        ?: run {
                            infoDialogMessage =
                                "Please select a starting position before searching. " +
                                "Try Current location again or choose Other place."
                            searchState = SearchState.Idle
                            return@launch
                        }
                } else {
                    customLocation?.let { GeoPoint(it.latitude, it.longitude) }
                        ?: run {
                            infoDialogMessage =
                                "Please select a starting position before searching."
                            searchState = SearchState.Idle
                            return@launch
                        }
                }

                if (useCurrentLocation) {
                    currentLocation = origin
                }
                lastSearchOrigin = origin

                val response = searchBackend(
                    latitude = origin.latitude,
                    longitude = origin.longitude,
                    category = selectedCategory.wireValue,
                    maxWalkMinutes = maxWalkMinutes.roundToInt(),
                    openNowOnly = openNowOnly,
                    minOpenMinutes = if (openNowOnly) minOpenMinutes.roundToInt() else 0,
                    minRating = minRating.toDouble(),
                    installHash = installHash,
                    entitlementSession = billingUiState.entitlementSession
                )

                response.quotaStatus?.let {
                    quotaStatus = it
                    quotaError = null
                }

                val validated = response.places
                    .asSequence()
                    .filter { it.categoryLabel.isNotBlank() }
                    .filter { it.sourceCategories.isNotEmpty() }
                    .filter { it.sourceVerified }
                    .filter { it.walkMinutes <= maxWalkMinutes.roundToInt() }
                    // Backend owns opening-hours semantics. When Open now is enabled,
                    // confirmed-closed places are already excluded there; unknown hours
                    // must not be silently treated as closed by the Android client.
                    .filter { !openNowOnly || it.isOpenNow == true }
                    .filter {
                        minRating <= 0f ||
                            (it.rating != null && it.rating >= minRating.toDouble())
                    }
                    .sortedWith(
                        compareBy<PlaceResult> { it.walkDistanceMeters }
                            .thenBy { it.walkSeconds }
                    )
                    .take(RESULT_LIMIT)
                    .toList()

                searchState = SearchState.Success(
                    response.copy(
                        places = validated,
                        exhaustedCandidates = validated.size < RESULT_LIMIT
                    )
                )
            } catch (e: Exception) {
                Log.e(LOG_TAG, "SEARCH_FAILED build=$APP_BUILD_ID", e)
                runCatching {
                    fetchQuotaStatus(
                        installHash = installHash,
                        entitlementSession = billingUiState.entitlementSession
                    )
                }.getOrNull()?.let { quotaStatus = it }

                searchState = SearchState.Error(
                    "Search could not be completed. Please try again."
                )
            }
        }
    }

    infoDialogMessage?.let { message ->
        Dialog(
            onDismissRequest = { infoDialogMessage = null }
        ) {
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = "Starting position required",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodyLarge
                    )
                    Spacer(Modifier.height(18.dp))
                    Button(
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { infoDialogMessage = null }
                    ) {
                        Text("OK")
                    }
                }
            }
        }
    }

    val successOverlay = searchState as? SearchState.Success

    if (successOverlay != null) {
        val displayedPlaces = remember(
            successOverlay.response.places,
            resultSort
        ) {
            when (resultSort) {
                ResultSort.NEAREST ->
                    successOverlay.response.places.sortedWith(
                        compareBy<PlaceResult> { it.walkDistanceMeters }
                            .thenBy { it.walkSeconds }
                            .thenBy { it.name.lowercase(Locale.ROOT) }
                    )

                ResultSort.HIGHEST_RATED ->
                    successOverlay.response.places.sortedWith(
                        compareByDescending<PlaceResult> { it.rating != null }
                            .thenByDescending { it.rating ?: -1.0 }
                            .thenByDescending { it.userRatingCount ?: -1 }
                            .thenBy { it.walkDistanceMeters }
                            .thenBy { it.walkSeconds }
                    )
            }
        }

        Scaffold { innerPadding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .padding(horizontal = 16.dp)
            ) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        searchState = SearchState.Idle
                        selectedPlace = null
                    }
                ) {
                    Text("Back to search")
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "${displayedPlaces.size} places match all selected criteria",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(
                        selected = resultSort == ResultSort.NEAREST,
                        onClick = {
                            resultSort = ResultSort.NEAREST
                            scope.launch { resultListState.scrollToItem(0) }
                        },
                        label = { Text("Nearest") }
                    )
                    FilterChip(
                        selected = resultSort == ResultSort.HIGHEST_RATED,
                        onClick = {
                            resultSort = ResultSort.HIGHEST_RATED
                            scope.launch { resultListState.scrollToItem(0) }
                        },
                        label = { Text("Highest rated in results") }
                    )
                }
                if (successOverlay.response.exhaustedCandidates) {
                    Text(
                        "Fewer than 10 places could be established within the walking-time limit.",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Text(
                    text = "Place data and walking routes provided by Google Maps",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.height(8.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                ) {
                    LazyColumn(
                        state = resultListState,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(end = 18.dp),
                        contentPadding = PaddingValues(bottom = 28.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        itemsIndexed(
                            items = displayedPlaces,
                            key = { _, place -> place.id }
                        ) { index, place ->
                            PlaceCard(
                                rank = index + 1,
                                place = place,
                                searchOrigin = lastSearchOrigin,
                                selected = selectedPlace?.id == place.id,
                                onSelect = { selectedPlace = place }
                            )
                        }
                    }
                    LazyListScrollbar(
                        state = resultListState,
                        itemCount = displayedPlaces.size,
                        modifier = Modifier
                            .align(Alignment.CenterEnd)
                            .fillMaxHeight()
                            .width(18.dp)
                    )
                }
                Spacer(Modifier.height(8.dp))
            }
        }
        return
    }

    val searchButtonEnabled =
        searchState !is SearchState.Loading &&
            (quotaStatus?.totalAvailable ?: 0) > 0 &&
            if (useCurrentLocation) {
                hasLocationPermission
            } else {
                customLocation != null
            }

    val searchButtonText = when {
        quotaStatus == null -> "Loading search allowance…"
        quotaStatus?.totalAvailable == 0 -> "No searches remaining"
        else -> "Find up to 10 places"
    }

    Scaffold(
        bottomBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Button(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(58.dp),
                    enabled = searchButtonEnabled,
                    onClick = { runPlaceSearch() }
                ) {
                    if (searchState is SearchState.Loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.height(20.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text(searchButtonText)
                    }
                }
            }
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "NearTime",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text("Find places by real walking time.")
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (darkMode) "☾" else "☀")
                        Switch(
                            checked = darkMode,
                            onCheckedChange = onDarkModeChange
                        )
                    }
                }
            }

            item {
                SearchUsageCard(
                    quota = quotaStatus,
                    quotaError = quotaError,
                    billing = billingUiState,
                    onSubscribe = { billingManager.launchSubscription() },
                    onBuyExtra = { billingManager.launchExtraSearchPack() },
                    onRestore = { billingManager.restorePurchases(showMessage = true) }
                )
            }
            item {
                Text(
                    "START FROM",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(
                        selected = useCurrentLocation,
                        onClick = { selectCurrentLocation() },
                        label = { Text("Current location") }
                    )
                    FilterChip(
                        selected = !useCurrentLocation,
                        onClick = {
                            useCurrentLocation = false
                            locationSuggestions = emptyList()
                            locationError = null
                        },
                        label = { Text("Other place") }
                    )
                }

                if (useCurrentLocation) {
                    if (hasLocationPermission) {
                        Text(
                            text = when {
                                !currentLocationLookupFinished ->
                                    "Locating your current position…"
                                currentLocation == null ->
                                    "Current location is not available."
                                !currentLocationLabel.isNullOrBlank() ->
                                    "● Using your location · $currentLocationLabel"
                                else ->
                                    "● Using your current GPS location"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (
                                currentLocationLookupFinished &&
                                currentLocation == null
                            ) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                            maxLines = 1
                        )

                        if (
                            currentLocationLookupFinished &&
                            currentLocation == null
                        ) {
                            Spacer(Modifier.height(6.dp))
                            OutlinedButton(
                                onClick = { refreshGps() }
                            ) {
                                Text("Try current location again")
                            }
                        }
                    } else {
                        Text(
                            text = "NearTime uses your location only when Current location is selected. " +
                                "It is sent securely to NearTime's search service and Google Maps Platform " +
                                "to find nearby places and walking routes.",
                            style = MaterialTheme.typography.bodySmall
                        )
                        Spacer(Modifier.height(6.dp))
                        OutlinedButton(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                permissionLauncher.launch(
                                    arrayOf(
                                        Manifest.permission.ACCESS_FINE_LOCATION,
                                        Manifest.permission.ACCESS_COARSE_LOCATION
                                    )
                                )
                            }
                        ) { Text("Allow GPS location") }
                    }
                } else {
                    Spacer(Modifier.height(6.dp))
                    OutlinedTextField(
                        value = customLocationText,
                        onValueChange = {
                            customLocationText = it
                            customLocation = null
                            locationSuggestions = emptyList()
                            locationError = null
                        },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("Place or address") },
                        placeholder = { Text("e.g. hotel name or address") }
                    )

                    OutlinedButton(
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !locationSearchBusy && customLocationText.trim().length >= 3,
                        onClick = {
                            scope.launch {
                                locationSearchBusy = true
                                locationError = null
                                try {
                                    val bias = currentLocation ?: GeoPoint(DEFAULT_LATITUDE, DEFAULT_LONGITUDE)
                                    val quotaEventId = UUID.randomUUID()
                                    locationSuggestions = suggestLocationsBackend(
                                        customLocationText.trim(), bias.latitude, bias.longitude
                                    )
                                    recordClientQuotaUsage(
                                        service = "tomtom_places_suggest",
                                        eventId = quotaEventId
                                    )
                                    if (locationSuggestions.isEmpty()) {
                                        locationError = "No matching start location found."
                                    }
                                } catch (e: Exception) {
                                    locationError = e.message ?: "Location search failed."
                                } finally {
                                    locationSearchBusy = false
                                }
                            }
                        }
                    ) {
                        if (locationSearchBusy) {
                            CircularProgressIndicator(
                                modifier = Modifier.height(18.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text("Find place or address")
                        }
                    }

                    locationSuggestions.forEach { suggestion ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    scope.launch {
                                        locationSearchBusy = true
                                        locationError = null
                                        try {
                                            val quotaEventId = UUID.randomUUID()
                                            val resolved = resolveLocationBackend(suggestion)
                                            recordClientQuotaUsage(
                                                service = "tomtom_places_details",
                                                eventId = quotaEventId
                                            )
                                            customLocation = resolved
                                            customLocationText = resolved.title
                                            locationSuggestions = emptyList()
                                        } catch (e: Exception) {
                                            locationError = e.message ?: "Could not resolve location."
                                        } finally {
                                            locationSearchBusy = false
                                        }
                                    }
                                }
                        ) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Text(suggestion.title, fontWeight = FontWeight.SemiBold)
                                if (suggestion.subtitle.isNotBlank()) {
                                    Text(
                                        suggestion.subtitle,
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                }
                            }
                        }
                    }

                    customLocation?.let {
                        Text(
                            text = "Using: " + it.title,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }

                    locationError?.let {
                        Text(
                            text = it,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }

            item {
                PlaceTypeSelector(
                    selectedCategory = selectedCategory,
                    onSelected = { selectedCategory = it }
                )
            }

            item {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        "MAXIMUM WALKING TIME",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Walking radius", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "${maxWalkMinutes.roundToInt()} min",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Slider(
                        value = maxWalkMinutes,
                        onValueChange = { maxWalkMinutes = it },
                        valueRange = 5f..30f,
                        steps = 24
                    )
                }
            }

            item {
                HorizontalDivider()
            }

            item {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "OPEN NOW",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Exclude places confirmed closed",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        Switch(
                            checked = openNowOnly,
                            onCheckedChange = {
                                openNowOnly = it
                                if (!it) minOpenMinutes = 0f
                            }
                        )
                    }
                }
            }

            item {
                val activeMoreFilters =
                    (if (minRating > 0f) 1 else 0) +
                        (if (openNowOnly && minOpenMinutes > 0f) 1 else 0)

                OutlinedButton(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = { moreFiltersExpanded = !moreFiltersExpanded }
                ) {
                    Text(
                        when {
                            activeMoreFilters > 0 && moreFiltersExpanded ->
                                "Hide more filters · $activeMoreFilters active"
                            activeMoreFilters > 0 ->
                                "More filters · $activeMoreFilters active"
                            moreFiltersExpanded ->
                                "Hide more filters"
                            else ->
                                "More filters"
                        }
                    )
                }
            }

            if (moreFiltersExpanded) {
                if (openNowOnly) {
                    item {
                        Column(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                "MINIMUM TIME UNTIL CLOSING",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(Modifier.height(6.dp))
                            Text(
                                if (minOpenMinutes.roundToInt() == 0) {
                                    "No minimum"
                                } else if (minOpenMinutes.roundToInt() < 60) {
                                    "${minOpenMinutes.roundToInt()} min"
                                } else {
                                    val hours = minOpenMinutes.roundToInt() / 60
                                    val minutes = minOpenMinutes.roundToInt() % 60
                                    if (minutes == 0) "${hours} h" else "${hours} h ${minutes} min"
                                },
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            Slider(
                                value = minOpenMinutes,
                                onValueChange = { minOpenMinutes = it },
                                valueRange = 0f..180f,
                                steps = 5
                            )
                        }
                    }
                }

                item {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            "MINIMUM RATING",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            if (minRating <= 0f) {
                                "Any"
                            } else {
                                String.format(Locale.US, "%.1f+ ★", minRating)
                            },
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Slider(
                            value = minRating,
                            onValueChange = {
                                minRating = (it * 2f).roundToInt() / 2f
                            },
                            valueRange = 0f..5f,
                            steps = 9
                        )
                    }
                }
            }

            item {
                Text(
                    text = "All selected criteria must be met. Using filters may result in fewer than 10 matches.",
                    style = MaterialTheme.typography.bodySmall
                )
            }


            when (val state = searchState) {
                SearchState.Idle -> Unit

                SearchState.Loading -> {
                    item {
                        Text(
                            "Checking current places and real walking routes…"
                        )
                    }
                }

                is SearchState.Error -> {
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = state.message,
                                modifier = Modifier.padding(14.dp),
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }

                is SearchState.Success -> Unit
            }

            item {
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Legal & privacy",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(18.dp)
                ) {
                    Text(
                        text = "Privacy policy",
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable {
                            launchExternalUri(context, PRIVACY_POLICY_URL.toUri())
                        }
                    )
                    Text(
                        text = "Terms of use",
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable {
                            launchExternalUri(context, TERMS_OF_USE_URL.toUri())
                        }
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "No account is required. Location access is optional; you can use another place or address instead.",
                    style = MaterialTheme.typography.bodySmall
                )
            }

            item {
                Spacer(Modifier.height(24.dp))
            }
        }

    }
}



@Composable
private fun PlaceTypeSelector(
    selectedCategory: SearchCategory,
    onSelected: (SearchCategory) -> Unit
) {
    var dialogOpen by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = "PLACE TYPE",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(6.dp))
        OutlinedButton(
            modifier = Modifier
                .fillMaxWidth()
                .height(58.dp),
            onClick = { dialogOpen = true }
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = selectedCategory.displayName,
                    style = MaterialTheme.typography.titleMedium
                )
                Text("›")
            }
        }
    }

    if (dialogOpen) {
        PlaceTypeDialog(
            selectedCategory = selectedCategory,
            onDismiss = { dialogOpen = false },
            onSelected = { category ->
                onSelected(category)
                dialogOpen = false
            }
        )
    }
}

@Composable
private fun PlaceTypeDialog(
    selectedCategory: SearchCategory,
    onDismiss: () -> Unit,
    onSelected: (SearchCategory) -> Unit
) {
    var filterText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    val sortedCategories = remember {
        SearchCategory.entries.sortedBy {
            it.displayName.lowercase(Locale.ROOT)
        }
    }

    val filteredCategories = remember(filterText, sortedCategories) {
        val query = filterText.trim().lowercase(Locale.ROOT)
        if (query.isBlank()) {
            sortedCategories
        } else {
            sortedCategories
                .asSequence()
                .filter {
                    it.displayName
                        .lowercase(Locale.ROOT)
                        .contains(query)
                }
                .sortedWith(
                    compareBy<SearchCategory> {
                        !it.displayName
                            .lowercase(Locale.ROOT)
                            .startsWith(query)
                    }.thenBy {
                        it.displayName.lowercase(Locale.ROOT)
                    }
                )
                .toList()
        }
    }

    LaunchedEffect(filterText) {
        if (listState.firstVisibleItemIndex > 0) {
            listState.scrollToItem(0)
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.94f)
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Choose place type",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Browse the list or search by name.",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    OutlinedButton(onClick = onDismiss) {
                        Text("Close")
                    }
                }

                Spacer(Modifier.height(12.dp))

                OutlinedTextField(
                    value = filterText,
                    onValueChange = { filterText = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Search place types") },
                    placeholder = { Text("e.g. restaurant, pharmacy, park") }
                )

                Spacer(Modifier.height(10.dp))

                if (filteredCategories.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No matching place type",
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                    ) {
                        LazyColumn(
                            state = listState,
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(end = 16.dp),
                            contentPadding = PaddingValues(vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            items(
                                items = filteredCategories,
                                key = { it.wireValue }
                            ) { category ->
                                val isSelected = category == selectedCategory
                                Card(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { onSelected(category) }
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 14.dp, vertical = 14.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text(
                                            text = category.displayName,
                                            style = MaterialTheme.typography.bodyLarge,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                        )
                                        if (isSelected) {
                                            Text(
                                                text = "Selected",
                                                style = MaterialTheme.typography.labelMedium,
                                                color = MaterialTheme.colorScheme.primary
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        LazyListScrollbar(
                            state = listState,
                            itemCount = filteredCategories.size,
                            modifier = Modifier
                                .align(Alignment.CenterEnd)
                                .fillMaxHeight()
                                .width(12.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchUsageCard(
    quota: SearchQuotaStatus?,
    quotaError: String?,
    billing: BillingUiState,
    onSubscribe: () -> Unit,
    onBuyExtra: () -> Unit,
    onRestore: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = "SEARCHES",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold
            )

            if (quota == null) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(6.dp))
                Text(
                    text = quotaError ?: "Loading your search allowance…",
                    style = MaterialTheme.typography.bodySmall
                )
                return@Column
            }

            if (quota.accessMode == "trial") {
                val isTestingAllowance = quota.trialIncluded > 100

                Text(
                    text = if (isTestingAllowance) {
                        "Free searches available"
                    } else {
                        quota.trialRemaining.toString() + " free searches remaining"
                    },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )

                if (!isTestingAllowance) {
                    Text(
                        text = quota.trialUsed.toString() + " of " + quota.trialIncluded.toString() + " used",
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                if (!isTestingAllowance && quota.trialRemaining <= 0) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "30 searches every month · " + billing.monthlyPrice + "/month · auto-renews until cancelled in Google Play.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Button(
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !billing.busy,
                        onClick = onSubscribe
                    ) {
                        Text("Subscribe · " + billing.monthlyPrice + "/month")
                    }
                }
            } else {
                Text(
                    text = quota.totalAvailable.toString() + " searches available",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Monthly · " + quota.monthlyUsed.toString() + " of " +
                        quota.monthlyIncluded.toString() + " used · " +
                        quota.monthlyRemaining.toString() + " remaining",
                    style = MaterialTheme.typography.bodyMedium
                )
                quota.billingPeriodEnd?.take(10)?.let { date ->
                    Text(
                        text = "Monthly allowance resets " + date,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Text(
                    text = "Extra searches · " + quota.extraRemaining.toString() + " remaining",
                    style = MaterialTheme.typography.bodyMedium
                )

                if (quota.monthlyRemaining <= 0) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "Extra packs require an active subscription and remain available until used.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Button(
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !billing.busy,
                        onClick = onBuyExtra
                    ) {
                        Text("Get 20 extra searches · " + billing.extraPrice)
                    }
                }
            }

            billing.message
                ?.takeIf { message ->
                    !message.contains("unavailable in this build/device", ignoreCase = true) &&
                        !message.contains("not published to this build yet", ignoreCase = true) &&
                        !message.contains("products are not available yet", ignoreCase = true)
                }
                ?.let { message ->
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (billing.isError) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.primary
                        }
                    )
                }

            if (billing.ready) {
                Spacer(Modifier.height(6.dp))
                OutlinedButton(
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !billing.busy,
                    onClick = onRestore
                ) {
                    Text("Restore Google Play purchases")
                }
            }
        }
    }
}
@Composable
private fun LazyListScrollbar(
    state: LazyListState,
    itemCount: Int,
    modifier: Modifier = Modifier
) {
    if (itemCount <= 1) return

    val scope = rememberCoroutineScope()
    val firstVisibleIndex by remember(state) {
        derivedStateOf { state.firstVisibleItemIndex }
    }
    val firstVisibleOffset by remember(state) {
        derivedStateOf { state.firstVisibleItemScrollOffset }
    }
    val visibleCount by remember(state) {
        derivedStateOf { state.layoutInfo.visibleItemsInfo.size.coerceAtLeast(1) }
    }
    val canScrollForward by remember(state) {
        derivedStateOf { state.canScrollForward }
    }

    val thumbFraction = (visibleCount.toFloat() / itemCount.toFloat())
        .coerceIn(0.12f, 1f)

    val maxFirst = (itemCount - visibleCount).coerceAtLeast(1)
    val firstSize = state.layoutInfo.visibleItemsInfo
        .firstOrNull()
        ?.size
        ?.coerceAtLeast(1)
        ?: 1
    val itemFraction = (firstVisibleOffset.toFloat() / firstSize.toFloat())
        .coerceIn(0f, 1f)

    val rawPosition = (
        (firstVisibleIndex.toFloat() + itemFraction) /
            maxFirst.toFloat()
        ).coerceIn(0f, 1f)

    // Never show the thumb at the physical bottom while the list can still
    // scroll further. This was the old failure mode with variable-height cards.
    val positionFraction = when {
        !canScrollForward -> 1f
        firstVisibleIndex == 0 && firstVisibleOffset == 0 -> 0f
        else -> rawPosition.coerceAtMost(0.97f)
    }

    fun scrollToFraction(fraction: Float) {
        scope.launch {
            val bounded = fraction.coerceIn(0f, 1f)
            when {
                bounded <= 0.01f -> {
                    state.scrollToItem(0)
                }
                bounded >= 0.99f -> {
                    // Force the actual list end, not merely the last estimated
                    // first-visible index. scrollBy clamps at the real max.
                    state.scrollToItem(itemCount - 1)
                    state.scrollBy(100_000f)
                }
                else -> {
                    val target = (
                        bounded * (itemCount - 1).toFloat()
                        ).roundToInt().coerceIn(0, itemCount - 1)
                    state.scrollToItem(target)
                }
            }
        }
    }

    BoxWithConstraints(
        modifier = modifier
            .background(
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)
            )
            .pointerInput(itemCount, visibleCount) {
                detectVerticalDragGestures(
                    onDragStart = { offset ->
                        val track = size.height.toFloat()
                        val thumb = track * thumbFraction
                        val usable = (track - thumb).coerceAtLeast(1f)
                        val fraction = ((offset.y - thumb / 2f) / usable)
                            .coerceIn(0f, 1f)
                        scrollToFraction(fraction)
                    },
                    onVerticalDrag = { change, _ ->
                        change.consume()
                        val track = size.height.toFloat()
                        val thumb = track * thumbFraction
                        val usable = (track - thumb).coerceAtLeast(1f)
                        val fraction = ((change.position.y - thumb / 2f) / usable)
                            .coerceIn(0f, 1f)
                        scrollToFraction(fraction)
                    }
                )
            }
    ) {
        val thumbHeight = maxHeight * thumbFraction
        val thumbOffset = (maxHeight - thumbHeight) * positionFraction

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(thumbHeight)
                .offset(y = thumbOffset)
                .background(
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.75f),
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)
                )
        )
    }
}

@Composable
private fun PlaceCard(
    rank: Int,
    place: PlaceResult,
    searchOrigin: GeoPoint?,
    selected: Boolean,
    onSelect: () -> Unit
) {
    val context = LocalContext.current

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
    ) {
        Column(
            modifier = Modifier.padding(14.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(0.76f)
                ) {
                    Text(
                        text = "$rank. ${place.name}",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleMedium
                    )

                    Text(
                        text = place.categoryLabel,
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelLarge
                    )
                }

                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "${place.walkMinutes} min",
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "${place.walkDistanceMeters} m",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            val ratingLine = buildString {
                place.rating?.let {
                    append(String.format(Locale.US, "%.1f ★", it))
                }
                place.userRatingCount?.let {
                    if (isNotEmpty()) append(" · ")
                    append("$it reviews")
                }
                val price = place.priceRangeText ?: place.priceLevel
                if (!price.isNullOrBlank()) {
                    if (isNotEmpty()) append(" · ")
                    append(price)
                }
            }

            if (ratingLine.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = ratingLine,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold
                )
            }

            if (place.address.isNotBlank()) {
                Spacer(Modifier.height(3.dp))
                Text(
                    text = place.address,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            val openText = when (place.isOpenNow) {
                true -> {
                    place.minutesUntilClose?.let {
                        "Open now · closes in ${formatMinutesCompact(it)}"
                    } ?: "Open now"
                }
                false -> "Closed now"
                null -> "Opening hours unavailable"
            }

            Text(
                text = openText,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (place.isOpenNow == true) FontWeight.SemiBold else FontWeight.Normal
            )

            if (place.businessStatus == "CLOSED_TEMPORARILY") {
                Text(
                    text = "Temporarily closed",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            if (!place.nationalPhoneNumber.isNullOrBlank()) {
                Text(
                    text = place.nationalPhoneNumber,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            if (!place.websiteUri.isNullOrBlank()) {
                Text(
                    text = "Website",
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.clickable {
                        launchExternalUri(context, place.websiteUri.toUri())
                    }
                )
            }

            if (place.providerAttributions.isNotEmpty()) {
                Text(
                    text = "Additional data: " + place.providerAttributions.joinToString(", "),
                    style = MaterialTheme.typography.labelSmall
                )
            }

            if (selected) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Selected",
                    style = MaterialTheme.typography.labelMedium
                )
            }

            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        openPlaceInGoogleMaps(context, place)
                    }
                ) {
                    Text("Open in Maps")
                }

                Button(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        openWalkingDirections(context, place, searchOrigin)
                    }
                ) {
                    Text("Show route")
                }
            }
        }
    }
}

private fun formatMinutesCompact(minutes: Int): String {
    val safe = minutes.coerceAtLeast(0)
    val hours = safe / 60
    val mins = safe % 60
    return when {
        hours <= 0 -> "$mins min"
        mins == 0 -> "$hours h"
        else -> "$hours h $mins min"
    }
}

private suspend fun searchBackend(
    latitude: Double,
    longitude: Double,
    category: String,
    maxWalkMinutes: Int,
    openNowOnly: Boolean,
    minOpenMinutes: Int,
    minRating: Double,
    installHash: String,
    entitlementSession: String?
): SearchResponse = withContext(Dispatchers.IO) {
    val json = postJson(
        BACKEND_BASE_URL,
        JSONObject()
            .put("action", "search")
            .put("requestId", UUID.randomUUID().toString())
            .put("latitude", latitude)
            .put("longitude", longitude)
            .put("category", category)
            .put("maxWalkMinutes", maxWalkMinutes)
            .put("openNowOnly", openNowOnly)
            .put("minOpenMinutes", minOpenMinutes)
            .put("minRating", minRating)
            .put("installHash", installHash)
            .apply {
                if (!entitlementSession.isNullOrBlank()) {
                    put("entitlementSession", entitlementSession)
                }
            }
    )

    val resultStatus = json.optString("resultStatus")
    if (resultStatus == "DEGRADED") {
        throw IllegalStateException(
            json.optString("reason")
                .ifBlank {
                    "The search could not be completed inside the provider cost guard."
                }
        )
    }

    val placesJson = json.optJSONArray("places") ?: JSONArray()

    val places = buildList {
        for (index in 0 until placesJson.length()) {
            parsePlace(
                placesJson.optJSONObject(index)
            )?.let(::add)
        }
    }

    val summary = json.optJSONObject("summary")
    val exhausted = summary?.optBoolean(
        "exhaustedCandidates",
        places.size < RESULT_LIMIT
    ) ?: (places.size < RESULT_LIMIT)

    SearchResponse(
        places = places,
        exhaustedCandidates = exhausted,
        quotaStatus = parseQuotaStatus(json.optJSONObject("quota"))
    )
}

private suspend fun fetchQuotaStatus(
    installHash: String,
    entitlementSession: String?
): SearchQuotaStatus = withContext(Dispatchers.IO) {
    val payload = JSONObject()
        .put("action", "usage")
        .put("installHash", installHash)
        .apply {
            if (!entitlementSession.isNullOrBlank()) {
                put("entitlementSession", entitlementSession)
            }
        }

    val json = postJson(BACKEND_BASE_URL, payload)
    parseQuotaStatus(json.optJSONObject("quota"))
        ?: throw IllegalStateException("Search allowance response is invalid.")
}

private fun parseQuotaStatus(obj: JSONObject?): SearchQuotaStatus? {
    if (obj == null) return null

    return SearchQuotaStatus(
        accessMode = obj.optString("access_mode", "trial"),
        accountStatus = obj.optString("account_status", "active"),
        trialIncluded = obj.optInt("trial_included", 0),
        trialUsed = obj.optInt("trial_used", 0),
        trialRemaining = obj.optInt("trial_remaining", 0),
        monthlyIncluded = obj.optInt("monthly_included", 0),
        monthlyUsed = obj.optInt("monthly_used", 0),
        monthlyRemaining = obj.optInt("monthly_remaining", 0),
        extraRemaining = obj.optInt("extra_remaining", 0),
        totalAvailable = obj.optInt("total_available", 0),
        billingPeriodEnd = obj.optNullableString("billing_period_end")
    )
}

private suspend fun suggestLocationsBackend(
    query: String,
    latitude: Double,
    longitude: Double
): List<LocationSuggestion> = withContext(Dispatchers.IO) {
    val json = postJson(
        BACKEND_BASE_URL,
        JSONObject()
            .put("action", "suggest")
            .put("query", query)
            .put("latitude", latitude)
            .put("longitude", longitude)
    )

    val array = json.optJSONArray("suggestions") ?: JSONArray()

    buildList {
        for (index in 0 until array.length()) {
            val obj = array.optJSONObject(index) ?: continue
            val id = obj.optString("id").trim()
            val type = obj.optString("type").trim()
            val title = obj.optString("title").trim()

            if (
                id.isBlank() ||
                type.isBlank() ||
                title.isBlank()
            ) {
                continue
            }

            add(
                LocationSuggestion(
                    id = id,
                    type = type,
                    title = title,
                    subtitle = obj
                        .optString("subtitle")
                        .trim()
                )
            )
        }
    }
}

private suspend fun resolveLocationBackend(
    suggestion: LocationSuggestion
): ResolvedLocation = withContext(Dispatchers.IO) {
    val json = postJson(
        BACKEND_BASE_URL,
        JSONObject()
            .put("action", "resolve")
            .put("id", suggestion.id)
            .put("type", suggestion.type)
    )

    val latitude = json.optDoubleOrNull("latitude")
        ?: throw IllegalStateException(
            "Selected location has no latitude."
        )

    val longitude = json.optDoubleOrNull("longitude")
        ?: throw IllegalStateException(
            "Selected location has no longitude."
        )

    ResolvedLocation(
        title = json
            .optString("title")
            .ifBlank { suggestion.title },
        address = json
            .optString("address")
            .trim(),
        latitude = latitude,
        longitude = longitude
    )
}

private fun parsePlace(
    obj: JSONObject?
): PlaceResult? {
    if (obj == null) {
        return null
    }

    val id = obj
        .optString("id")
        .trim()
        .takeIf { it.isNotEmpty() }
        ?: return null

    val name = obj
        .optString("name")
        .trim()
        .takeIf { it.isNotEmpty() }
        ?: return null

    val categoryLabel = obj
        .optString("categoryLabel")
        .trim()
        .takeIf { it.isNotEmpty() }
        ?: return null

    val categories = obj
        .optJSONArray("sourceCategories")
        ?.toStringList()
        .orEmpty()

    if (categories.isEmpty()) {
        return null
    }

    val latitude = obj.optDoubleOrNull("latitude") ?: return null
    val longitude = obj.optDoubleOrNull("longitude") ?: return null
    val walkSeconds = obj.optIntOrNull("walkSeconds") ?: return null
    val walkMinutes = obj.optIntOrNull("walkMinutes") ?: return null
    val walkDistanceMeters = obj.optIntOrNull("walkDistanceMeters") ?: return null

    if (walkSeconds < 0 || walkMinutes < 0 || walkDistanceMeters < 0) {
        return null
    }

    val sourceVerified = when {
        obj.has("sourceVerified") -> obj.optBoolean("sourceVerified", false)
        else -> obj.optBoolean("googleOperationalVerified", false)
    }

    if (!sourceVerified) {
        return null
    }

    val isOpenNow = when {
        !obj.has("isOpenNow") -> null
        obj.isNull("isOpenNow") -> null
        else -> obj.optBoolean("isOpenNow")
    }

    val rating = obj.optDoubleOrNull("rating")
        ?.takeIf { it in 0.0..5.0 }

    val ratingCount = obj.optIntOrNull("userRatingCount")
        ?.takeIf { it >= 0 }

    return PlaceResult(
        id = id,
        name = name,
        categoryLabel = categoryLabel,
        sourceCategories = categories,
        latitude = latitude,
        longitude = longitude,
        address = obj.optNullableString("address").orEmpty(),
        isOpenNow = isOpenNow,
        minutesUntilClose = obj.optIntOrNull("minutesUntilClose")?.takeIf { it >= 0 },
        rating = rating,
        userRatingCount = ratingCount,
        priceLevel = obj.optNullableString("priceLevel"),
        priceRangeText = obj.optNullableString("priceRangeText"),
        nationalPhoneNumber = obj.optNullableString("nationalPhoneNumber"),
        websiteUri = obj.optNullableString("websiteUri")
            ?.takeIf { it.startsWith("https://") || it.startsWith("http://") },
        googleMapsUri = obj.optNullableString("googleMapsUri")
            ?.takeIf { it.startsWith("https://") || it.startsWith("http://") },
        providerAttributions = obj.optJSONArray("providerAttributions")?.toStringList().orEmpty(),
        businessStatus = obj.optNullableString("businessStatus"),
        sourceVerified = true,
        walkSeconds = walkSeconds,
        walkMinutes = walkMinutes,
        walkDistanceMeters = walkDistanceMeters
    )
}

private val HTTP_CLIENT = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(35, TimeUnit.SECONDS)
    .writeTimeout(10, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()

private val JSON_MEDIA_TYPE =
    "application/json; charset=utf-8".toMediaType()

private fun postJson(
    url: String,
    payload: JSONObject
): JSONObject {
    val requestId = payload.optString("requestId").ifBlank { null }
    return try {
        postJsonOnce(url, payload, requestId)
    } catch (e: IOException) {
        Log.w(
            LOG_TAG,
            "POST_RETRY build=$APP_BUILD_ID requestId=${requestId ?: "none"}",
            e
        )
        Thread.sleep(250)
        postJsonOnce(url, payload, requestId)
    }
}

private fun postJsonOnce(
    url: String,
    payload: JSONObject,
    requestId: String?
): JSONObject {
    require(url.startsWith("https://")) {
        "NearTime production backend must use HTTPS."
    }
    require(!url.contains("127.0.0.1") && !url.contains("localhost")) {
        "Local backend is forbidden in this build."
    }

    val host = url.toUri().host ?: "unknown"
    Log.i(LOG_TAG, "POST_BEGIN build=$APP_BUILD_ID host=$host")

    val body = payload
        .toString()
        .toByteArray(StandardCharsets.UTF_8)
        .toRequestBody(JSON_MEDIA_TYPE)

    val requestBuilder = Request.Builder()
        .url(url)
        .post(body)
        .header("Accept", "application/json")
        .header("Connection", "close")

    requestId?.let {
        requestBuilder.header("Idempotency-Key", it)
    }

    var phase = "EXECUTE"
    try {
        Log.i(LOG_TAG, "POST_PHASE $phase")
        HTTP_CLIENT.newCall(requestBuilder.build()).execute().use { response ->
            val code = response.code
            Log.i(LOG_TAG, "POST_STATUS code=$code")

            phase = "READ_BODY"
            Log.i(LOG_TAG, "POST_PHASE $phase")
            val text = response.body?.string().orEmpty()
            Log.i(
                LOG_TAG,
                "POST_BODY_COMPLETE bytes=${
                    text.toByteArray(StandardCharsets.UTF_8).size
                }"
            )

            phase = "PARSE_JSON"
            Log.i(LOG_TAG, "POST_PHASE $phase")
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!response.isSuccessful) {
                val error = json
                    .optString("error")
                    .ifBlank { "Backend HTTP $code" }

                throw IllegalStateException(
                    "$APP_BUILD_ID · $error"
                )
            }

            Log.i(LOG_TAG, "POST_COMPLETE code=$code")
            return json
        }
    } catch (e: Exception) {
        Log.e(
            LOG_TAG,
            "POST_FAILED phase=$phase build=$APP_BUILD_ID",
            e
        )
        throw e
    }
}

private fun isLocationPermissionGranted(
    context: Context
): Boolean {
    val fineGranted =
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    val coarseGranted =
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    return fineGranted || coarseGranted
}

/*
 * Every platform location call in this function is guarded by the explicit
 * runtime permission check above. Suppressing MissingPermission here prevents
 * Android Lint from treating that verified control flow as an error.
 */
private fun isRunningOnEmulator(): Boolean {
    val fingerprint = Build.FINGERPRINT.lowercase(Locale.ROOT)
    val model = Build.MODEL.lowercase(Locale.ROOT)
    val product = Build.PRODUCT.lowercase(Locale.ROOT)
    val hardware = Build.HARDWARE.lowercase(Locale.ROOT)

    return fingerprint.contains("generic") ||
        fingerprint.contains("emulator") ||
        model.contains("sdk_gphone") ||
        model.contains("emulator") ||
        product.contains("sdk_gphone") ||
        product.contains("emulator") ||
        hardware.contains("ranchu") ||
        hardware.contains("goldfish")
}

@SuppressLint("MissingPermission")
private suspend fun resolveCurrentLocation(
    context: Context
): GeoPoint? {
    if (!isLocationPermissionGranted(context)) {
        return null
    }

    val manager =
        context.getSystemService(
            Context.LOCATION_SERVICE
        ) as LocationManager

    fun knownLocations() =
        runCatching { manager.allProviders }
            .getOrDefault(
                listOf(
                    LocationManager.NETWORK_PROVIDER,
                    LocationManager.GPS_PROVIDER,
                    LocationManager.PASSIVE_PROVIDER
                )
            )
            .distinct()
            .mapNotNull { provider ->
                runCatching {
                    manager.getLastKnownLocation(provider)
                }.getOrNull()
            }

    fun newestKnown(): GeoPoint? {
        val newest = knownLocations()
            .maxByOrNull { location ->
                location.elapsedRealtimeNanos
            }

        return newest?.let {
            GeoPoint(
                latitude = it.latitude,
                longitude = it.longitude
            )
        }
    }

    fun freshestKnown(maxAgeMs: Long): GeoPoint? {
        val nowElapsedNanos = android.os.SystemClock.elapsedRealtimeNanos()

        val freshest = knownLocations()
            .filter { location ->
                val ageNanos = nowElapsedNanos - location.elapsedRealtimeNanos
                ageNanos >= 0L &&
                    ageNanos <= maxAgeMs * 1_000_000L
            }
            .maxByOrNull { location ->
                location.elapsedRealtimeNanos
            }

        return freshest?.let {
            GeoPoint(
                latitude = it.latitude,
                longitude = it.longitude
            )
        }
    }

    // Android Emulator normally receives a single synthetic location when
    // "geo fix" / Extended Controls is used. It may not emit a new fix when
    // NearTime later calls getCurrentLocation(), so preserve that injected
    // location regardless of age. If none has ever been injected, use the
    // NearTime Oslo test origin. This branch is never used on a physical phone.
    if (isRunningOnEmulator()) {
        newestKnown()?.let {
            return it
        }

        return GeoPoint(
            latitude = DEFAULT_LATITUDE,
            longitude = DEFAULT_LONGITUDE
        )
    }

    // A fix from the last few seconds is already a current position and avoids
    // forcing a new satellite lock every time the user presses Search.
    freshestKnown(maxAgeMs = 15_000)?.let {
        return it
    }

    // Physical phones can wait a long time for a cold GPS lock indoors.
    // Try the usually faster network provider first, then GPS, both bounded.
    val providerTimeouts = listOf(
        LocationManager.NETWORK_PROVIDER to 2_000L,
        LocationManager.GPS_PROVIDER to 3_500L
    )

    for ((provider, timeoutMs) in providerTimeouts) {
        val enabled = runCatching {
            manager.isProviderEnabled(provider)
        }.getOrDefault(false)

        if (!enabled) {
            continue
        }

        val current = withTimeoutOrNull(timeoutMs) {
            getCurrentLocationCompat(
                context = context,
                manager = manager,
                provider = provider
            )
        }

        if (current != null) {
            return current
        }
    }

    // Physical-device fallback stays deliberately short-lived so a stale
    // position is never silently reused while the user is moving.
    return freshestKnown(maxAgeMs = 30_000)
}

/*
 * LocationManagerCompat provides the current-location operation on API levels
 * below Android 11, so the app remains valid with minSdk 24.
 */
@SuppressLint("MissingPermission")
private suspend fun getCurrentLocationCompat(
    context: Context,
    manager: LocationManager,
    provider: String
): GeoPoint? {
    if (!isLocationPermissionGranted(context)) {
        return null
    }

    return suspendCancellableCoroutine { continuation ->
        val cancellationSignal =
            CancellationSignal()

        continuation.invokeOnCancellation {
            cancellationSignal.cancel()
        }

        try {
            LocationManagerCompat.getCurrentLocation(
                manager,
                provider,
                cancellationSignal,
                ContextCompat.getMainExecutor(context)
            ) { location ->
                if (continuation.isActive) {
                    continuation.resume(
                        location?.let {
                            GeoPoint(
                                latitude = it.latitude,
                                longitude = it.longitude
                            )
                        }
                    )
                }
            }
        } catch (_: SecurityException) {
            if (continuation.isActive) {
                continuation.resume(null)
            }
        } catch (_: Exception) {
            if (continuation.isActive) {
                continuation.resume(null)
            }
        }
    }
}

@Suppress("DEPRECATION")
private suspend fun reverseGeocodeLocationLabel(
    context: Context,
    point: GeoPoint
): String? = withContext(Dispatchers.IO) {
    if (!Geocoder.isPresent()) {
        return@withContext null
    }

    runCatching {
        val result = Geocoder(context, Locale.getDefault())
            .getFromLocation(point.latitude, point.longitude, 1)
            ?.firstOrNull()
            ?: return@runCatching null

        val street = listOfNotNull(
            result.thoroughfare?.trim()?.takeIf { it.isNotEmpty() },
            result.subThoroughfare?.trim()?.takeIf { it.isNotEmpty() }
        ).joinToString(" ")

        val postalCity = listOfNotNull(
            result.postalCode?.trim()?.takeIf { it.isNotEmpty() },
            result.locality?.trim()?.takeIf { it.isNotEmpty() }
        ).joinToString(" ")

        val city = result.locality?.trim()?.takeIf { it.isNotEmpty() }

        when {
            street.isNotBlank() && postalCity.isNotBlank() ->
                "$street, $postalCity"
            street.isNotBlank() && !city.isNullOrBlank() ->
                "$street, $city"
            street.isNotBlank() ->
                street
            postalCity.isNotBlank() ->
                postalCity
            !city.isNullOrBlank() ->
                city
            else ->
                result.featureName?.trim()?.takeIf { it.isNotEmpty() }
        }
    }.getOrNull()
}

private fun openPlaceInGoogleMaps(
    context: Context,
    place: PlaceResult
) {
    val directGoogleUri = place.googleMapsUri
    if (!directGoogleUri.isNullOrBlank()) {
        launchExternalUri(
            context = context,
            uri = directGoogleUri.toUri()
        )
        return
    }

    val query = URLEncoder.encode(
        "${place.name}, ${place.address}",
        StandardCharsets.UTF_8.toString()
    )

    val uri =
        "https://www.google.com/maps/search/" +
            "?api=1&query=$query"

    launchExternalUri(
        context = context,
        uri = uri.toUri()
    )
}

private fun openWalkingDirections(
    context: Context,
    place: PlaceResult,
    origin: GeoPoint?
) {
    val destination =
        "${place.latitude},${place.longitude}"
    val originParam = origin?.let {
        "&origin=${it.latitude},${it.longitude}"
    } ?: ""

    val uri =
        "https://www.google.com/maps/dir/" +
            "?api=1$originParam&destination=$destination" +
            "&travelmode=walking"

    launchExternalUri(
        context = context,
        uri = uri.toUri()
    )
}

private fun launchExternalUri(
    context: Context,
    uri: Uri
) {
    val intent = Intent(
        Intent.ACTION_VIEW,
        uri
    ).apply {
        addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
        )
    }

    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No compatible map/browser app.
        // Deliberately no paid API fallback.
    }
}

private suspend fun recordClientQuotaUsage(
    service: String,
    eventId: UUID
) = withContext(Dispatchers.IO) {
    runCatching {
        val payload = JSONObject()
            .put("p_service", service)
            .put("p_units", 1)
            .put("p_event_id", eventId.toString())

        val request = Request.Builder()
            .url(SUPABASE_QUOTA_RPC_URL)
            .post(
                payload
                    .toString()
                    .toByteArray(StandardCharsets.UTF_8)
                    .toRequestBody(JSON_MEDIA_TYPE)
            )
            .header("apikey", SUPABASE_PUBLISHABLE_KEY)
            .header("Authorization", "Bearer $SUPABASE_PUBLISHABLE_KEY")
            .header("Content-Type", "application/json")
            .build()

        HTTP_CLIENT.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                Log.w(
                    LOG_TAG,
                    "QUOTA_TELEMETRY_FAILED build=$APP_BUILD_ID code=${response.code}"
                )
            }
        }
    }.onFailure {
        Log.w(LOG_TAG, "QUOTA_TELEMETRY_FAILED build=$APP_BUILD_ID", it)
    }
}

private fun JSONObject.optNullableString(name: String): String? {
    if (!has(name) || isNull(name)) return null

    return optString(name)
        .trim()
        .takeIf {
            it.isNotEmpty() &&
                !it.equals("null", ignoreCase = true)
        }
}

private fun JSONObject.optDoubleOrNull(
    name: String
): Double? {
    if (!has(name) || isNull(name)) {
        return null
    }

    val value =
        optDouble(name, Double.NaN)

    return value.takeIf {
        it.isFinite()
    }
}

private fun JSONObject.optIntOrNull(
    name: String
): Int? {
    if (!has(name) || isNull(name)) {
        return null
    }

    return runCatching {
        getInt(name)
    }.getOrNull()
}

private fun JSONArray.toStringList():
    List<String> = buildList {
    for (index in 0 until length()) {
        val value =
            optString(index).trim()

        if (value.isNotEmpty() && !value.equals("null", ignoreCase = true)) {
            add(value)
        }
    }
}