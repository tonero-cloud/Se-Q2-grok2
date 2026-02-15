import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import axios from 'axios';
import Slider from '@react-native-community/slider';

import { NativeMap } from '../../components/NativeMap';
import { getAuthToken, clearAuthData } from '../../utils/auth';

import { BACKEND_URL } from '../../utils/api';

export default function SetLocation() {
  const router = useRouter();
  const [region, setRegion] = useState({
    latitude: 9.0820,
    longitude: 8.6753,
    latitudeDelta: 0.5,
    longitudeDelta: 0.5,
  });
  const [markerCoords, setMarkerCoords] = useState({ latitude: 9.0820, longitude: 8.6753 });
  const [radiusKm, setRadiusKm] = useState(10);
  const [loading, setLoading] = useState(true); // Start with loading=true

  useEffect(() => {
    initializeLocation();
  }, []);

  const initializeLocation = async () => {
    setLoading(true);
    const token = await getAuthToken();
    if (!token) {
      router.replace('/auth/login');
      return;
    }
    // Load current location first (prioritized)
    await getCurrentLocation();
    // Then check for saved location (will override if exists)
    await loadSavedLocation();
    setLoading(false);
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const coords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setRegion({ ...coords, latitudeDelta: 0.5, longitudeDelta: 0.5 });
        setMarkerCoords(coords);
      }
    } catch (error) {
      console.error('[SetLocation] Failed to get location:', error);
    }
  };

  const loadSavedLocation = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      const response = await axios.get(`${BACKEND_URL}/api/security/team-location`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      console.log('[SetLocation] Saved location loaded:', response.data);
      if (response.data.latitude !== 0 && response.data.longitude !== 0) {
        const coords = { latitude: response.data.latitude, longitude: response.data.longitude };
        setMarkerCoords(coords);
        setRegion({ ...coords, latitudeDelta: 0.5, longitudeDelta: 0.5 });
        setRadiusKm(response.data.radius_km || 10);
      }
    } catch (error: any) {
      console.error('[SetLocation] Failed to load saved location:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    }
  };

  const saveTeamLocation = async () => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      console.log('[SetLocation] Saving location:', markerCoords, 'Radius:', radiusKm);
      
      const response = await axios.post(`${BACKEND_URL}/api/security/set-location`, {
        latitude: markerCoords.latitude,
        longitude: markerCoords.longitude,
        radius_km: radiusKm
      }, { 
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });

      console.log('[SetLocation] Location saved:', response.data);
      Alert.alert('Success', 'Team location updated successfully!', [
        { text: 'OK', onPress: () => router.replace('/security/home') }
      ]);
    } catch (error: any) {
      console.error('[SetLocation] Save location error:', error?.response?.data);
      let errorMsg = 'Failed to save location. Please try again.';
      if (error?.response?.status === 401) {
        Alert.alert('Session Expired', 'Please login again');
        await clearAuthData();
        router.replace('/auth/login');
        return;
      }
      if (error.response?.data?.detail) {
        errorMsg = error.response.data.detail;
      } else if (error.request) {
        errorMsg = 'Network error. Please check your connection.';
      }
      Alert.alert('Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/security/home")} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Set Team Location</Text>
        <View style={styles.placeholder} />
      </View>

      <NativeMap
        region={region}
        markerCoords={markerCoords}
        radiusKm={radiusKm}
        onPress={(coords) => setMarkerCoords(coords)}
        onMarkerChange={(coords) => setMarkerCoords(coords)}
      />

      <View style={styles.controls}>
        <View style={styles.coordinatesDisplay}>
          <Text style={styles.coordLabel}>Lat: {markerCoords.latitude.toFixed(4)}</Text>
          <Text style={styles.coordLabel}>Lng: {markerCoords.longitude.toFixed(4)}</Text>
        </View>
        
        <View style={styles.radiusControl}>
          <Text style={styles.radiusLabel}>Search Radius: {radiusKm}km</Text>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={50}
            step={1}
            value={radiusKm}
            onValueChange={setRadiusKm}
            minimumTrackTintColor="#3B82F6"
            maximumTrackTintColor="#334155"
            thumbTintColor="#3B82F6"
          />
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={saveTeamLocation} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="save" size={20} color="#fff" />
              <Text style={styles.saveButtonText}>Save Location</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.helpText}>
          {Platform.OS === 'web' 
            ? 'Enter coordinates manually or use the app on mobile for map selection.'
            : 'Tap on map to set location. Adjust radius to set coverage area.'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  placeholder: { width: 32 },
  controls: { backgroundColor: '#1E293B', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  coordinatesDisplay: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16, backgroundColor: '#0F172A', padding: 12, borderRadius: 8 },
  coordLabel: { fontSize: 14, color: '#94A3B8', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  radiusControl: { marginBottom: 20 },
  radiusLabel: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 12 },
  slider: { width: '100%', height: 40 },
  saveButton: { flexDirection: 'row', backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  saveButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  helpText: { fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
});
