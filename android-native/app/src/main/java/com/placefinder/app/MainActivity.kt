package com.placefinder.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.net.toUri
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.MapsInitializer
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
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
private const val APP_BUILD_ID = "production-20260918-10"
private const val LOG_TAG = "NearTimeNet"
private const val RESULT_LIMIT = 10
private const val DEFAULT_LATITUDE = 59.9110
private const val DEFAULT_LONGITUDE = 10.7522

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
    val sourceVerified: Boolean,
    val walkSeconds: Int,
    val walkMinutes: Int,
    val walkDistanceMeters: Int
)

private data class SearchResponse(
    val places: List<PlaceResult>,
    val exhaustedCandidates: Boolean,
    val usageText: String?
)

private sealed interface SearchState {
    data object Idle : SearchState
    data object Loading : SearchState
    data class Success(val response: SearchResponse) : SearchState
    data class Error(val message: String) : SearchState
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        MapsInitializer.initialize(applicationContext)

        setContent {
            MaterialTheme(colorScheme = lightColorScheme()) {
                NearTimeScreen()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NearTimeScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var selectedCategory by remember { mutableStateOf(SearchCategory.BARS_DRINKS) }
    var categoryExpanded by remember { mutableStateOf(false) }
    var maxWalkMinutes by remember { mutableFloatStateOf(15f) }
    var openNowOnly by remember { mutableStateOf(true) }
    var minOpenMinutes by remember { mutableFloatStateOf(0f) }

    var useCurrentLocation by remember { mutableStateOf(true) }
    var currentLocation by remember { mutableStateOf<GeoPoint?>(null) }
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

    val cameraPositionState = rememberCameraPositionState()
    val categoryListState = rememberLazyListState()
    val resultListState = rememberLazyListState()

    LaunchedEffect(hasLocationPermission, permissionRevision) {
        if (hasLocationPermission) {
            currentLocation = resolveCurrentLocation(context)
        }
    }

    val activeOrigin = if (useCurrentLocation) {
        currentLocation
    } else {
        customLocation?.let { GeoPoint(it.latitude, it.longitude) }
    }

    LaunchedEffect(activeOrigin?.latitude, activeOrigin?.longitude) {
        activeOrigin?.let {
            cameraPositionState.animate(
                CameraUpdateFactory.newLatLngZoom(
                    LatLng(it.latitude, it.longitude),
                    14.5f
                )
            )
        }
    }

    fun refreshGps() {
        scope.launch {
            locationError = null
            try {
                currentLocation = resolveCurrentLocation(context)
                    ?: throw IllegalStateException("GPS position is not available.")
            } catch (e: Exception) {
                locationError = e.message ?: "Could not read GPS position."
            }
        }
    }

    fun runPlaceSearch() {
        scope.launch {
            searchState = SearchState.Loading
            selectedPlace = null

            try {
                val origin = if (useCurrentLocation) {
                    resolveCurrentLocation(context)
                        ?: throw IllegalStateException("Current GPS position is not available yet.")
                } else {
                    customLocation?.let { GeoPoint(it.latitude, it.longitude) }
                    ?: throw IllegalStateException("Choose a start location first.")
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
                    minOpenMinutes = if (openNowOnly) minOpenMinutes.roundToInt() else 0
                )

                val validated = response.places
                    .asSequence()
                    .filter { it.categoryLabel.isNotBlank() }
                    .filter { it.sourceCategories.isNotEmpty() }
                    .filter { it.sourceVerified }
                    .filter { it.walkMinutes <= maxWalkMinutes.roundToInt() }
                    // Backend owns opening-hours semantics. When Open now is enabled,
                    // confirmed-closed places are already excluded there; unknown hours
                    // must not be silently treated as closed by the Android client.
                    .filter { !openNowOnly || it.isOpenNow != false }
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
                searchState = SearchState.Error(
                    "$APP_BUILD_ID · ${e::class.java.simpleName}: " +
                        (e.message ?: "Search failed.")
                )
            }
        }
    }

    Scaffold { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "NearTime",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold
                )
                Text("Find places by real walking time.")
            }

            item {
                GoogleMap(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(300.dp),
                    cameraPositionState = cameraPositionState,
                    properties = MapProperties(
                        isMyLocationEnabled = hasLocationPermission
                    ),
                    uiSettings = MapUiSettings(
                        myLocationButtonEnabled = hasLocationPermission,
                        zoomControlsEnabled = false,
                        compassEnabled = true
                    )
                ) {
                    if (!useCurrentLocation) {
                        customLocation?.let {
                            Marker(
                                state = MarkerState(
                                    LatLng(it.latitude, it.longitude)
                                ),
                                title = it.title,
                                snippet = "Start location"
                            )
                        }
                    }

                    val places = (searchState as? SearchState.Success)
                        ?.response
                        ?.places
                        .orEmpty()
                    places.forEachIndexed { index, place ->
                        Marker(
                            state = MarkerState(
                                LatLng(place.latitude, place.longitude)
                            ),
                            title = "${index + 1}. ${place.name}",
                            snippet = "${place.categoryLabel} · ${place.walkMinutes} min walk",
                            onClick = {
                                selectedPlace = place
                                false
                            }
                        )
                    }
                }
            }

            item {
                Text("Start from", fontWeight = FontWeight.SemiBold)

                FilterChip(
                    selected = useCurrentLocation,
                    onClick = {
                        useCurrentLocation = true
                        customLocation = null
                        customLocationText = ""
                        locationSuggestions = emptyList()
                        locationError = null
                    },
                    label = { Text("My current location") }
                )

                if (!hasLocationPermission) {
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
                } else {
                    Text(
                        text = if (currentLocation == null) "Finding your GPS position…" else "GPS location ready",
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                Spacer(Modifier.height(6.dp))
                Text("Or use a place or address", fontWeight = FontWeight.SemiBold)

                OutlinedTextField(
                    value = customLocationText,
                    onValueChange = {
                        customLocationText = it
                        customLocation = null
                        useCurrentLocation = it.isBlank()
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
                                locationSuggestions = suggestLocationsBackend(
                                    customLocationText.trim(), bias.latitude, bias.longitude
                                )
                                if (locationSuggestions.isEmpty()) {
                                    locationError = "No matching start location found."
                                }
                            } catch (e: Exception) {
                                locationError = e.message ?: "Location search failed."
                            } finally { locationSearchBusy = false }
                        }
                    }
                ) {
                    if (locationSearchBusy) {
                        CircularProgressIndicator(modifier = Modifier.height(18.dp), strokeWidth = 2.dp)
                    } else Text("Find place or address")
                }

                locationSuggestions.forEach { suggestion ->
                    Card(
                        modifier = Modifier.fillMaxWidth().clickable {
                            scope.launch {
                                locationSearchBusy = true
                                locationError = null
                                try {
                                    val resolved = resolveLocationBackend(suggestion)
                                    customLocation = resolved
                                    customLocationText = resolved.title
                                    useCurrentLocation = false
                                    locationSuggestions = emptyList()
                                    cameraPositionState.animate(
                                        CameraUpdateFactory.newLatLngZoom(
                                            LatLng(resolved.latitude, resolved.longitude), 14.5f
                                        )
                                    )
                                } catch (e: Exception) {
                                    locationError = e.message ?: "Could not resolve location."
                                } finally { locationSearchBusy = false }
                            }
                        }
                    ) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(suggestion.title, fontWeight = FontWeight.SemiBold)
                            if (suggestion.subtitle.isNotBlank()) {
                                Text(suggestion.subtitle, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }

                customLocation?.let {
                    Text(
                        "Using: " + it.title +
                            if (it.address.isNotBlank()) " · " + it.address else "",
                        style = MaterialTheme.typography.bodySmall
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

            item {
                ExposedDropdownMenuBox(
                    expanded = categoryExpanded,
                    onExpandedChange = {
                        categoryExpanded = !categoryExpanded
                    }
                ) {
                    TextField(
                        value = selectedCategory.displayName,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Place type") },
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(
                                expanded = categoryExpanded
                            )
                        },
                        modifier = Modifier
                            .menuAnchor(
                                ExposedDropdownMenuAnchorType.PrimaryNotEditable
                            )
                            .fillMaxWidth()
                    )

                    ExposedDropdownMenu(
                        expanded = categoryExpanded,
                        onDismissRequest = {
                            categoryExpanded = false
                        }
                    ) {
                        val sortedCategories = SearchCategory.entries
                            .sortedBy { it.displayName.lowercase(Locale.ROOT) }

                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(420.dp)
                        ) {
                            LazyColumn(
                                state = categoryListState,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(end = 14.dp)
                            ) {
                                itemsIndexed(
                                    items = sortedCategories,
                                    key = { _, category -> category.wireValue }
                                ) { _, category ->
                                    DropdownMenuItem(
                                        text = {
                                            Text(category.displayName)
                                        },
                                        onClick = {
                                            selectedCategory = category
                                            categoryExpanded = false
                                        }
                                    )
                                }
                            }

                            LazyListScrollbar(
                                state = categoryListState,
                                itemCount = sortedCategories.size,
                                modifier = Modifier
                                    .align(Alignment.CenterEnd)
                                    .fillMaxHeight()
                                    .width(14.dp)
                            )
                        }
                    }
                }
            }

            item {
                Card(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp)
                    ) {
                        Text(
                            text = "Maximum walking time: " +
                                "${maxWalkMinutes.roundToInt()} min",
                            fontWeight = FontWeight.SemiBold
                        )

                        Slider(
                            value = maxWalkMinutes,
                            onValueChange = {
                                maxWalkMinutes = it
                            },
                            valueRange = 5f..30f,
                            steps = 24
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement =
                                Arrangement.SpaceBetween
                        ) {
                            Column(
                                modifier = Modifier.fillMaxWidth(0.80f)
                            ) {
                                Text(
                                    "Open now",
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    "Excludes places confirmed closed. Places without opening-hours data remain visible and are marked unavailable.",
                                    style = MaterialTheme.typography.bodySmall
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

                        if (openNowOnly) {
                            Spacer(Modifier.height(12.dp))
                            Text(
                                text = if (minOpenMinutes.roundToInt() == 0) {
                                    "Minimum time until closing: no minimum"
                                } else {
                                    "Minimum time until closing: " +
                                        if (minOpenMinutes.roundToInt() < 60) {
                                            "${minOpenMinutes.roundToInt()} min"
                                        } else {
                                            val hours = minOpenMinutes.roundToInt() / 60
                                            val minutes = minOpenMinutes.roundToInt() % 60
                                            if (minutes == 0) "${hours} h" else "${hours} h ${minutes} min"
                                        }
                                },
                                fontWeight = FontWeight.SemiBold
                            )
                            Slider(
                                value = minOpenMinutes,
                                onValueChange = { minOpenMinutes = it },
                                valueRange = 0f..180f,
                                steps = 5
                            )
                            Text(
                                "Only places confirmed to remain open for at least this long.",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }

            item {
                Button(
                    modifier = Modifier.fillMaxWidth(),
                    enabled = searchState !is SearchState.Loading &&
                        if (useCurrentLocation) {
                            hasLocationPermission
                        } else {
                            customLocation != null
                        },
                    onClick = {
                        runPlaceSearch()
                    }
                ) {
                    if (searchState is SearchState.Loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.height(20.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Find up to 10 places")
                    }
                }
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

                is SearchState.Success -> {
                    item {
                        Text(
                            text = "${state.response.places.size} places within walking limit",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )

                        if (state.response.exhaustedCandidates) {
                            Text(
                                "Fewer than 10 places could be established within the walking-time limit.",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }

                        state.response.usageText?.let {
                            Text(
                                text = it,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }

                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(620.dp)
                        ) {
                            LazyColumn(
                                state = resultListState,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(end = 14.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                itemsIndexed(
                                    items = state.response.places,
                                    key = { _, place -> place.id }
                                ) { index, place ->
                                    PlaceCard(
                                        rank = index + 1,
                                        place = place,
                                        searchOrigin = lastSearchOrigin,
                                        selected = selectedPlace?.id == place.id,
                                        onSelect = {
                                            selectedPlace = place

                                            scope.launch {
                                                cameraPositionState.animate(
                                                    CameraUpdateFactory.newLatLngZoom(
                                                        LatLng(
                                                            place.latitude,
                                                            place.longitude
                                                        ),
                                                        16f
                                                    )
                                                )
                                            }
                                        }
                                    )
                                }
                            }

                            LazyListScrollbar(
                                state = resultListState,
                                itemCount = state.response.places.size,
                                modifier = Modifier
                                    .align(Alignment.CenterEnd)
                                    .fillMaxHeight()
                                    .width(14.dp)
                            )
                        }
                    }
                }
            }

            item {
                Spacer(Modifier.height(24.dp))
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
    val visibleCount by remember(state) {
        derivedStateOf { state.layoutInfo.visibleItemsInfo.size.coerceAtLeast(1) }
    }

    val thumbFraction = (visibleCount.toFloat() / itemCount.toFloat())
        .coerceIn(0.12f, 1f)
    val maxFirst = (itemCount - visibleCount).coerceAtLeast(1)
    val positionFraction = (firstVisibleIndex.toFloat() / maxFirst.toFloat())
        .coerceIn(0f, 1f)

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
                        scope.launch {
                            state.scrollToItem((fraction * maxFirst).roundToInt())
                        }
                    },
                    onVerticalDrag = { change, _ ->
                        change.consume()
                        val track = size.height.toFloat()
                        val thumb = track * thumbFraction
                        val usable = (track - thumb).coerceAtLeast(1f)
                        val fraction = ((change.position.y - thumb / 2f) / usable)
                            .coerceIn(0f, 1f)
                        scope.launch {
                            state.scrollToItem((fraction * maxFirst).roundToInt())
                        }
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
            Row(                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(0.78f)
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

                Text(
                    text = "${place.walkMinutes} min",
                    fontWeight = FontWeight.Bold
                )
            }

            Text("${place.walkDistanceMeters} m walking")

            if (place.address.isNotBlank()) {
                Text(
                    text = place.address,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            val openText = when (place.isOpenNow) {
                true -> "Open now"
                false -> "Closed now"
                null -> "Opening status unavailable"
            }

            Text(
                text = openText,
                style = MaterialTheme.typography.bodySmall
            )

            if (selected) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Selected on map",
                    style = MaterialTheme.typography.labelMedium
                )
            }

            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(Modifier.height(8.dp))

            OutlinedButton(
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    openPlaceInGoogleMaps(context, place)
                }
            ) {
                Text("Open in Maps")
            }

            Button(
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    openWalkingDirections(context, place, searchOrigin)
                }
            ) {
                Text("Show route")
            }
        }
    }
}

private suspend fun searchBackend(
    latitude: Double,
    longitude: Double,
    category: String,
    maxWalkMinutes: Int,
    openNowOnly: Boolean,
    minOpenMinutes: Int
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
    )

    val resultStatus = json.optString("resultStatus")
    if (resultStatus == "DEGRADED") {
        throw IllegalStateException(
            json.optString("reason")
                .ifBlank {
                    "Exact Top 10 could not be proven inside the 30 øre cost cap."
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

    val usage = json.optJSONObject("usage")
    val thisSearch = usage?.optJSONObject("thisSearch")

    val usageText = thisSearch?.let {
        val discoveryCalls = it.optInt("tomtomDiscover", 0)
        val routeCalls = it.optInt("tomtomRoute", 0)
        val guardedCost = it.optDouble("conservativeCostNok", 0.0)

        "Cloud search · discovery $discoveryCalls/1 · " +
            "walking routes $routeCalls/24 · " +
            String.format(
                Locale.US,
                "cost guard %.1f øre",
                guardedCost * 100.0
            )
    }

    SearchResponse(
        places = places,
        exhaustedCandidates = exhausted,
        usageText = usageText
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

    val latitude = obj.optDoubleOrNull("latitude")
        ?: return null

    val longitude = obj.optDoubleOrNull("longitude")
        ?: return null

    val walkSeconds = obj.optIntOrNull("walkSeconds")
        ?: return null

    val walkMinutes = obj.optIntOrNull("walkMinutes")
        ?: return null

    val walkDistanceMeters =
        obj.optIntOrNull("walkDistanceMeters")
            ?: return null

    if (
        walkSeconds < 0 ||
        walkMinutes < 0 ||
        walkDistanceMeters < 0
    ) {
        return null
    }

    val sourceVerified = when {
        obj.has("sourceVerified") ->
            obj.optBoolean("sourceVerified", false)
        else ->
            obj.optBoolean("googleOperationalVerified", false)
    }

    if (!sourceVerified) {
        return null
    }

    val isOpenNow = when {
        !obj.has("isOpenNow") -> null
        obj.isNull("isOpenNow") -> null
        else -> obj.optBoolean("isOpenNow")
    }

    return PlaceResult(
        id = id,
        name = name,
        categoryLabel = categoryLabel,
        sourceCategories = categories,
        latitude = latitude,
        longitude = longitude,
        address = obj
            .optString("address")
            .trim(),
        isOpenNow = isOpenNow,
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

    val activeProviders = listOf(
        LocationManager.GPS_PROVIDER,
        LocationManager.NETWORK_PROVIDER
    ).filter { provider ->
        runCatching {
            manager.isProviderEnabled(provider)
        }.getOrDefault(false)
    }

    // Search always requests a current fix before provider work begins.
    for (provider in activeProviders) {
        val current =
            getCurrentLocationCompat(
                context = context,
                manager = manager,
                provider = provider
            )

        if (current != null) {
            return current
        }
    }

    // Resilience fallback is restricted to a very recent fix.
    val freshest = listOf(
        LocationManager.GPS_PROVIDER,
        LocationManager.NETWORK_PROVIDER,
        LocationManager.PASSIVE_PROVIDER
    )
        .mapNotNull { provider ->
            runCatching {
                manager.getLastKnownLocation(provider)
            }.getOrNull()
        }
        .maxByOrNull { location ->
            location.time
        }

    return freshest
        ?.takeIf {
            System.currentTimeMillis() - it.time <= 30_000
        }
        ?.let {
            GeoPoint(
                latitude = it.latitude,
                longitude = it.longitude
            )
        }
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

private fun openPlaceInGoogleMaps(
    context: Context,
    place: PlaceResult
) {
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

        if (value.isNotEmpty()) {
            add(value)
        }
    }
}