import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Modal, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Conditionally import MapView only on native platforms
let MapView: any = null;
let Marker: any = null;

if (Platform.OS !== 'web') {
  try {
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
  } catch (e) {
    console.log('Maps not available');
  }
}

interface LocationMapModalProps {
  visible: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  title?: string;
  subtitle?: string;
}

export function LocationMapModal({ visible, onClose, latitude, longitude, title, subtitle }: LocationMapModalProps) {
  const region = {
    latitude,
    longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{title || 'Location'}</Text>
            {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
          </View>
          <View style={styles.closeButton} />
        </View>

        {/* Map View */}
        {Platform.OS === 'web' ? (
          <View style={styles.webMapContainer}>
            <View style={styles.webMapPlaceholder}>
              <Ionicons name="location" size={60} color="#3B82F6" />
              <Text style={styles.coordsText}>
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </Text>
              <TouchableOpacity 
                style={styles.openMapsButton}
                onPress={() => {
                  const url = `https://www.google.com/maps?q=${latitude},${longitude}`;
                  if (typeof window !== 'undefined') {
                    window.open(url, '_blank');
                  }
                }}
              >
                <Ionicons name="open-outline" size={20} color="#fff" />
                <Text style={styles.openMapsText}>Open in Google Maps</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <MapView
            style={styles.map}
            initialRegion={region}
            showsUserLocation
            showsMyLocationButton
          >
            <Marker
              coordinate={{ latitude, longitude }}
              title={title || 'Location'}
              description={subtitle}
            >
              <View style={styles.markerContainer}>
                <Ionicons name="location" size={36} color="#EF4444" />
              </View>
            </Marker>
          </MapView>
        )}

        {/* Bottom Info */}
        <View style={styles.bottomInfo}>
          <View style={styles.coordsCard}>
            <Ionicons name="navigate" size={24} color="#3B82F6" />
            <View style={styles.coordsInfo}>
              <Text style={styles.coordsLabel}>Coordinates</Text>
              <Text style={styles.coordsValue}>{latitude.toFixed(6)}, {longitude.toFixed(6)}</Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Simple inline map for cards (non-modal)
export function InlineLocationMap({ latitude, longitude, height = 150 }: { latitude: number; longitude: number; height?: number }) {
  const region = {
    latitude,
    longitude,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.inlineMapPlaceholder, { height }]}>
        <Ionicons name="location" size={32} color="#3B82F6" />
        <Text style={styles.inlineCoords}>{latitude.toFixed(4)}, {longitude.toFixed(4)}</Text>
      </View>
    );
  }

  return (
    <MapView
      style={{ height, width: '100%', borderRadius: 8 }}
      initialRegion={region}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
    >
      <Marker coordinate={{ latitude, longitude }}>
        <Ionicons name="location" size={28} color="#EF4444" />
      </Marker>
    </MapView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 16,
    backgroundColor: '#1E293B',
  },
  closeButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  headerInfo: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: '#94A3B8', marginTop: 2 },
  map: { flex: 1 },
  webMapContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E293B' },
  webMapPlaceholder: { alignItems: 'center', padding: 40 },
  coordsText: { color: '#94A3B8', fontSize: 16, marginTop: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  openMapsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 24,
  },
  openMapsText: { color: '#fff', fontWeight: '600' },
  bottomInfo: { backgroundColor: '#1E293B', padding: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 16 },
  coordsCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0F172A', padding: 16, borderRadius: 12 },
  coordsInfo: { flex: 1 },
  coordsLabel: { color: '#64748B', fontSize: 12 },
  coordsValue: { color: '#fff', fontSize: 14, fontWeight: '500', marginTop: 2 },
  markerContainer: { alignItems: 'center', justifyContent: 'center' },
  inlineMapPlaceholder: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inlineCoords: { color: '#94A3B8', fontSize: 12, marginTop: 8 },
});
