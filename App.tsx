import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Callout, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_ORIGIN, formatDistance, getTravelMinutes, modeLabel, querySummary } from './src/core/neartime';
import { categories, openForOptions, reviewOptions, sortOptions, travelModes, travelOptions } from './src/domain/options';
import { colors, elevation, radius, type } from './src/theme/tokens';
import type { Coordinate, OpenForMinutes, Place, ReviewMinimum, SearchQuery, SortKey, TravelMinutes, TravelMode } from './src/domain/types';
import { executeSearch, googlePlacesSearchProvider } from './src/providers';

const REGION_DELTA = 0.022;
const DEVICE_ID = 'prototype-device';

type SortDirection = 'asc' | 'desc';

function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      {icon ? <MaterialIcons name={icon} size={16} color={active ? colors.onPrimary : colors.onSurfaceVariant} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function toRegion(coordinate: Coordinate): Region {
  return { ...coordinate, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA };
}

function sortPlaces(places: Place[], sortKey: SortKey, direction: SortDirection, travelMode: TravelMode): Place[] {
  const copy = [...places];
  const time = (place: Place) => getTravelMinutes(place, travelMode);

  copy.sort((a, b) => {
    let primary = 0;
    switch (sortKey) {
      case 'rating': primary = a.rating - b.rating; break;
      case 'distance': primary = a.distanceMeters - b.distanceMeters; break;
      case 'price': primary = a.priceLevel - b.priceLevel; break;
      case 'reviews': primary = a.reviewCount - b.reviewCount; break;
      case 'open': primary = a.closesInMinutes - b.closesInMinutes; break;
      case 'time':
      default: primary = time(a) - time(b); break;
    }

    if (primary !== 0) return direction === 'asc' ? primary : -primary;
    return time(a) - time(b);
  });

  return copy;
}

function googleTravelMode(mode: TravelMode): 'walking' | 'driving' | 'bicycling' {
  if (mode === 'Drive') return 'driving';
  if (mode === 'Bike') return 'bicycling';
  return 'walking';
}

export default function App() {
  const mapRef = useRef<MapView | null>(null);
  const [category, setCategory] = useState<SearchQuery['category']>('Restaurant');
  const [travelMode, setTravelMode] = useState<TravelMode>('Walk');
  const [maxMinutes, setMaxMinutes] = useState<TravelMinutes>(10);
  const [minimumRating, setMinimumRating] = useState(4.0);
  const [minimumReviews, setMinimumReviews] = useState<ReviewMinimum>(0);
  const [openNow, setOpenNow] = useState(true);
  const [openForMinutes, setOpenForMinutes] = useState<OpenForMinutes>(0);
  const [origin, setOrigin] = useState<Coordinate>(DEFAULT_ORIGIN);
  const [locationReady, setLocationReady] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationLabel, setLocationLabel] = useState('Finding your location…');
  const [mapReady, setMapReady] = useState(false);
  const [resultsVisible, setResultsVisible] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [directionMenuOpen, setDirectionMenuOpen] = useState(false);
  const [providerResults, setProviderResults] = useState<Place[]>([]);
  const [providerStatus, setProviderStatus] = useState('Live search ready · protected by server cost gate');
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const query = useMemo<SearchQuery>(() => ({
    category,
    travelMode,
    maxMinutes,
    minimumRating,
    minimumReviews,
    openNow,
    openForMinutes,
  }), [category, travelMode, maxMinutes, minimumRating, minimumReviews, openNow, openForMinutes]);

  const sortedResults = useMemo(
    () => sortPlaces(providerResults, sortKey, sortDirection, travelMode),
    [providerResults, sortKey, sortDirection, travelMode],
  );

  const selectedSortLabel = sortOptions.find((option) => option.key === sortKey)?.label ?? 'Travel time';

  const requestCurrentLocation = async () => {
    try {
      setLocationLabel('Finding your location…');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationLabel('Location permission not granted');
        setLocationReady(false);
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const nextOrigin = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      const nextRegion = toRegion(nextOrigin);
      setOrigin(nextOrigin);
      setLocationAccuracy(current.coords.accuracy ?? null);
      setLocationReady(true);
      setLocationLabel('My current location');
      setProviderResults([]);
      setHasSearched(false);
      requestAnimationFrame(() => mapRef.current?.animateToRegion(nextRegion, 350));
    } catch {
      setLocationLabel('Could not read current location');
      setLocationReady(false);
      setLocationAccuracy(null);
    }
  };

  const recenterMap = () => {
    const nextRegion = toRegion(origin);
    mapRef.current?.animateToRegion(nextRegion, 300);
  };

  const runProviderSearch = async () => {
    if (!locationReady) {
      setProviderStatus('Live search blocked until current location is available.');
      setResultsVisible(true);
      return;
    }

    try {
      setIsSearching(true);
      setProviderStatus('Searching live Google Places data through NearTime…');
      const result = await executeSearch(googlePlacesSearchProvider, query, 'time', DEVICE_ID, origin);
      setProviderResults(result.places);
      setHasSearched(true);
      setSortKey('time');
      setSortDirection('asc');
      setProviderStatus(`${result.places.length} live ${result.places.length === 1 ? 'match' : 'matches'} · ${result.costUnits} cost unit · protected backend call`);
      setResultsVisible(true);
    } catch (error) {
      setProviderResults([]);
      setHasSearched(true);
      setProviderStatus(error instanceof Error ? error.message : 'Live search failed');
      setResultsVisible(true);
    } finally {
      setIsSearching(false);
    }
  };

  const openDirections = async (place: Place) => {
    const destinationLatitude = origin.latitude + place.latitudeOffset;
    const destinationLongitude = origin.longitude + place.longitudeOffset;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${destinationLatitude},${destinationLongitude}&travelmode=${googleTravelMode(travelMode)}`;
    await Linking.openURL(url);
  };

  useEffect(() => {
    void requestCurrentLocation();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.brand}>NearTime</Text>
              <Text style={styles.tagline}>Find the best places within your time.</Text>
            </View>
            <View style={styles.profileDot} />
          </View>

          <TouchableOpacity style={styles.locationCard} onPress={() => void requestCurrentLocation()}>
            <View style={styles.locationTextWrap}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="my-location" size={16} color={colors.primary} />
                <Text style={styles.locationTitle}>{locationLabel}</Text>
              </View>
              {locationReady && (
                <Text style={styles.locationDiagnostic}>
                  GPS {origin.latitude.toFixed(5)}, {origin.longitude.toFixed(5)}{locationAccuracy !== null ? ` · ±${Math.round(locationAccuracy)} m` : ''}
                </Text>
              )}
            </View>
            <Text style={styles.locationAction}>Refresh</Text>
          </TouchableOpacity>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>What do you need?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalRow}>
              {categories.map((item) => (
                <Chip key={item.label} label={item.label} icon={item.icon as keyof typeof MaterialIcons.glyphMap} active={category === item.label} onPress={() => setCategory(item.label)} />
              ))}
            </ScrollView>
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Travel mode</Text>
              <Text style={styles.sectionValue}>{travelMode}</Text>
            </View>
            <View style={styles.modeRow}>
              {travelModes.map((item) => (
                <TouchableOpacity key={item.label} onPress={() => setTravelMode(item.label)} style={[styles.modeButton, travelMode === item.label && styles.modeButtonActive]}>
                  <MaterialIcons
                    name={item.icon as keyof typeof MaterialIcons.glyphMap}
                    size={18}
                    color={travelMode === item.label ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text style={[styles.modeText, travelMode === item.label && styles.modeTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Maximum {modeLabel(travelMode)} time</Text>
              <Text style={styles.sectionValue}>{maxMinutes} min</Text>
            </View>
            <View style={styles.timeRow}>
              {travelOptions.map((minutes) => (
                <TouchableOpacity key={minutes} onPress={() => setMaxMinutes(minutes)} style={[styles.timeButton, maxMinutes === minutes && styles.timeButtonActive]}>
                  <Text style={[styles.timeButtonText, maxMinutes === minutes && styles.timeButtonTextActive]}>{minutes}</Text>
                  <Text style={[styles.timeButtonUnit, maxMinutes === minutes && styles.timeButtonTextActive]}>min</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.filtersCard}>
            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Minimum rating</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.compactRow}>
                {[4.0, 4.3, 4.5, 4.7].map((rating) => (
                  <Chip key={rating} label={`${rating.toFixed(1)} ★`} active={minimumRating === rating} onPress={() => setMinimumRating(rating)} />
                ))}
              </ScrollView>
            </View>

            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Minimum reviews</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.compactRow}>
                {reviewOptions.map((reviews) => (
                  <Chip key={reviews} label={reviews === 0 ? 'Any' : `${reviews.toLocaleString()}+`} active={minimumReviews === reviews} onPress={() => setMinimumReviews(reviews)} />
                ))}
              </ScrollView>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleTextWrap}>
                <Text style={styles.filterLabel}>Open now</Text>
                <Text style={styles.filterHint}>Hide places that are currently closed</Text>
              </View>
              <Switch
                value={openNow}
                onValueChange={(value) => setOpenNow(value)}
                trackColor={{ false: colors.outline, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>

            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Must stay open for</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.compactRow}>
                {openForOptions.map((minutes) => (
                  <Chip key={minutes} label={minutes === 0 ? 'Any time' : `${minutes / 60}h+`} active={openForMinutes === minutes} onPress={() => setOpenForMinutes(minutes)} />
                ))}
              </ScrollView>
            </View>
          </View>

          <View style={styles.summaryBar}>
            <View style={styles.summaryTextWrap}>
              <Text style={styles.summaryMain}>{hasSearched ? `${providerResults.length} live ${providerResults.length === 1 ? 'match' : 'matches'} · ${category}` : `Live ${category} search ready`}</Text>
              <Text style={styles.summaryDetail} numberOfLines={2}>{querySummary(query)}</Text>
            </View>
            <TouchableOpacity disabled={isSearching} style={styles.seeResultsButton} onPress={() => void runProviderSearch()}><Text style={styles.seeResultsButtonText}>{isSearching ? 'Searching…' : 'Search live'}</Text></TouchableOpacity>
          </View>

          <View style={styles.liveNotice}>
            <Text style={styles.liveNoticeTitle}>Live Places test mode</Text>
            <Text style={styles.liveNoticeText}>Every result must satisfy your active hard filters. Search results default to shortest travel time first.</Text>
          </View>

          <View style={styles.mapShell}>
            {locationReady && (
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              mapType="standard"
              initialRegion={toRegion(origin)}
              onMapReady={() => setMapReady(true)}
              showsUserLocation={locationReady}
              showsMyLocationButton={false}
              toolbarEnabled={false}
              cacheEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
            >
              {sortedResults.map((place) => {
                const coordinate = { latitude: origin.latitude + place.latitudeOffset, longitude: origin.longitude + place.longitudeOffset };
                const minutes = getTravelMinutes(place, travelMode);
                return (
                  <Marker key={place.id} coordinate={coordinate} anchor={{ x: 0.5, y: 1 }}>
                    <View style={styles.mapTimePin}><Text style={styles.mapTimePinText}>{minutes} min</Text></View>
                    <Callout onPress={() => setSelectedPlace(place)}>
                      <View style={styles.callout}>
                        <Text style={styles.calloutTitle}>{place.name}</Text>
                        <Text style={styles.calloutText}>{place.rating.toFixed(1)} ★ · {place.reviewCount.toLocaleString()} reviews · LIVE</Text>
                      </View>
                    </Callout>
                  </Marker>
                );
              })}
            </MapView>
            )}
            <View style={styles.mapBadge}><Text style={styles.mapBadgeText}>{mapReady ? 'MAP READY' : 'LOADING MAP'} · {hasSearched ? `${providerResults.length} LIVE PLACES` : 'NO SEARCH YET'}</Text></View>
            <TouchableOpacity style={styles.recenterButton} onPress={recenterMap}>
              <MaterialIcons name="my-location" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity disabled={isSearching} style={styles.largeResultsButton} onPress={() => void runProviderSearch()}>
            <Text style={styles.largeResultsButtonText}>{isSearching ? 'Searching live places…' : 'Search live places'}</Text>
          </TouchableOpacity>

          <View style={styles.devNotice}>
            <Text style={styles.devNoticeTitle}>Protected live prototype</Text>
            <Text style={styles.devNoticeText}>Walk, bike and drive use direct travel-time routing. Sorting the returned matches and opening Google Maps directions do not trigger another NearTime Places search.</Text>
            <Text style={styles.devNoticeStatus}>{providerStatus}</Text>
          </View>
        </ScrollView>

        <Modal visible={resultsVisible} animationType="slide" onRequestClose={() => setResultsVisible(false)}>
          <SafeAreaView style={styles.modalSafeArea}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{category} results</Text>
                <Text style={styles.modalSubtitle}>{providerResults.length} matching nearby {providerResults.length === 1 ? 'place' : 'places'}</Text>
              </View>
              <TouchableOpacity onPress={() => setResultsVisible(false)}><Text style={styles.closeButton}>Close</Text></TouchableOpacity>
            </View>

            <View style={styles.sortControls}>
              <View style={styles.dropdownColumn}>
                <Text style={styles.dropdownLabel}>Sort by</Text>
                <TouchableOpacity style={styles.dropdownButton} onPress={() => { setSortMenuOpen((value) => !value); setDirectionMenuOpen(false); }}>
                  <Text style={styles.dropdownButtonText}>{selectedSortLabel}</Text><Text style={styles.dropdownChevron}>⌄</Text>
                </TouchableOpacity>
                {sortMenuOpen && (
                  <View style={styles.dropdownMenu}>
                    {sortOptions.map((option) => (
                      <TouchableOpacity key={option.key} style={[styles.dropdownOption, sortKey === option.key && styles.dropdownOptionActive]} onPress={() => { setSortKey(option.key); setSortMenuOpen(false); }}>
                        <Text style={[styles.dropdownOptionText, sortKey === option.key && styles.dropdownOptionTextActive]}>{option.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.dropdownColumn}>
                <Text style={styles.dropdownLabel}>Order</Text>
                <TouchableOpacity style={styles.dropdownButton} onPress={() => { setDirectionMenuOpen((value) => !value); setSortMenuOpen(false); }}>
                  <Text style={styles.dropdownButtonText}>{sortDirection === 'asc' ? 'Ascending' : 'Descending'}</Text><Text style={styles.dropdownChevron}>⌄</Text>
                </TouchableOpacity>
                {directionMenuOpen && (
                  <View style={styles.dropdownMenu}>
                    {(['asc', 'desc'] as SortDirection[]).map((direction) => (
                      <TouchableOpacity key={direction} style={[styles.dropdownOption, sortDirection === direction && styles.dropdownOptionActive]} onPress={() => { setSortDirection(direction); setDirectionMenuOpen(false); }}>
                        <Text style={[styles.dropdownOptionText, sortDirection === direction && styles.dropdownOptionTextActive]}>{direction === 'asc' ? 'Ascending' : 'Descending'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <ScrollView contentContainerStyle={styles.resultsList}>
              {sortedResults.length === 0 ? (
                <View style={styles.emptyState}><Text style={styles.emptyTitle}>No live matches</Text><Text style={styles.emptyText}>Increase travel time or relax one of the filters, then run a new search.</Text></View>
              ) : sortedResults.map((place) => (
                <View key={place.id} style={styles.resultCard}>
                  <TouchableOpacity onPress={() => setSelectedPlace(place)}>
                    <View style={styles.resultTopRow}>
                      <View style={styles.resultTitleWrap}>
                        <Text style={styles.travelTime}>{getTravelMinutes(place, travelMode)} min {modeLabel(travelMode)} · {formatDistance(place.distanceMeters)} · LIVE</Text>
                        <Text style={styles.placeName}>{place.name}</Text>
                      </View>
                      <View style={styles.ratingBadge}><Text style={styles.ratingBadgeText}>{place.rating.toFixed(1)} ★</Text></View>
                    </View>
                    <Text style={styles.placeMeta}>{place.reviewCount.toLocaleString()} reviews · {place.price} · {place.open ? `Open for ${Math.floor(place.closesInMinutes / 60)}h ${place.closesInMinutes % 60}m` : 'Closed'}</Text>
                    <Text style={styles.placeAddress}>{place.address}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.directionsButton} onPress={() => void openDirections(place)}>
                    <Text style={styles.directionsButtonText}>Directions in Google Maps</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>

        <Modal visible={selectedPlace !== null} transparent animationType="slide" onRequestClose={() => setSelectedPlace(null)}>
          <View style={styles.detailBackdrop}>
            <View style={styles.detailSheet}>
              {selectedPlace && (
                <>
                  <View style={styles.detailHandle} />
                  <View style={styles.detailHeaderRow}>
                    <View style={styles.detailTitleWrap}><Text style={styles.detailTitle}>{selectedPlace.name}</Text><Text style={styles.detailSub}>LIVE PLACE · {selectedPlace.rating.toFixed(1)} ★ · {selectedPlace.reviewCount.toLocaleString()} reviews</Text></View>
                    <TouchableOpacity onPress={() => setSelectedPlace(null)}><Text style={styles.closeButton}>Close</Text></TouchableOpacity>
                  </View>
                  <Text style={styles.detailLead}>{getTravelMinutes(selectedPlace, travelMode)} min {modeLabel(travelMode)} · {formatDistance(selectedPlace.distanceMeters)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="place" size={14} color={colors.onSurfaceVariant} />
                    <Text style={styles.detailLine}>{selectedPlace.address}</Text>
                  </View>
                  <Text style={styles.detailLine}>{selectedPlace.open ? `ðŸ•’ Open for ${Math.floor(selectedPlace.closesInMinutes / 60)}h ${selectedPlace.closesInMinutes % 60}m` : 'ðŸ•’ Closed'}</Text>
                  <TouchableOpacity style={styles.directionsButton} onPress={() => void openDirections(selectedPlace)}>
                    <Text style={styles.directionsButtonText}>Directions in Google Maps</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 24, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTextWrap: { flex: 1, paddingRight: 12 },
  brand: { fontSize: 22, fontWeight: type.semibold, color: colors.onSurface, letterSpacing: -0.4 },
  tagline: { marginTop: 1, fontSize: 13, color: colors.onSurfaceVariant },
  profileDot: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: colors.surfaceVariant },
  // Shadow, not border — this is the single biggest "native app" cue.
  locationCard: { minHeight: 60, borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...elevation(1) },
  locationTextWrap: { flex: 1, paddingRight: 12 },
  locationAction: { fontSize: 13, fontWeight: type.medium, color: colors.primary },
  locationTitle: { fontSize: 15, fontWeight: type.medium, color: colors.onSurface },
  locationDiagnostic: { marginTop: 2, fontSize: 11, color: colors.onSurfaceVariant },
  sectionBlock: { gap: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontWeight: type.medium, color: colors.onSurface },
  sectionValue: { fontSize: 13, fontWeight: type.medium, color: colors.primary },
  horizontalRow: { gap: 6, paddingRight: 12 },
  compactRow: { gap: 6, paddingRight: 4 },
  // Filled grey by default, Maps-blue only when selected. No border.
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surfaceVariant },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: type.medium, color: colors.onSurfaceVariant },
  chipTextActive: { color: colors.onPrimary, fontWeight: type.semibold },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeButton: { flex: 1, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.surfaceVariant, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  modeButtonActive: { backgroundColor: '#E8F0FE' }, // Google's standard light-blue selected fill
  modeText: { fontSize: 13, fontWeight: type.medium, color: colors.onSurfaceVariant },
  modeTextActive: { color: colors.primary, fontWeight: type.semibold },
  timeRow: { flexDirection: 'row', gap: 6 },
  timeButton: { flex: 1, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' },
  timeButtonActive: { backgroundColor: '#E8F0FE' },
  timeButtonText: { fontSize: 17, fontWeight: type.medium, color: colors.onSurface },
  timeButtonUnit: { fontSize: 10, fontWeight: type.regular, color: colors.onSurfaceVariant },
  timeButtonTextActive: { color: colors.primary, fontWeight: type.semibold },
  filtersCard: { borderRadius: radius.lg, backgroundColor: colors.surface, padding: 14, gap: 14, ...elevation(1) },
  filterBlock: { gap: 6 },
  filterLabel: { fontSize: 14, fontWeight: type.medium, color: colors.onSurface },
  filterHint: { marginTop: 2, fontSize: 11, color: colors.onSurfaceVariant },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleTextWrap: { flex: 1 },
  summaryBar: { borderRadius: radius.lg, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  summaryTextWrap: { flex: 1 },
  summaryMain: { color: colors.onPrimary, fontSize: 15, fontWeight: type.semibold },
  summaryDetail: { marginTop: 2, color: '#D2E3FC', fontSize: 11, lineHeight: 15, fontWeight: type.regular },
  seeResultsButton: { borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 9 },
  seeResultsButtonText: { color: colors.primary, fontSize: 12, fontWeight: type.semibold },
  liveNotice: { borderRadius: radius.md, backgroundColor: colors.surfaceVariant, padding: 12 },
  liveNoticeTitle: { fontSize: 12, fontWeight: type.semibold, color: colors.onSurface },
  liveNoticeText: { marginTop: 3, fontSize: 11, lineHeight: 16, color: colors.onSurfaceVariant },
  mapShell: { height: 260, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceVariant, position: 'relative' },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  mapBadge: { position: 'absolute', top: 12, left: 12, borderRadius: radius.full, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 6, ...elevation(2) },
  mapBadgeText: { color: colors.onSurface, fontSize: 11, fontWeight: type.medium },
  // Round floating action button — shadow, no border, like Maps' recenter control.
  recenterButton: { position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...elevation(2) },
  mapTimePin: { borderRadius: radius.full, backgroundColor: colors.surface, paddingHorizontal: 9, paddingVertical: 6, ...elevation(2) },
  mapTimePinText: { color: colors.primary, fontSize: 11, fontWeight: type.semibold },
  callout: { minWidth: 160, padding: 8 },
  calloutTitle: { fontSize: 14, fontWeight: type.semibold, color: colors.onSurface },
  calloutText: { marginTop: 3, fontSize: 11, color: colors.onSurfaceVariant },
  largeResultsButton: { minHeight: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  largeResultsButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: type.semibold },
  devNotice: { borderRadius: radius.lg, backgroundColor: '#FEF7E0', padding: 13 },
  devNoticeTitle: { fontSize: 12, fontWeight: type.semibold, color: colors.warning },
  devNoticeText: { marginTop: 2, fontSize: 11, lineHeight: 16, color: colors.warning },
  devNoticeStatus: { marginTop: 7, fontSize: 10, fontWeight: type.semibold, color: colors.warning },
  modalSafeArea: { flex: 1, backgroundColor: colors.background },
  modalHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 20, fontWeight: type.semibold, color: colors.onSurface },
  modalSubtitle: { marginTop: 2, fontSize: 12, color: colors.onSurfaceVariant },
  closeButton: { color: colors.primary, fontSize: 13, fontWeight: type.medium },
  sortControls: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, alignItems: 'flex-start' },
  dropdownColumn: { flex: 1 },
  dropdownLabel: { marginBottom: 5, fontSize: 11, fontWeight: type.medium, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.5 },
  dropdownButton: { minHeight: 40, borderRadius: radius.md, backgroundColor: colors.surfaceVariant, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownButtonText: { fontSize: 13, fontWeight: type.medium, color: colors.onSurface },
  dropdownChevron: { fontSize: 18, color: colors.onSurfaceVariant },
  dropdownMenu: { marginTop: 5, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden', ...elevation(2) },
  dropdownOption: { minHeight: 38, paddingHorizontal: 12, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline },
  dropdownOptionActive: { backgroundColor: colors.surfaceVariant },
  dropdownOptionText: { fontSize: 13, color: colors.onSurface },
  dropdownOptionTextActive: { fontWeight: type.semibold, color: colors.primary },
  resultsList: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
  emptyState: { borderRadius: radius.lg, backgroundColor: colors.surface, padding: 16, ...elevation(1) },
  emptyTitle: { fontSize: 15, fontWeight: type.medium, color: colors.onSurface },
  emptyText: { marginTop: 3, fontSize: 12, color: colors.onSurfaceVariant },
  // Flat list row with a hairline divider — not a stacked card. This is the
  // single change that most reads as "Maps list", not "component library".
  resultCard: { flexDirection: 'row', paddingVertical: 12, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline },
  resultTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  resultTitleWrap: { flex: 1 },
  travelTime: { fontSize: 12, fontWeight: type.medium, color: colors.primary },
  placeName: { marginTop: 2, fontSize: 16, fontWeight: type.medium, color: colors.onSurface },
  ratingBadge: { borderRadius: radius.full, backgroundColor: colors.surfaceVariant, paddingHorizontal: 10, paddingVertical: 6 },
  ratingBadgeText: { fontSize: 12, fontWeight: type.medium, color: colors.onSurface },
  placeMeta: { marginTop: 6, fontSize: 12, lineHeight: 17, color: colors.onSurfaceVariant },
  placeAddress: { marginTop: 2, fontSize: 12, color: colors.onSurfaceVariant },
  directionsButton: { minHeight: 40, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  directionsButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: type.medium },
  detailBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-end' },
  detailSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, gap: 10, ...elevation(3) },
  detailHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.sm, backgroundColor: colors.outline, marginBottom: 2 },
  detailHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  detailTitleWrap: { flex: 1 },
  detailTitle: { fontSize: 19, fontWeight: type.semibold, color: colors.onSurface },
  detailSub: { marginTop: 3, fontSize: 12, color: colors.onSurfaceVariant },
  detailLead: { fontSize: 14, fontWeight: type.medium, color: colors.primary },
  detailLine: { fontSize: 13, color: colors.onSurface },
});





