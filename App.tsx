import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Callout, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_ORIGIN, formatDistance, getTravelMinutes, modeLabel, mockPlaces, querySummary, runQuery } from './src/core/neartime';
import { categories, openForOptions, reviewOptions, sortOptions, travelModes, travelOptions } from './src/domain/options';
import type { Coordinate, OpenForMinutes, Place, ReviewMinimum, SearchQuery, SortKey, TravelMinutes, TravelMode } from './src/domain/types';
import { executeSearch, mockSearchProvider } from './src/providers';

const REGION_DELTA = 0.022;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function toRegion(coordinate: Coordinate): Region {
  return { ...coordinate, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA };
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
  const [mapRegion, setMapRegion] = useState<Region>(toRegion(DEFAULT_ORIGIN));
  const [locationReady, setLocationReady] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationLabel, setLocationLabel] = useState('Finding your location…');
  const [mapReady, setMapReady] = useState(false);
  const [resultsVisible, setResultsVisible] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [providerResults, setProviderResults] = useState<Place[]>([]);
  const [providerStatus, setProviderStatus] = useState('Mock provider ready · 0 cost units');

  const query = useMemo<SearchQuery>(() => ({
    category,
    travelMode,
    maxMinutes,
    minimumRating,
    minimumReviews,
    openNow,
    openForMinutes,
  }), [category, travelMode, maxMinutes, minimumRating, minimumReviews, openNow, openForMinutes]);

  const { filtered: filteredResults } = useMemo(() => runQuery(mockPlaces, query, sortKey), [query, sortKey]);

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
      setMapRegion(nextRegion);
      setLocationAccuracy(current.coords.accuracy ?? null);
      setLocationReady(true);
      setLocationLabel('My current location');
      requestAnimationFrame(() => mapRef.current?.animateToRegion(nextRegion, 350));
    } catch {
      setLocationLabel('Could not read current location');
      setLocationReady(false);
      setLocationAccuracy(null);
    }
  };

  const recenterMap = () => {
    const nextRegion = toRegion(origin);
    setMapRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 300);
  };

  const runProviderSearch = async (nextSortKey: SortKey = sortKey, openModal = true) => {
    try {
      setProviderStatus('Running protected mock provider…');
      const result = await executeSearch(mockSearchProvider, query, nextSortKey);
      setProviderResults(result.places);
      setProviderStatus(`${result.provider} · ${result.costUnits} cost units · external call: no`);
      if (openModal) setResultsVisible(true);
    } catch (error) {
      setProviderResults([]);
      setProviderStatus(error instanceof Error ? error.message : 'Search blocked');
      if (openModal) setResultsVisible(true);
    }
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
              <Text style={styles.eyebrow}>STARTING FROM</Text>
              <Text style={styles.locationTitle}>📍 {locationLabel}</Text>
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
                <Chip key={item.label} label={`${item.emoji} ${item.label}`} active={category === item.label} onPress={() => setCategory(item.label)} />
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
                  <Text style={styles.modeEmoji}>{item.emoji}</Text>
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

            <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: openNow }} onPress={() => setOpenNow((value) => !value)} style={styles.toggleRow}>
              <View style={styles.toggleTextWrap}>
                <Text style={styles.filterLabel}>Open now</Text>
                <Text style={styles.filterHint}>Hide places that are currently closed</Text>
              </View>
              <View style={[styles.toggle, openNow && styles.toggleActive]}><View style={[styles.toggleKnob, openNow && styles.toggleKnobActive]} /></View>
            </TouchableOpacity>

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
              <Text style={styles.summaryMain}>{filteredResults.length} mock {filteredResults.length === 1 ? 'match' : 'matches'} · {category}</Text>
              <Text style={styles.summaryDetail} numberOfLines={2}>{querySummary(query)}</Text>
            </View>
            <TouchableOpacity style={styles.seeResultsButton} onPress={() => void runProviderSearch()}><Text style={styles.seeResultsButtonText}>See results</Text></TouchableOpacity>
          </View>

          <View style={styles.mockWarning}>
            <Text style={styles.mockWarningTitle}>Test results only</Text>
            <Text style={styles.mockWarningText}>These names are local placeholder data, not businesses found near your GPS position. Real Places search is still locked behind the cost gate.</Text>
          </View>

          <View style={styles.mapShell}>
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              mapType="standard"
              region={mapRegion}
              onRegionChangeComplete={setMapRegion}
              onMapReady={() => setMapReady(true)}
              showsUserLocation={locationReady}
              showsMyLocationButton={false}
              toolbarEnabled={false}
              cacheEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
            >
              {filteredResults.map((place) => {
                const coordinate = { latitude: origin.latitude + place.latitudeOffset, longitude: origin.longitude + place.longitudeOffset };
                const minutes = getTravelMinutes(place, travelMode);
                return (
                  <Marker key={place.id} coordinate={coordinate} anchor={{ x: 0.5, y: 1 }}>
                    <View style={styles.mapTimePin}><Text style={styles.mapTimePinText}>{minutes} min</Text></View>
                    <Callout onPress={() => setSelectedPlace(place)}>
                      <View style={styles.callout}>
                        <Text style={styles.calloutTitle}>{place.name} · MOCK</Text>
                        <Text style={styles.calloutText}>{place.rating.toFixed(1)} ★ · {place.reviewCount.toLocaleString()} reviews</Text>
                      </View>
                    </Callout>
                  </Marker>
                );
              })}
            </MapView>
            <View style={styles.mapBadge}><Text style={styles.mapBadgeText}>{mapReady ? 'MAP READY' : 'LOADING MAP'} · MOCK PLACES</Text></View>
            <TouchableOpacity style={styles.recenterButton} onPress={recenterMap}><Text style={styles.recenterText}>◎</Text></TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.largeResultsButton} onPress={() => void runProviderSearch()}>
            <Text style={styles.largeResultsButtonText}>See {filteredResults.length} mock {filteredResults.length === 1 ? 'result' : 'results'}</Text>
          </TouchableOpacity>

          <View style={styles.devNotice}>
            <Text style={styles.devNoticeTitle}>Protected prototype mode</Text>
            <Text style={styles.devNoticeText}>GPS is live. Query/filter logic is live. Place names and travel times remain mock data. Google Places is present only as a locked provider boundary; external APIs cannot run under the current zero-cost policy.</Text>
            <Text style={styles.devNoticeStatus}>{providerStatus}</Text>
          </View>
        </ScrollView>

        <Modal visible={resultsVisible} animationType="slide" onRequestClose={() => setResultsVisible(false)}>
          <SafeAreaView style={styles.modalSafeArea}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{category} results</Text>
                <Text style={styles.modalSubtitle}>{providerResults.length} mock places · not live nearby businesses</Text>
              </View>
              <TouchableOpacity onPress={() => setResultsVisible(false)}><Text style={styles.closeButton}>Close</Text></TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
              {sortOptions.map((option) => (
                <Chip key={option.key} label={option.label} active={sortKey === option.key} onPress={() => { setSortKey(option.key); void runProviderSearch(option.key, false); }} />
              ))}
            </ScrollView>

            <ScrollView contentContainerStyle={styles.resultsList}>
              {providerResults.length === 0 ? (
                <View style={styles.emptyState}><Text style={styles.emptyTitle}>No mock matches</Text><Text style={styles.emptyText}>Increase travel time or relax one of the filters.</Text></View>
              ) : providerResults.map((place) => (
                <TouchableOpacity key={place.id} style={styles.resultCard} onPress={() => setSelectedPlace(place)}>
                  <View style={styles.resultTopRow}>
                    <View style={styles.resultTitleWrap}>
                      <Text style={styles.travelTime}>{getTravelMinutes(place, travelMode)} min {modeLabel(travelMode)} · {formatDistance(place.distanceMeters)} · MOCK</Text>
                      <Text style={styles.placeName}>{place.name}</Text>
                    </View>
                    <View style={styles.ratingBadge}><Text style={styles.ratingBadgeText}>{place.rating.toFixed(1)} ★</Text></View>
                  </View>
                  <Text style={styles.placeMeta}>{place.reviewCount.toLocaleString()} reviews · {place.price} · Open for {Math.floor(place.closesInMinutes / 60)}h {place.closesInMinutes % 60}m</Text>
                  <Text style={styles.placeAddress}>{place.address}</Text>
                </TouchableOpacity>
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
                    <View style={styles.detailTitleWrap}><Text style={styles.detailTitle}>{selectedPlace.name}</Text><Text style={styles.detailSub}>MOCK PLACE · {selectedPlace.rating.toFixed(1)} ★ · {selectedPlace.reviewCount.toLocaleString()} reviews</Text></View>
                    <TouchableOpacity onPress={() => setSelectedPlace(null)}><Text style={styles.closeButton}>Close</Text></TouchableOpacity>
                  </View>
                  <Text style={styles.detailLead}>{getTravelMinutes(selectedPlace, travelMode)} min {modeLabel(travelMode)} · {formatDistance(selectedPlace.distanceMeters)}</Text>
                  <Text style={styles.detailLine}>📍 {selectedPlace.address}</Text>
                  <Text style={styles.detailLine}>🕒 Open for {Math.floor(selectedPlace.closesInMinutes / 60)}h {selectedPlace.closesInMinutes % 60}m</Text>
                  <Text style={styles.detailLine}>Placeholder details — no external lookup performed.</Text>
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
  safeArea: { flex: 1, backgroundColor: '#F7F7F5' },
  container: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 40, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTextWrap: { flex: 1, paddingRight: 12 },
  brand: { fontSize: 26, fontWeight: '800', color: '#171917', letterSpacing: -0.7 },
  tagline: { marginTop: 1, fontSize: 13, color: '#686D68' },
  profileDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E1E6E0' },
  locationCard: { minHeight: 68, borderRadius: 16, backgroundColor: '#FFFFFF', paddingHorizontal: 15, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E8EAE6' },
  locationTextWrap: { flex: 1, paddingRight: 12 },
  locationAction: { fontSize: 12, fontWeight: '800', color: '#28684A' },
  eyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: '#8A8F89' },
  locationTitle: { marginTop: 3, fontSize: 16, fontWeight: '700', color: '#212421' },
  locationDiagnostic: { marginTop: 3, fontSize: 10, color: '#6E756E' },
  sectionBlock: { gap: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#1B1D1B' },
  sectionValue: { fontSize: 13, fontWeight: '700', color: '#28684A' },
  horizontalRow: { gap: 7, paddingRight: 12 },
  compactRow: { gap: 7, paddingRight: 4 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#DADDD8', backgroundColor: '#FFFFFF' },
  chipActive: { backgroundColor: '#183C2C', borderColor: '#183C2C' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#3E433E' },
  chipTextActive: { color: '#FFFFFF' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeButton: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: '#DDE0DB', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  modeButtonActive: { backgroundColor: '#E4F3EA', borderColor: '#2A7651' },
  modeEmoji: { fontSize: 16 },
  modeText: { fontSize: 13, fontWeight: '700', color: '#454A45' },
  modeTextActive: { color: '#1D6846' },
  timeRow: { flexDirection: 'row', gap: 7 },
  timeButton: { flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDE0DB', alignItems: 'center', justifyContent: 'center' },
  timeButtonActive: { backgroundColor: '#DDF2E6', borderColor: '#2A7651' },
  timeButtonText: { fontSize: 19, fontWeight: '800', color: '#343834' },
  timeButtonUnit: { fontSize: 10, fontWeight: '700', color: '#777D77' },
  timeButtonTextActive: { color: '#1D6846' },
  filtersCard: { borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7E2', padding: 14, gap: 14 },
  filterBlock: { gap: 7 },
  filterLabel: { fontSize: 14, fontWeight: '800', color: '#272A27' },
  filterHint: { marginTop: 2, fontSize: 11, color: '#7A8079' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleTextWrap: { flex: 1 },
  toggle: { width: 46, height: 27, borderRadius: 14, padding: 3, backgroundColor: '#D4D7D3' },
  toggleActive: { backgroundColor: '#2D7A55' },
  toggleKnob: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#FFFFFF' },
  toggleKnobActive: { transform: [{ translateX: 19 }] },
  summaryBar: { borderRadius: 16, backgroundColor: '#183C2C', paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  summaryTextWrap: { flex: 1 },
  summaryMain: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  summaryDetail: { marginTop: 2, color: '#DDEBE4', fontSize: 11, lineHeight: 15, fontWeight: '600' },
  seeResultsButton: { borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 13, paddingVertical: 9 },
  seeResultsButtonText: { color: '#183C2C', fontSize: 12, fontWeight: '800' },
  mockWarning: { borderRadius: 14, backgroundColor: '#F2EEE3', borderWidth: 1, borderColor: '#DCCFAE', padding: 12 },
  mockWarningTitle: { fontSize: 12, fontWeight: '800', color: '#6A592D' },
  mockWarningText: { marginTop: 3, fontSize: 11, lineHeight: 16, color: '#75663D' },
  mapShell: { height: 260, borderRadius: 22, overflow: 'hidden', backgroundColor: '#DDE5DD', position: 'relative' },
  map: { ...StyleSheet.absoluteFillObject },
  mapBadge: { position: 'absolute', top: 12, left: 12, borderRadius: 999, backgroundColor: '#183C2C', paddingHorizontal: 10, paddingVertical: 6 },
  mapBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  recenterButton: { position: 'absolute', top: 12, right: 12, width: 42, height: 42, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D7DCD6' },
  recenterText: { fontSize: 25, color: '#48604F' },
  mapTimePin: { borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#1D6846', paddingHorizontal: 9, paddingVertical: 6 },
  mapTimePinText: { color: '#1D6846', fontSize: 11, fontWeight: '800' },
  callout: { minWidth: 160, padding: 8 },
  calloutTitle: { fontSize: 14, fontWeight: '800', color: '#1C1F1C' },
  calloutText: { marginTop: 3, fontSize: 11, color: '#6F756F' },
  largeResultsButton: { minHeight: 48, borderRadius: 14, backgroundColor: '#183C2C', alignItems: 'center', justifyContent: 'center' },
  largeResultsButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  devNotice: { borderRadius: 16, backgroundColor: '#FFF6E3', padding: 13, borderWidth: 1, borderColor: '#E9D4A5' },
  devNoticeTitle: { fontSize: 12, fontWeight: '800', color: '#765F2E' },
  devNoticeText: { marginTop: 2, fontSize: 11, lineHeight: 16, color: '#765F2E' },
  devNoticeStatus: { marginTop: 7, fontSize: 10, fontWeight: '800', color: '#765F2E' },
  modalSafeArea: { flex: 1, backgroundColor: '#F7F7F5' },
  modalHeader: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 26, fontWeight: '800', color: '#171917' },
  modalSubtitle: { marginTop: 2, fontSize: 12, color: '#737873' },
  closeButton: { color: '#28684A', fontSize: 13, fontWeight: '800' },
  sortRow: { paddingHorizontal: 18, paddingVertical: 8, gap: 7 },
  resultsList: { padding: 18, gap: 10, paddingBottom: 40 },
  emptyState: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 16, borderWidth: 1, borderColor: '#E4E7E2' },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#262926' },
  emptyText: { marginTop: 3, fontSize: 12, color: '#767C76' },
  resultCard: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 14, borderWidth: 1, borderColor: '#E4E7E2', gap: 8 },
  resultTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  resultTitleWrap: { flex: 1 },
  travelTime: { fontSize: 12, fontWeight: '800', color: '#25704D' },
  placeName: { marginTop: 2, fontSize: 18, fontWeight: '800', color: '#1C1F1C' },
  ratingBadge: { borderRadius: 999, backgroundColor: '#EEF4EF', paddingHorizontal: 10, paddingVertical: 6 },
  ratingBadgeText: { fontSize: 12, fontWeight: '800', color: '#234C37' },
  placeMeta: { fontSize: 12, lineHeight: 17, color: '#737873' },
  placeAddress: { fontSize: 12, color: '#515751' },
  detailBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end' },
  detailSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28, gap: 12 },
  detailHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: '#D5D8D4', marginBottom: 2 },
  detailHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  detailTitleWrap: { flex: 1 },
  detailTitle: { fontSize: 24, fontWeight: '800', color: '#171917' },
  detailSub: { marginTop: 3, fontSize: 12, color: '#6F756F' },
  detailLead: { fontSize: 14, fontWeight: '800', color: '#25704D' },
  detailLine: { fontSize: 13, color: '#424742' },
});
