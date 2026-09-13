import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type Category = 'Restaurant' | 'Cafe' | 'Grocery' | 'Pharmacy' | 'Parking';
type TravelMinutes = 5 | 10 | 15 | 20;
type TravelMode = 'Walk' | 'Drive' | 'Bike';
type ReviewMinimum = 0 | 100 | 300 | 1000;
type OpenForMinutes = 0 | 60 | 120 | 180;

type Place = {
  id: string;
  name: string;
  category: Category;
  walkMinutes: number;
  driveMinutes: number;
  bikeMinutes: number;
  rating: number;
  reviewCount: number;
  price: string;
  open: boolean;
  closesInMinutes: number;
};

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

const mockPlaces: Place[] = [
  { id: '1', name: 'Osteria Centro', category: 'Restaurant', walkMinutes: 6, driveMinutes: 3, bikeMinutes: 3, rating: 4.7, reviewCount: 842, price: '$$', open: true, closesInMinutes: 165 },
  { id: '2', name: 'Trattoria Verde', category: 'Restaurant', walkMinutes: 9, driveMinutes: 4, bikeMinutes: 5, rating: 4.5, reviewCount: 1204, price: '$$', open: true, closesInMinutes: 240 },
  { id: '3', name: 'Corner Table', category: 'Restaurant', walkMinutes: 13, driveMinutes: 6, bikeMinutes: 7, rating: 4.3, reviewCount: 311, price: '$', open: true, closesInMinutes: 95 },
  { id: '4', name: 'North Coffee', category: 'Cafe', walkMinutes: 4, driveMinutes: 2, bikeMinutes: 2, rating: 4.6, reviewCount: 517, price: '$$', open: true, closesInMinutes: 140 },
  { id: '5', name: 'City Market', category: 'Grocery', walkMinutes: 7, driveMinutes: 3, bikeMinutes: 4, rating: 4.2, reviewCount: 189, price: '$', open: true, closesInMinutes: 310 },
  { id: '6', name: 'Central Pharmacy', category: 'Pharmacy', walkMinutes: 8, driveMinutes: 4, bikeMinutes: 5, rating: 4.4, reviewCount: 96, price: '$$', open: true, closesInMinutes: 75 },
  { id: '7', name: 'Station Garage', category: 'Parking', walkMinutes: 12, driveMinutes: 5, bikeMinutes: 8, rating: 4.1, reviewCount: 273, price: '$$', open: true, closesInMinutes: 720 },
];

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
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

export default function App() {
  const [category, setCategory] = useState<Category>('Restaurant');
  const [travelMode, setTravelMode] = useState<TravelMode>('Walk');
  const [maxMinutes, setMaxMinutes] = useState<TravelMinutes>(10);
  const [minimumRating, setMinimumRating] = useState(4.0);
  const [minimumReviews, setMinimumReviews] = useState<ReviewMinimum>(0);
  const [openNow, setOpenNow] = useState(true);
  const [openForMinutes, setOpenForMinutes] = useState<OpenForMinutes>(0);

  const results = useMemo(
    () =>
      mockPlaces
        .filter((place) => place.category === category)
        .filter((place) => getTravelMinutes(place, travelMode) <= maxMinutes)
        .filter((place) => place.rating >= minimumRating)
        .filter((place) => place.reviewCount >= minimumReviews)
        .filter((place) => !openNow || place.open)
        .filter((place) => openForMinutes === 0 || place.closesInMinutes >= openForMinutes)
        .sort((a, b) => getTravelMinutes(a, travelMode) - getTravelMinutes(b, travelMode)),
    [category, maxMinutes, minimumRating, minimumReviews, openNow, openForMinutes, travelMode],
  );

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

        <TouchableOpacity style={styles.locationCard} accessibilityRole="button">
          <View>
            <Text style={styles.eyebrow}>STARTING FROM</Text>
            <Text style={styles.locationTitle}>📍 My current location</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>What do you need?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalRow}>
            {categories.map((item) => (
              <Chip
                key={item.label}
                label={`${item.emoji} ${item.label}`}
                active={category === item.label}
                onPress={() => setCategory(item.label)}
              />
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
              <TouchableOpacity
                key={item.label}
                accessibilityRole="button"
                accessibilityState={{ selected: travelMode === item.label }}
                onPress={() => setTravelMode(item.label)}
                style={[styles.modeButton, travelMode === item.label && styles.modeButtonActive]}
              >
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
              <TouchableOpacity
                key={minutes}
                accessibilityRole="button"
                accessibilityState={{ selected: maxMinutes === minutes }}
                onPress={() => setMaxMinutes(minutes)}
                style={[styles.timeButton, maxMinutes === minutes && styles.timeButtonActive]}
              >
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
                <Chip
                  key={reviews}
                  label={reviews === 0 ? 'Any' : `${reviews.toLocaleString()}+`}
                  active={minimumReviews === reviews}
                  onPress={() => setMinimumReviews(reviews)}
                />
              ))}
            </ScrollView>
          </View>

          <TouchableOpacity
            accessibilityRole="switch"
            accessibilityState={{ checked: openNow }}
            onPress={() => setOpenNow((value) => !value)}
            style={styles.toggleRow}
          >
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
                <Chip
                  key={minutes}
                  label={minutes === 0 ? 'Any time' : `${minutes / 60}h+`}
                  active={openForMinutes === minutes}
                  onPress={() => setOpenForMinutes(minutes)}
                />
              ))}
            </ScrollView>
          </View>
        </View>

        <View style={styles.summaryBar}>
          <Text style={styles.summaryMain}>{results.length} {results.length === 1 ? 'match' : 'matches'}</Text>
          <Text style={styles.summaryDetail}>{travelMode} · ≤ {maxMinutes} min · ≥ {minimumRating.toFixed(1)} ★</Text>
        </View>

        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapLabel}>MAP PREVIEW</Text>
          <View style={styles.mapCenterDot} />
          {results.slice(0, 3).map((place, index) => (
            <View
              key={place.id}
              style={[
                styles.mapPin,
                index === 0 && styles.pinOne,
                index === 1 && styles.pinTwo,
                index === 2 && styles.pinThree,
              ]}
            >
              <Text style={styles.mapPinText}>{getTravelMinutes(place, travelMode)} min</Text>
            </View>
          ))}
          <Text style={styles.mapHint}>Mock map only — no Google API calls.</Text>
        </View>

        <View style={styles.resultsHeader}>
          <View>
            <Text style={styles.sectionTitle}>Matches</Text>
            <Text style={styles.resultsSubtext}>Shortest {modeLabel(travelMode)} time first</Text>
          </View>
        </View>

        {results.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyText}>Increase travel time or relax one of the filters.</Text>
          </View>
        ) : (
          results.map((place) => {
            const travelMinutes = getTravelMinutes(place, travelMode);
            return (
              <View key={place.id} style={styles.resultCard}>
                <View style={styles.resultTopRow}>
                  <View style={styles.resultTitleWrap}>
                    <Text style={styles.travelTime}>{travelMinutes} min {modeLabel(travelMode)}</Text>
                    <Text style={styles.placeName}>{place.name}</Text>
                  </View>
                  <View style={styles.ratingBadge}>
                    <Text style={styles.ratingBadgeText}>{place.rating.toFixed(1)} ★</Text>
                  </View>
                </View>
                <Text style={styles.placeMeta}>
                  {place.reviewCount.toLocaleString()} reviews · {place.price} · Open for {Math.floor(place.closesInMinutes / 60)}h {place.closesInMinutes % 60}m
                </Text>
                <TouchableOpacity style={styles.directionsButton} accessibilityRole="button">
                  <Text style={styles.directionsButtonText}>Show directions</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}

        <View style={styles.devNotice}>
          <Text style={styles.devNoticeTitle}>Prototype mode</Text>
          <Text style={styles.devNoticeText}>Local mock data only. This build cannot generate Google API charges.</Text>
        </View>
      </ScrollView>
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
  eyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: '#8A8F89' },
  locationTitle: { marginTop: 3, fontSize: 16, fontWeight: '700', color: '#212421' },
  chevron: { fontSize: 28, color: '#7A8079' },
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
  summaryBar: { borderRadius: 14, backgroundColor: '#183C2C', paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  summaryMain: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  summaryDetail: { color: '#DDEBE4', fontSize: 11, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  mapPlaceholder: { height: 190, borderRadius: 20, backgroundColor: '#E9EEE8', overflow: 'hidden', padding: 14, position: 'relative' },
  mapLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: '#667067' },
  mapCenterDot: { position: 'absolute', left: '48%', top: '45%', width: 14, height: 14, borderRadius: 7, backgroundColor: '#18422F', borderWidth: 3, borderColor: '#FFFFFF' },
  mapPin: { position: 'absolute', backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1, borderColor: '#B9C5BA' },
  pinOne: { left: 28, top: 66 },
  pinTwo: { right: 30, top: 86 },
  pinThree: { left: 110, bottom: 42 },
  mapPinText: { fontSize: 11, fontWeight: '800', color: '#1D6846' },
  mapHint: { position: 'absolute', left: 14, right: 14, bottom: 10, fontSize: 10, color: '#6C746D' },
  resultsHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  resultsSubtext: { marginTop: 2, fontSize: 12, color: '#737873' },
  emptyState: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 16, borderWidth: 1, borderColor: '#E4E7E2' },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#262926' },
  emptyText: { marginTop: 3, fontSize: 12, color: '#767C76' },
  resultCard: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 14, borderWidth: 1, borderColor: '#E4E7E2', gap: 9 },
  resultTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  resultTitleWrap: { flex: 1 },
  travelTime: { fontSize: 12, fontWeight: '800', color: '#25704D' },
  placeName: { marginTop: 2, fontSize: 18, fontWeight: '800', color: '#1C1F1C' },
  ratingBadge: { borderRadius: 999, backgroundColor: '#EEF4EF', paddingHorizontal: 10, paddingVertical: 6 },
  ratingBadgeText: { fontSize: 12, fontWeight: '800', color: '#234C37' },
  placeMeta: { fontSize: 12, lineHeight: 17, color: '#737873' },
  directionsButton: { minHeight: 40, borderRadius: 12, backgroundColor: '#183C2C', alignItems: 'center', justifyContent: 'center' },
  directionsButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  devNotice: { borderRadius: 16, backgroundColor: '#FFF6E3', padding: 13, borderWidth: 1, borderColor: '#E9D4A5' },
  devNoticeTitle: { fontSize: 12, fontWeight: '800', color: '#765F2E' },
  devNoticeText: { marginTop: 2, fontSize: 11, lineHeight: 16, color: '#765F2E' },
});
