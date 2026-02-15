import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
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

// Web fallback - shows manual coordinate input
export function NativeMap({ markerCoords, onMarkerChange }: NativeMapProps) {
  return (
    <View style={styles.webMapPlaceholder}>
      <Ionicons name="map" size={80} color="#64748B" />
      <Text style={styles.webMapText}>Interactive map available on mobile devices</Text>
      <Text style={styles.webSubText}>Use Expo Go or build APK to view the map</Text>
      <View style={styles.coordinatesBox}>
        <Text style={styles.coordinatesLabel}>Manual Location Entry:</Text>
        <TextInput
          style={styles.coordinateInput}
          placeholder="Latitude"
          placeholderTextColor="#64748B"
          value={String(markerCoords.latitude.toFixed(6))}
          onChangeText={(val) => onMarkerChange({ ...markerCoords, latitude: parseFloat(val) || 0 })}
          keyboardType="numeric"
        />
        <TextInput
          style={styles.coordinateInput}
          placeholder="Longitude"
          placeholderTextColor="#64748B"
          value={String(markerCoords.longitude.toFixed(6))}
          onChangeText={(val) => onMarkerChange({ ...markerCoords, longitude: parseFloat(val) || 0 })}
          keyboardType="numeric"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webMapPlaceholder: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 40, 
    backgroundColor: '#1E293B' 
  },
  webMapText: { 
    fontSize: 18, 
    color: '#94A3B8', 
    marginTop: 16, 
    textAlign: 'center',
    fontWeight: '600'
  },
  webSubText: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 8,
    textAlign: 'center'
  },
  coordinatesBox: { 
    marginTop: 32, 
    width: '100%', 
    maxWidth: 300,
    gap: 12 
  },
  coordinatesLabel: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: '#fff', 
    textAlign: 'center', 
    marginBottom: 8 
  },
  coordinateInput: { 
    backgroundColor: '#0F172A', 
    borderRadius: 8, 
    padding: 12, 
    color: '#fff', 
    fontSize: 16, 
    borderWidth: 1, 
    borderColor: '#334155', 
    textAlign: 'center' 
  },
});
