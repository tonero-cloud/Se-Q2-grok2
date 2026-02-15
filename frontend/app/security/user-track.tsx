import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

import { getAuthToken, clearAuthData } from '../../utils/auth';

import { BACKEND_URL } from '../../utils/api';

export default function UserTrack() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [trackData, setTrackData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    if (params.userData) {
      try {
        const parsed = JSON.parse(params.userData as string);
        setUserData(parsed);
        setTrackData(parsed);
      } catch (e) {
        console.error('[UserTrack] Failed to parse user data:', e);
      }
    }
    setLoading(false);

    // Auto-refresh every 30 seconds
    intervalRef.current = setInterval(() => {
      if (userData?.user_id) {
        refreshTrackData();
      }
    }, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [params.userData]);

  const refreshTrackData = async () => {
    if (!userData?.user_id) return;
    
    setRefreshing(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.get(
        `${BACKEND_URL}/api/security/track-user/${userData.user_id}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
      );
      setTrackData(response.data);
    } catch (error: any) {
      console.error('[UserTrack] Failed to refresh track data:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const openMaps = () => {
    if (!trackData?.latitude || !trackData?.longitude) {
      Alert.alert('No Location', 'User location not available');
      return;
    }

    const lat = trackData.latitude;
    const lng = trackData.longitude;
    const label = trackData.full_name || 'User';
    
    const url = Platform.select({
      ios: `maps:0,0?q=${label}@${lat},${lng}`,
      android: `geo:0,0?q=${lat},${lng}(${label})`
    });

    if (url) {
      Linking.openURL(url).catch(() => {
        // Fallback to Google Maps
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
      });
    }
  };

  const callUser = () => {
    if (trackData?.phone) {
      Linking.openURL(`tel:${trackData.phone}`);
    } else {
      Alert.alert('No Phone', 'User phone number not available');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#F59E0B" />
          <Text style={styles.loadingText}>Loading user data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!userData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Track User</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centerContent}>
          <Ionicons name="alert-circle" size={64} color="#EF4444" />
          <Text style={styles.errorText}>User data not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Track User</Text>
        <TouchableOpacity onPress={refreshTrackData}>
          {refreshing ? (
            <ActivityIndicator size="small" color="#F59E0B" />
          ) : (
            <Ionicons name="refresh" size={24} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* User Info Card */}
        <View style={styles.userCard}>
          <View style={styles.userAvatar}>
            <Ionicons name="person" size={40} color="#F59E0B" />
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{trackData?.full_name || trackData?.email || 'Unknown User'}</Text>
            <Text style={styles.userEmail}>{trackData?.email || ''}</Text>
            {trackData?.phone && (
              <Text style={styles.userPhone}>{trackData.phone}</Text>
            )}
          </View>
        </View>

        {/* Location Card */}
        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <Ionicons name="location" size={24} color="#10B981" />
            <Text style={styles.locationTitle}>Current Location</Text>
          </View>
          
          {trackData?.latitude && trackData?.longitude ? (
            <>
              <Text style={styles.coordinates}>
                {trackData.latitude.toFixed(6)}, {trackData.longitude.toFixed(6)}
              </Text>
              {trackData?.last_update && (
                <Text style={styles.lastUpdate}>
                  Last update: {new Date(trackData.last_update).toLocaleString()}
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.noLocation}>Location not available</Text>
          )}
        </View>

        {/* Status Card */}
        {trackData?.is_active !== undefined && (
          <View style={[styles.statusCard, trackData.is_active ? styles.activeCard : styles.inactiveCard]}>
            <Ionicons 
              name={trackData.is_active ? "radio-button-on" : "radio-button-off"} 
              size={24} 
              color={trackData.is_active ? "#10B981" : "#64748B"} 
            />
            <Text style={[styles.statusText, { color: trackData.is_active ? "#10B981" : "#64748B" }]}>
              {trackData.is_active ? "Tracking Active" : "Tracking Inactive"}
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionButton} onPress={openMaps}>
            <Ionicons name="map" size={24} color="#fff" />
            <Text style={styles.actionText}>Open in Maps</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.actionButton, styles.callButton]} onPress={callUser}>
            <Ionicons name="call" size={24} color="#fff" />
            <Text style={styles.actionText}>Call User</Text>
          </TouchableOpacity>
        </View>

        {/* Auto-refresh indicator */}
        <View style={styles.refreshInfo}>
          <Ionicons name="sync" size={16} color="#64748B" />
          <Text style={styles.refreshText}>Auto-refreshes every 30 seconds</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  content: { flex: 1, padding: 20 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 16, color: '#94A3B8', marginTop: 16 },
  errorText: { fontSize: 18, color: '#EF4444', marginTop: 16 },
  backButton: { marginTop: 24, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#3B82F6', borderRadius: 8 },
  backButtonText: { fontSize: 16, color: '#fff', fontWeight: '600' },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 16 },
  userAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  userInfo: { flex: 1 },
  userName: { fontSize: 20, fontWeight: '600', color: '#fff' },
  userEmail: { fontSize: 14, color: '#94A3B8', marginTop: 4 },
  userPhone: { fontSize: 14, color: '#64748B', marginTop: 2 },
  locationCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 16 },
  locationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  locationTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  coordinates: { fontSize: 18, color: '#10B981', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  lastUpdate: { fontSize: 12, color: '#64748B', marginTop: 8 },
  noLocation: { fontSize: 16, color: '#64748B' },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 12, marginBottom: 16 },
  activeCard: { backgroundColor: '#10B98120' },
  inactiveCard: { backgroundColor: '#64748B20' },
  statusText: { fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3B82F6', paddingVertical: 16, borderRadius: 12 },
  callButton: { backgroundColor: '#10B981' },
  actionText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  refreshInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 },
  refreshText: { fontSize: 12, color: '#64748B' },
});
