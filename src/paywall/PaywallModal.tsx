import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { LAUNCH_PRODUCTS, type LaunchProduct } from '../purchases/catalog';

export function PaywallModal({
  visible,
  busyProductId,
  errorMessage,
  onClose,
  onPurchase,
}: {
  visible: boolean;
  busyProductId?: string | null;
  errorMessage?: string | null;
  onClose: () => void;
  onPurchase: (product: LaunchProduct) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>CONTINUE WITH NEARTIME</Text>
            <Text style={styles.title}>Choose what fits this trip.</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            Your free searches are used. Pick a short Trip Pass or Monthly access to keep searching with the same filters and live travel-time checks.
          </Text>

          {LAUNCH_PRODUCTS.map((product) => {
            const busy = busyProductId === product.id;
            return (
              <View key={product.id} style={[styles.card, product.badge && styles.featuredCard]}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle}>{product.title}</Text>
                    {product.badge ? <Text style={styles.badge}>{product.badge}</Text> : null}
                  </View>
                  <Text style={styles.price}>{product.priceNok} kr</Text>
                </View>
                <Text style={styles.subtitle}>{product.subtitle}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={Boolean(busyProductId)}
                  onPress={() => onPurchase(product)}
                  style={[styles.buyButton, Boolean(busyProductId) && styles.buyButtonDisabled]}
                >
                  <Text style={styles.buyText}>{busy ? 'Opening store…' : `Choose ${product.title}`}</Text>
                </TouchableOpacity>
              </View>
            );
          })}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <Text style={styles.footnote}>
            Trip Passes start when the purchase is activated. Monthly renews through the app store until cancelled. Purchases are verified by NearTime before search access is granted.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F3EE', paddingTop: 24 },
  header: { paddingHorizontal: 22, paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: '#6B645C', marginBottom: 6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: '#061B36', maxWidth: 270 },
  closeButton: { paddingVertical: 8, paddingHorizontal: 10 },
  closeText: { fontSize: 15, fontWeight: '700', color: '#061B36' },
  content: { paddingHorizontal: 22, paddingBottom: 40 },
  intro: { fontSize: 16, lineHeight: 23, color: '#423D37', marginBottom: 18 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#D9D3CC' },
  featuredCard: { borderWidth: 2, borderColor: '#B46A22' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontSize: 19, fontWeight: '800', color: '#061B36' },
  badge: { alignSelf: 'flex-start', marginTop: 6, fontSize: 11, fontWeight: '800', color: '#8A4E16', backgroundColor: '#F4E3D2', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  price: { fontSize: 19, fontWeight: '800', color: '#061B36' },
  subtitle: { marginTop: 9, fontSize: 14, lineHeight: 20, color: '#5F5850' },
  buyButton: { marginTop: 16, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, backgroundColor: '#061B36', alignItems: 'center' },
  buyButtonDisabled: { opacity: 0.55 },
  buyText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  errorText: { marginTop: 4, marginBottom: 12, fontSize: 14, lineHeight: 20, color: '#8A2D22' },
  footnote: { marginTop: 6, fontSize: 12, lineHeight: 18, color: '#6B645C' },
});
