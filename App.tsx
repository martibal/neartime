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

type Place = {
  id: string;
  name: string;
  category: Category;
  travelMinutes: number;
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

const mockPlaces: Place[] = [
  {
    id: '1',
    name: 'Osteria Centro',
    category: 'Restaurant',
    travelMinutes: 6,
    rating: 4.7,
    reviewCount: 842,
    price: '$$',
    open: true,
    closesInMinutes: 165,
  },
  {
    id: '2',
    name: 'Trattoria Verde',
    category: 'Restaurant',
    travelMinutes: 9,
    rating: 4.5,
    reviewCount: 1204,
    price: '$$',
    open: true,
    closesInMinutes: 240,
  },
  {
    id: '3',
    name: 'Corner Table',
    category: 'Restaurant',
    travelMinutes: 13,
    rating: 4.3,
    reviewCount: 311,
    price: '$',
    open: true,
    closesInMinutes: 95,
  },
  {
    id: '4',
    name: 'North Coffee',
    category: 'Cafe',
    travelMinutes: 4,
    rating: 4.6,
    reviewCount: 517,
    price: '$$',
    open: true,
    closesInMinutes: 140,
  },
  {
    id: '5',
    name: 'City Market',
    category: 'Grocery',
    travelMinutes: 7,
    rating: 4.2,
    reviewCount: 189,
    price: '$',
    open: true,
    closesInMinutes: 310,
  },
  {
    id: '6',
    name: 'Central Pharmacy',
    category: 'Pharmacy',
    travelMinutes: 8,
    rating: 4.4,
    reviewCount: 96,
    price: '$$',
    open: true,
    closesInMinutes: 75,
  },
  {
    id: '7',
    name: 'Station Garage',
    category: 'Parking',
    travelMinutes: 5,
    rating: 4.1,
    reviewCount: 273,
    price: '$$',
    open: true,
    closesInMinutes: 720,
  },
];

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
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

export default function App() {
  const [category, setCategory] = useState<Category>('Restaurant');
  const [maxMinutes, setMaxMinutes] = useState<TravelMinutes>(10);
  const [minimumRating, setMinimumRating] = useState(4.0);
  const [openNow, setOpenNow] = useState(true);

  const results = useMemo(
    () =>
      mockPlaces
        .filter((place) => place.category === category)
        .filter((place) => place.travelMinutes <= maxMinutes)
        .filter((place) => place.rating >= minimumRating)
        .filter((place) => !openNow || place.open)
        .sort((a, b) => a.travelMinutes - b.travelMinutes),
    [category, maxMinutes, minimumRating, openNow],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
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

        <Text style={styles.sectionTitle}>What do you need?</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalRow}
        >
          {categories.map((item) => (
            <Chip
              key={item.label}
              label={`${item.emoji} ${item.label}`}
              active={category === item.label}
              onPress={() => setCategory(item.label)}
            />
          ))}
        </ScrollView>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Maximum walking time</Text>
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
              <Text
                style={[
                  styles.timeButtonText,
                  maxMinutes === minutes && styles.timeButtonTextActive,
                ]}
              >
                {minutes}
              </Text>
              <Text
                style={[
                  styles.timeButtonUnit,
                  maxMinutes === minutes && styles.timeButtonTextActive,
                ]}
              >
                min
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.filtersCard}>
          <View style={styles.filterBlock}>
            <Text style={styles.filterLabel}>Minimum rating</Text>
            <View style={styles.ratingRow}>
              {[4.0, 4.3, 4.5, 4.7].map((rating) => (
                <Chip
                  key={rating}
                  label={`${rating.toFixed(1)} ★`}
                  active={minimumRating === rating}
                  onPress={() => setMinimumRating(rating)}
                />
              ))}
            </View>
          </View>

          <TouchableOpacity
            accessibilityRole="switch"
            accessibilityState={{ checked: openNow }}
            onPress={() => setOpenNow((value) => !value)}
            style={styles.toggleRow}
          >
            <View>
              <Text style={styles.filterLabel}>Open now</Text>
              <Text style={styles.filterHint}>Hide places that are currently closed</Text>
            </View>
            <View style={[styles.toggle, openNow && styles.toggleActive]}>
              <View style={[styles.toggleKnob, openNow && styles.toggleKnobActive]} />
            </View>
          </TouchableOpacity>
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
              <Text style={styles.mapPinText}>{place.travelMinutes} min</Text>
            </View>
          ))}
          <Text style={styles.mapHint}>Google Maps integration comes after the zero-cost UI test.</Text>
        </View>

        <View style={styles.resultsHeader}>
          <View>
            <Text style={styles.sectionTitle}>Matches</Text>
            <Text style={styles.resultsSubtext}>
              {results.length} {results.length === 1 ? 'place' : 'places'} fit your filters
            </Text>
          </View>
          <Text style={styles.sortLabel}>Shortest first</Text>
        </View>

        {results.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No matches yet</Text>
            <Text style={styles.emptyText}>Try increasing travel time or lowering the rating filter.</Text>
          </View>
        ) : (
          results.map((place) => (
            <View key={place.id} style={styles.resultCard}>
              <View style={styles.resultTopRow}>
                <View style={styles.resultTitleWrap}>
                  <Text style={styles.travelTime}>{place.travelMinutes} min walk</Text>
                  <Text style={styles.placeName}>{place.name}</Text>
                </View>
                <View style={styles.ratingBadge}>
                  <Text style={styles.ratingBadgeText}>{place.rating.toFixed(1)} ★</Text>
                </View>
              </View>

              <Text style={styles.placeMeta}>
                {place.reviewCount.toLocaleString()} reviews · {place.price} · Open for{' '}
                {Math.floor(place.closesInMinutes / 60)}h {place.closesInMinutes % 60}m
              </Text>

              <TouchableOpacity style={styles.directionsButton} accessibilityRole="button">
                <Text style={styles.directionsButtonText}>Show directions</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={styles.devNotice}>
          <Text style={styles.devNoticeTitle}>Prototype mode</Text>
          <Text style={styles.devNoticeText}>
            This version uses local mock places only. It cannot generate Google API charges.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F7F5',
  },
  container: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 48,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  brand: {
    fontSize: 29,
    fontWeight: '800',
    color: '#171917',
    letterSpacing: -0.8,
  },
  tagline: {
    marginTop: 3,
    fontSize: 14,
    color: '#686D68',
  },
  profileDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E1E6E0',
  },
  locationCard: {
    minHeight: 74,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 17,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E8EAE6',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#8A8F89',
  },
  locationTitle: {
    marginTop: 5,
    fontSize: 17,
    fontWeight: '700',
    color: '#212421',
  },
  chevron: {
    fontSize: 32,
    color: '#7A8079',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1B1D1B',
  },
  sectionValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#28684A',
  },
  horizontalRow: {
    gap: 9,
    paddingRight: 12,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#DADDD8',
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    backgroundColor: '#183C2C',
    borderColor: '#183C2C',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '650',
    color: '#3E433E',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 9,
  },
  timeButton: {
    flex: 1,
    minHeight: 64,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE0DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeButtonActive: {
    backgroundColor: '#DDF2E6',
    borderColor: '#2A7651',
  },
  timeButtonText: {
    fontSize: 21,
    fontWeight: '800',
    color: '#343834',
  },
  timeButtonUnit: {
    fontSize: 11,
    fontWeight: '700',
    color: '#777D77',
  },
  timeButtonTextActive: {
    color: '#1D6846',
  },
  filtersCard: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E7E2',
    padding: 16,
    gap: 18,
  },
  filterBlock: {
    gap: 10,
  },
  filterLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#272A27',
  },
  filterHint: {
    marginTop: 3,
    fontSize: 12,
    color: '#7A8079',
  },
  ratingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggle: {
    width: 49,
    height: 29,
    borderRadius: 15,
    padding: 3,
    backgroundColor: '#D4D7D3',
  },
  toggleActive: {
    backgroundColor: '#2D7A55',
  },
  toggleKnob: {
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  toggleKnobActive: {
    transform: [{ translateX: 20 }],
  },
  mapPlaceholder: {
    height: 245,
    borderRadius: 22,
    backgroundColor: '#E6ECE7',
    borderWidth: 1,
    borderColor: '#D5DDD7',
    overflow: 'hidden',
    padding: 15,
  },
  mapLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#68736B',
  },
  mapCenterDot: {
    position: 'absolute',
    left: '48%',
    top: '50%',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2567D8',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  mapPin: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#183C2C',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pinOne: {
    left: '18%',
    top: '28%',
  },
  pinTwo: {
    right: '18%',
    top: '38%',
  },
  pinThree: {
    left: '28%',
    bottom: '24%',
  },
  mapPinText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  mapHint: {
    position: 'absolute',
    left: 15,
    right: 15,
    bottom: 12,
    fontSize: 11,
    color: '#758078',
    textAlign: 'center',
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  resultsSubtext: {
    marginTop: 3,
    fontSize: 13,
    color: '#747A74',
  },
  sortLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#28684A',
  },
  resultCard: {
    borderRadius: 20,
    padding: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7E3',
    gap: 11,
  },
  resultTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  resultTitleWrap: {
    flex: 1,
  },
  travelTime: {
    fontSize: 13,
    fontWeight: '900',
    color: '#25704D',
  },
  placeName: {
    marginTop: 2,
    fontSize: 20,
    fontWeight: '800',
    color: '#1D201D',
  },
  ratingBadge: {
    borderRadius: 12,
    backgroundColor: '#F0F4EE',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  ratingBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#303530',
  },
  placeMeta: {
    fontSize: 13,
    lineHeight: 19,
    color: '#696F69',
  },
  directionsButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#183C2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionsButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  emptyState: {
    borderRadius: 20,
    padding: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7E3',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#252825',
  },
  emptyText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 19,
    color: '#727872',
    textAlign: 'center',
  },
  devNotice: {
    marginTop: 6,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#FFF8E8',
    borderWidth: 1,
    borderColor: '#EFE0B8',
  },
  devNoticeTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#6A5524',
  },
  devNoticeText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#765F2E',
  },
});
