import React from 'react';
import { View, StyleSheet, Platform, Text, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface NativeMapProps {
  region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  markerCoords: {
    latitude: number;
    longitude: number;
  };
  radiusKm: number;
  onPress: (coords: { latitude: number; longitude: number }) => void;
  onMarkerChange: (coords: { latitude: number; longitude: number }) => void;
}

// Map placeholder that works across all platforms
export function NativeMap({ region, markerCoords, radiusKm, onPress }: NativeMapProps) {
  const openInGoogleMaps = () => {
    const url = `https://www.google.com/maps?q=${markerCoords.latitude},${markerCoords.longitude}`;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.mapPlaceholder}>
        <Ionicons name="map" size={60} color="#3B82F6" />
        <Text style={styles.placeholderText}>Location Selected</Text>
        <Text style={styles.coordsText}>
          {markerCoords.latitude.toFixed(6)}, {markerCoords.longitude.toFixed(6)}
        </Text>
        <Text style={styles.radiusText}>Radius: {radiusKm} km</Text>
        
        <TouchableOpacity style={styles.openMapsButton} onPress={openInGoogleMaps}>
          <Ionicons name="open-outline" size={20} color="#fff" />
          <Text style={styles.openMapsText}>Open in Google Maps</Text>
        </TouchableOpacity>
        
        <Text style={styles.tapHint}>Tap anywhere in this area to update location</Text>
      </View>
      
      {/* Invisible touch layer for location selection */}
      <TouchableOpacity 
        style={StyleSheet.absoluteFill} 
        onPress={() => onPress(markerCoords)}
        activeOpacity={1}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1,
    backgroundColor: '#1E293B',
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  placeholderText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  coordsText: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  radiusText: {
    color: '#3B82F6',
    fontSize: 14,
    marginTop: 8,
    fontWeight: '500',
  },
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
  openMapsText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  tapHint: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },
});
