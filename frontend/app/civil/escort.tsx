import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Constants from 'expo-constants';
import { getAuthToken, getUserMetadata, clearAuthData } from '../../utils/auth';

const BACKEND_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || 'https://ongoing-dev-22.preview.emergentagent.com';

export default function Escort() {
  const router = useRouter();
  const [isTracking, setIsTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);
  const [isPremium, setIsPremium] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const intervalRef = useRef<any>(null);

  // Check for active escort on every page focus
  useFocusEffect(
    useCallback(() => {
      checkActiveEscort();
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }, [])
  );

  const checkActiveEscort = async () => {
    setCheckingPremium(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }

      // Check local storage for active escort
      const storedEscort = await AsyncStorage.getItem('active_escort');
      if (storedEscort) {
        const escortData = JSON.parse(storedEscort);
        setIsTracking(true);
        setSessionId(escortData.session_id);
        setStartTime(escortData.started_at);
        startLocationTracking(token);
      }

      // Verify premium status
      const metadata = await getUserMetadata();
      if (metadata.isPremium) {
        setIsPremium(true);
      } else {
        // Verify with backend
        const response = await axios.get(`${BACKEND_URL}/api/user/profile`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000
        });
        const premium = response.data?.is_premium === true;
        setIsPremium(premium);
        
        if (!premium && !storedEscort) {
          Alert.alert(
            'Premium Feature',
            'Security Escort is a premium feature. Would you like to upgrade?',
            [
              { text: 'Go Back', onPress: () => router.back() },
              { text: 'Upgrade', onPress: () => router.replace('/premium') }
            ]
          );
        }
      }
    } catch (error: any) {
      console.error('[Escort] Error:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      }
    } finally {
      setCheckingPremium(false);
    }
  };

  const startEscort = async () => {
    if (!isPremium) {
      Alert.alert('Premium Required', 'Please upgrade to use Security Escort.');
      return;
    }

    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission required');
        setLoading(false);
        return;
      }

      await Location.requestBackgroundPermissionsAsync();

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.post(`${BACKEND_URL}/api/escort/action`, {
        action: 'start',
        location: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
          timestamp: new Date().toISOString()
        }
      }, { 
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000 
      });

      const newSessionId = response.data.session_id;
      const startedAt = new Date().toISOString();

      // Save to local storage for persistence
      await AsyncStorage.setItem('active_escort', JSON.stringify({
        session_id: newSessionId,
        started_at: startedAt
      }));

      setSessionId(newSessionId);
      setStartTime(startedAt);
      setIsTracking(true);
      startLocationTracking(token);
      
      Alert.alert('Success', 'Escort tracking started! Nearby security can now track your journey.');
    } catch (error: any) {
      console.error('[Escort] Start error:', error?.response?.data);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
        return;
      }
      let errorMessage = 'Failed to start escort';
      if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      }
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const startLocationTracking = async (token: string) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    
    intervalRef.current = setInterval(async () => {
      try {
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        await axios.post(`${BACKEND_URL}/api/escort/location`, {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
          timestamp: new Date().toISOString()
        }, { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000 
        });
        console.log('[Escort] Location tracked');
      } catch (error) {
        console.error('[Escort] Location tracking error:', error);
      }
    }, 30000);
  };

  const stopEscort = async () => {
    Alert.alert(
      'Arrived Safely?', 
      'Stopping will delete all tracking data.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, I Arrived', style: 'default', onPress: async () => {
          setLoading(true);
          try {
            if (intervalRef.current) clearInterval(intervalRef.current);
            
            const token = await getAuthToken();
            if (token) {
              await axios.post(`${BACKEND_URL}/api/escort/action`, {
                action: 'stop',
                location: { latitude: 0, longitude: 0, timestamp: new Date().toISOString() }
              }, { 
                headers: { Authorization: `Bearer ${token}` },
                timeout: 15000 
              });
            }

            // Clear local storage
            await AsyncStorage.removeItem('active_escort');

            setIsTracking(false);
            setSessionId(null);
            setStartTime(null);
            
            Alert.alert('Success', 'You arrived safely! Tracking data will be deleted.', [
              { text: 'OK', onPress: () => router.back() }
            ]);
          } catch (error) {
            Alert.alert('Error', 'Failed to stop escort');
          } finally {
            setLoading(false);
          }
        }}
      ]
    );
  };

  const formatElapsedTime = () => {
    if (!startTime) return '0:00';
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const seconds = Math.floor((now - start) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (checkingPremium) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading...</Text>
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
        <Text style={styles.title}>Security Escort</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        {isTracking ? (
          <View style={styles.trackingActive}>
            <View style={styles.pulseContainer}>
              <View style={styles.pulseOuter} />
              <View style={styles.pulseInner}>
                <Ionicons name="shield-checkmark" size={60} color="#10B981" />
              </View>
            </View>
            <Text style={styles.trackingTitle}>Escort Active</Text>
            <Text style={styles.trackingSubtitle}>Security can track your journey</Text>
            <Text style={styles.elapsedTime}>Duration: {formatElapsedTime()}</Text>

            <TouchableOpacity 
              style={styles.arrivedButton}
              onPress={stopEscort}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={24} color="#fff" />
                  <Text style={styles.arrivedButtonText}>I've Arrived Safely</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.startContainer}>
            <View style={styles.iconContainer}>
              <Ionicons name="walk" size={80} color="#3B82F6" />
            </View>
            <Text style={styles.mainTitle}>Security Escort</Text>
            <Text style={styles.description}>
              Enable tracking so nearby security personnel can monitor your journey and ensure your safety.
            </Text>

            <View style={styles.features}>
              <View style={styles.featureItem}>
                <Ionicons name="location" size={20} color="#10B981" />
                <Text style={styles.featureText}>Real-time location tracking</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="shield" size={20} color="#10B981" />
                <Text style={styles.featureText}>Security agents can view your route</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="trash" size={20} color="#10B981" />
                <Text style={styles.featureText}>Data deleted when you arrive</Text>
              </View>
            </View>

            <TouchableOpacity 
              style={styles.startButton}
              onPress={startEscort}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="play" size={24} color="#fff" />
                  <Text style={styles.startButtonText}>Start Escort</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 12 },
  content: { flex: 1, padding: 20 },
  startContainer: { flex: 1, alignItems: 'center', paddingTop: 40 },
  iconContainer: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  mainTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  description: { fontSize: 16, color: '#94A3B8', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  features: { width: '100%', backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 32 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  featureText: { fontSize: 14, color: '#fff' },
  startButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#3B82F6', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, width: '100%' },
  startButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  trackingActive: { flex: 1, alignItems: 'center', paddingTop: 40 },
  pulseContainer: { position: 'relative', width: 140, height: 140, marginBottom: 24, justifyContent: 'center', alignItems: 'center' },
  pulseOuter: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: '#10B98130' },
  pulseInner: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#10B98120', justifyContent: 'center', alignItems: 'center' },
  trackingTitle: { fontSize: 28, fontWeight: 'bold', color: '#10B981', marginBottom: 8 },
  trackingSubtitle: { fontSize: 16, color: '#94A3B8', marginBottom: 16 },
  elapsedTime: { fontSize: 20, color: '#fff', fontWeight: '600', marginBottom: 40 },
  arrivedButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#10B981', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, width: '100%' },
  arrivedButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
});
