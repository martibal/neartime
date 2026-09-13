import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Callout, Marker } from 'react-native-maps';

type Category = 'Restaurant' | 'Cafe' | 'Grocery' | 'Pharmacy' | 'Parking';
type TravelMinutes = 5 | 10 | 15 | 20;
type TravelMode = 'Walk' | 'Drive' | 'Bike';
type ReviewMinimum = 0 | 100 | 300 | 1000;
type OpenForMinutes = 0 | 60 | 120 | 180;
type Coordinate = { latitude: number; longitude: number };
type SortKey = 'time' | 'rating' | 'distance' | 'price' | 'reviews' | 'open';

type Place = {
  id: string;
  name: string;
  category: Category;
  walkMinutes: number;
  driveMinutes: number;
  bikeMinutes: number;
  distanceMeters: number;
  rating: number;
  reviewCount: number;
  priceLevel: number;
  price: string;
  open: boolean;
  closesInMinutes: number;
  address: string;
  phone: string;
  website: string;
  highlights: string[];
  latitudeOffset: number;
  longitudeOffset: number;
};

const DEFAULT_ORIGIN: Coordinate = { latitude: 59.9139, longitude: 10.7522 };

const categories: Array<{ label: Category; emoji: string }> = [
  { label: 'Restaurant', emoji: '🍽️' },
  { label: 'Cafe', emoji: '☕' },
  { label: 'Grocery', emoji: '🛒' },
  { label: 'Pharmacy', emoji: '💊' },
  { label: 'Parking', emoji: '🅿️' },
];

const travelOptions: TravelMinutes[] = [5, 10, 15, 20];
const travelModes: Array<{ label: TravelMode; emoji: string }> = [
  { label: 'Walk', emoji: '🚶' },
  { label: 'Drive', emoji: '🚗' },
  { label: 'Bike', emoji: '🚲' },
];
const reviewOptions: ReviewMinimum[] = [0, 100, 300, 1000];
const openForOptions: OpenForMinutes[] = [0, 60, 120, 180];
const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: 'time', label: 'Travel time' },
  { key: 'rating', label: 'Rating' },
  { key: 'distance', label: 'Distance' },
  { key: 'price', label: 'Price' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'open', label: 'Open longest' },
];

const mockPlaces: Place[] = [
  { id: '1', name: 'Osteria Centro', category: 'Restaurant', walkMinutes: 6, driveMinutes: 3, bikeMinutes: 3, distanceMeters: 430, rating: 4.7, reviewCount: 842, priceLevel: 2, price: '$$', open: true, closesInMinutes: 165, address: 'Centralgata 12', phone: '+47 22 11 22 33', website: 'osteriacentro.example', highlights: ['Dine-in', 'Reservations', 'Outdoor seating'], latitudeOffset: 0.0038, longitudeOffset: -0.0028 },
  { id: '2', name: 'Trattoria Verde', category: 'Restaurant', walkMinutes: 9, driveMinutes: 4, bikeMinutes: 5, distanceMeters: 690, rating: 4.5, reviewCount: 1204, priceLevel: 2, price: '$$', open: true, closesInMinutes: 240, address: 'Parkveien 8', phone: '+47 22 44 55 66', website: 'trattoriaverde.example', highlights: ['Vegetarian options', 'Takeout', 'Reservations'], latitudeOffset: -0.0048, longitudeOffset: 0.0038 },
  { id: '3', name: 'Corner Table', category: 'Restaurant', walkMinutes: 13, driveMinutes: 6, bikeMinutes: 7, distanceMeters: 980, rating: 4.3, reviewCount: 311, priceLevel: 1, price: '$', open: true, closesInMinutes: 95, address: 'Storgata 41', phone: '+47 22 77 88 99', website: 'cornertable.example', highlights: ['Casual', 'Takeout'], latitudeOffset: 0.0065, longitudeOffset: 0.0052 },
  { id: '4', name: 'North Coffee', category: 'Cafe', walkMinutes: 4, driveMinutes: 2, bikeMinutes: 2, distanceMeters: 280, rating: 4.6, reviewCount: 517, priceLevel: 2, price: '$$', open: true, closesInMinutes: 140, address: 'Kaffegata 3', phone: '+47 22 12 13 14', website: 'northcoffee.example', highlights: ['Coffee', 'Breakfast', 'Takeout'], latitudeOffset: 0.0022, longitudeOffset: 0.0018 },
  { id: '5', name: 'City Market', category: 'Grocery', walkMinutes: 7, driveMinutes: 3, bikeMinutes: 4, distanceMeters: 510, rating: 4.2, reviewCount: 189, priceLevel: 1, price: '$', open: true, closesInMinutes: 310, address: 'Torget 5', phone: '+47 22 90 90 90', website: 'citymarket.example', highlights: ['Groceries', 'Fresh food'], latitudeOffset: -0.0032, longitudeOffset: -0.0035 },
  { id: '6', name: 'Central Pharmacy', category: 'Pharmacy', walkMinutes: 8, driveMinutes: 4, bikeMinutes: 5, distanceMeters: 620, rating: 4.4, reviewCount: 96, priceLevel: 2, price: '$$', open: true, closesInMinutes: 75, address: 'Apotekveien 2', phone: '+47 22 66 77 88', website: 'centralpharmacy.example', highlights: ['Pharmacy', 'Health products'], latitudeOffset: 0.0044, longitudeOffset: 0.004 },
  { id: '7', name: 'Station Garage', category: 'Parking', walkMinutes: 12, driveMinutes: 5, bikeMinutes: 8, distanceMeters: 900, rating: 4.1, reviewCount: 273, priceLevel: 2, price: '$$', open: true, closesInMinutes: 720, address: 'Stasjonsplassen 1', phone: '+47 22 33 44 55', website: 'stationgarage.example', highlights: ['Covered parking', 'EV charging'], latitudeOffset: -0.005, longitudeOffset: 0.0012 },
];

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function getTravelMinutes(place: Place, mode: TravelMode) {
  if (mode === 'Drive') return place.driveMinutes;
  if (mode === 'Bike') return place.bikeMinutes;
  return place.walkMinutes;
}

function modeLabel(mode: TravelMode) {
  if (mode === 'Drive') return 'drive';
  if (mode === 'Bike') return 'bike';
  return 'walk';
}

function formatDistance(meters: number) {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

export default function App() {
  const mapRef = useRef<MapView | null>(null);
  const [category, setCategory] = useState<Category>('Restaurant');
  const [travelMode, setTravelMode] = useState<TravelMode>('Walk');
  const [maxMinutes, setMaxMinutes] = useState<TravelMinutes>(10);
  const [minimumRating, setMinimumRating] = useState(4.0);
  const [minimumReviews, setMinimumReviews] = useState<ReviewMinimum>(0);
  const [openNow, setOpenNow] = useState(true);
  const [openForMinutes, setOpenForMinutes] = useState<OpenForMinutes>(0);
  const [origin, setOrigin] = useState<Coordinate>(DEFAULT_ORIGIN);
  const [locationReady, setLocationReady] = useState(false);
  const [locationLabel, setLocationLabel] = useState('Finding your location…');
  const [resultsVisible, setResultsVisible] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('time');

  const requestCurrentLocation = async () => {
    try {
      setLocationLabel('Finding your location…');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationLabel('Location permission not granted');
        setLocationReady(false);
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const nextOrigin = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setOrigin(nextOrigin);
      setLocationReady(true);
      setLocationLabel('My current location');
      mapRef.current?.animateToRegion({ ...nextOrigin, latitudeDelta: 0.022, longitudeDelta: 0.022 }, 500);
    } catch {
      setLocationLabel('Could not read current location');
      setLocationReady(false);
    }
  };

  useEffect(() => {
    void requestCurrentLocation();
  }, []);

  const filteredResults = useMemo(
    () =>
      mockPlaces
        .filter((place) => place.category === category)
        .filter((place) => getTravelMinutes(place, travelMode) <= maxMinutes)
        .filter((place) => place.rating >= minimumRating)
        .filter((place) => place.reviewCount >= minimumReviews)
        .filter((place) => !openNow || place.open)
        .filter((place) => openForMinutes === 0 || place.closesInMinutes >= openForMinutes),
    [category, maxMinutes, minimumRating, minimumReviews, openNow, openForMinutes, travelMode],
  );

  const sortedResults = useMemo(() => {
    const copy = [...filteredResults];
    copy.sort((a, b) => {
      if (sortKey === 'rating') return b.rating - a.rating;
      if (sortKey === 'distance') return a.distanceMeters - b.distanceMeters;
      if (sortKey === 'price') return a.priceLevel - b.priceLevel;
      if (sortKey === 'reviews') return b.reviewCount - a.reviewCount;
      if (sortKey === 'open') return b.closesInMinutes - a.closesInMinutes;
      return getTravelMinutes(a, travelMode) - getTravelMinutes(b, travelMode);
    });
    return copy;
  }, [filteredResults, sortKey, travelMode]);

  return (
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

        <TouchableOpacity style={styles.locationCard} accessibilityRole="button" onPress={() => void requestCurrentLocation()}>
          <View style={styles.locationTextWrap}>
            <Text style={styles.eyebrow}>STARTING FROM</Text>
            <Text style={styles.locationTitle}>📍 {locationLabel}</Text>
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
            <View style={[styles.toggle, openNow && styles.toggleActive]}>
              <View style={[styles.toggleKnob, openNow && styles.toggleKnobActive]} />
            </View>
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
          <View>
            <Text style={styles.summaryMain}>{filteredResults.length} {filteredResults.length === 1 ? 'match' : 'matches'}</Text>
            <Text style={styles.summaryDetail}>{travelMode} · ≤ {maxMinutes} min · ≥ {minimumRating.toFixed(1)} ★</Text>
          </View>
          <TouchableOpacity style={styles.seeResultsButton} onPress={() => setResultsVisible(true)}>
            <Text style={styles.seeResultsButtonText}>See results</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.mapShell}>
          <MapView
            ref={mapRef}
            style={styles.map}
            mapType="standard"
            initialRegion={{ ...DEFAULT_ORIGIN, latitudeDelta: 0.022, longitudeDelta: 0.022 }}
            showsUserLocation={locationReady}
            showsMyLocationButton={locationReady}
            toolbarEnabled={false}
            loadingEnabled
            loadingBackgroundColor="#E9EEE8"
          >
            {filteredResults.map((place) => {
              const coordinate = { latitude: origin.latitude + place.latitudeOffset, longitude: origin.longitude + place.longitudeOffset };
              const minutes = getTravelMinutes(place, travelMode);
              return (
                <Marker key={place.id} coordinate={coordinate} anchor={{ x: 0.5, y: 1 }}>
                  <View style={styles.mapTimePin}><Text style={styles.mapTimePinText}>{minutes} min</Text></View>
                  <Callout onPress={() => setSelectedPlace(place)}>
                    <View style={styles.callout}>
                      <Text style={styles.calloutTitle}>{place.name}</Text>
                      <Text style={styles.calloutText}>{place.rating.toFixed(1)} ★ · {place.reviewCount.toLocaleString()} reviews</Text>
                    </View>
                  </Callout>
                </Marker>
              );
            })}
          </MapView>
          <View style={styles.mapBadge}><Text style={styles.mapBadgeText}>LIVE MAP · MOCK PLACES</Text></View>
        </View>

        <TouchableOpacity style={styles.largeResultsButton} onPress={() => setResultsVisible(true)}>
          <Text style={styles.largeResultsButtonText}>See {filteredResults.length} {filteredResults.length === 1 ? 'result' : 'results'}</Text>
        </TouchableOpacity>

        <View style={styles.devNotice}>
          <Text style={styles.devNoticeTitle}>Prototype mode</Text>
          <Text style={styles.devNoticeText}>Places and details are still mock data. No Google Places or Routes charges are possible in this build.</Text>
        </View>
      </ScrollView>

      <Modal visible={resultsVisible} animationType="slide" onRequestClose={() => setResultsVisible(false)}>
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Results</Text>
              <Text style={styles.modalSubtitle}>{filteredResults.length} places match your filters</Text>
            </View>
            <TouchableOpacity onPress={() => setResultsVisible(false)}><Text style={styles.closeButton}>Close</Text></TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
            {sortOptions.map((option) => (
              <Chip key={option.key} label={option.label} active={sortKey === option.key} onPress={() => setSortKey(option.key)} />
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={styles.resultsList}>
            {sortedResults.length === 0 ? (
              <View style={styles.emptyState}><Text style={styles.emptyTitle}>No matches</Text><Text style={styles.emptyText}>Increase travel time or relax one of the filters.</Text></View>
            ) : (
              sortedResults.map((place) => {
                const travelMinutes = getTravelMinutes(place, travelMode);
                return (
                  <TouchableOpacity key={place.id} style={styles.resultCard} onPress={() => setSelectedPlace(place)}>
                    <View style={styles.resultTopRow}>
                      <View style={styles.resultTitleWrap}>
                        <Text style={styles.travelTime}>{travelMinutes} min {modeLabel(travelMode)} · {formatDistance(place.distanceMeters)}</Text>
                        <Text style={styles.placeName}>{place.name}</Text>
                      </View>
                      <View style={styles.ratingBadge}><Text style={styles.ratingBadgeText}>{place.rating.toFixed(1)} ★</Text></View>
                    </View>
                    <Text style={styles.placeMeta}>{place.reviewCount.toLocaleString()} reviews · {place.price} · Open for {Math.floor(place.closesInMinutes / 60)}h {place.closesInMinutes % 60}m</Text>
                    <Text style={styles.placeAddress}>{place.address}</Text>
                  </TouchableOpacity>
                );
              })
            )}
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
                  <View style={styles.detailTitleWrap}>
                    <Text style={styles.detailTitle}>{selectedPlace.name}</Text>
                    <Text style={styles.detailSub}>{selectedPlace.rating.toFixed(1)} ★ · {selectedPlace.reviewCount.toLocaleString()} reviews · {selectedPlace.price}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedPlace(null)}><Text style={styles.closeButton}>Close</Text></TouchableOpacity>
                </View>
                <Text style={styles.detailLead}>{getTravelMinutes(selectedPlace, travelMode)} min {modeLabel(travelMode)} · {formatDistance(selectedPlace.distanceMeters)}</Text>
                <Text style={styles.detailLine}>📍 {selectedPlace.address}</Text>
                <Text style={styles.detailLine}>🕒 Open for {Math.floor(selectedPlace.closesInMinutes / 60)}h {selectedPlace.closesInMinutes % 60}m</Text>
                <Text style={styles.detailLine}>📞 {selectedPlace.phone}</Text>
                <Text style={styles.detailLine}>🌐 {selectedPlace.website}</Text>
                <View style={styles.highlightRow}>{selectedPlace.highlights.map((item) => <View key={item} style={styles.highlightPill}><Text style={styles.highlightText}>{item}</Text></View>)}</View>
                <TouchableOpacity style={styles.directionsButton}><Text style={styles.directionsButtonText}>Show directions</Text></TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
  locationCard: { minHeight: 60, borderRadius: 16, backgroundColor: '#FFFFFF', paddingHorizontal: 15, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E8EAE6' },
  locationTextWrap: { flex: 1, paddingRight: 12 },
  locationAction: { fontSize: 12, fontWeight: '800', color: '#28684A' },
  eyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: '#8A8F89' },
  locationTitle: { marginTop: 3, fontSize: 16, fontWeight: '700', color: '#212421' },
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
  summaryMain: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  summaryDetail: { marginTop: 2, color: '#DDEBE4', fontSize: 11, fontWeight: '600' },
  seeResultsButton: { borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 13, paddingVertical: 9 },
  seeResultsButtonText: { color: '#183C2C', fontSize: 12, fontWeight: '800' },
  mapShell: { height: 260, borderRadius: 22, overflow: 'hidden', backgroundColor: '#E9EEE8', position: 'relative' },
  map: { ...StyleSheet.absoluteFillObject },
  mapBadge: { position: 'absolute', top: 12, left: 12, borderRadius: 999, backgroundColor: '#183C2C', paddingHorizontal: 10, paddingVertical: 6 },
  mapBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
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
  modalSafeArea: { flex: 1, backgroundColor: '#F7F7F5' },
  modalHeader: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 26, fontWeight: '800', color: '#171917' },
  modalSubtitle: { marginTop: 2, fontSize: 13, color: '#737873' },
  closeButton: { fontSize: 14, fontWeight: '800', color: '#28684A' },
  sortRow: { gap: 7, paddingHorizontal: 18, paddingBottom: 12 },
  resultsList: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
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
  placeAddress: { fontSize: 12, color: '#4C514C' },
  detailBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.25)' },
  detailSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28, gap: 12 },
  detailHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: '#D4D7D3', alignSelf: 'center' },
  detailHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  detailTitleWrap: { flex: 1 },
  detailTitle: { fontSize: 23, fontWeight: '800', color: '#171917' },
  detailSub: { marginTop: 3, fontSize: 13, color: '#666C66' },
  detailLead: { fontSize: 14, fontWeight: '800', color: '#25704D' },
  detailLine: { fontSize: 14, color: '#383C38' },
  highlightRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  highlightPill: { borderRadius: 999, backgroundColor: '#EEF4EF', paddingHorizontal: 10, paddingVertical: 6 },
  highlightText: { fontSize: 11, fontWeight: '700', color: '#234C37' },
  directionsButton: { minHeight: 46, borderRadius: 13, backgroundColor: '#183C2C', alignItems: 'center', justifyContent: 'center' },
  directionsButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});