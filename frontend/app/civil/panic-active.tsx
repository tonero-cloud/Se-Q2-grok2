import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, AppState, BackHandler, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import EmergencyCategoryModal from '../../components/EmergencyCategoryModal';
import { getAuthToken, clearAuthData } from '../../utils/auth';

import { BACKEND_URL } from '../../utils/api';
const LOCATION_TASK = 'background-location-panic';

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[PanicActive] Background location error:', error);
    return;
  }
  if (data) {
    const { locations } = data as any;
    const location = locations[0];
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (token) {
        await axios.post(`${BACKEND_URL}/api/panic/location`, {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
          timestamp: new Date().toISOString()
        }, { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000 
        });
      }
    } catch (err) {
      console.error('[PanicActive] Failed to send panic location:', err);
    }
  }
});

const EMERGENCY_SERVICES = {
  ambulance: [
    { name: 'National Emergency', number: '112' },
    { name: 'Ambulance Service', number: '911' },
  ],
  fire: [
    { name: 'Fire Service', number: '101' },
    { name: 'Emergency', number: '112' },
  ]
};

const SECURITY_EMERGENCIES = ['violence', 'robbery', 'kidnapping', 'breakin', 'harassment', 'other'];

export default function PanicActive() {
  const router = useRouter();
  const [isTracking, setIsTracking] = useState(false);
  const [panicId, setPanicId] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showSafeButton, setShowSafeButton] = useState(false);
  const [showEmergencyContacts, setShowEmergencyContacts] = useState<'ambulance' | 'fire' | null>(null);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    checkActivePanic();
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Check for existing active panic on load
  const checkActivePanic = async () => {
    try {
      const activePanic = await AsyncStorage.getItem('active_panic');
      if (activePanic) {
        const panicData = JSON.parse(activePanic);
        setPanicId(panicData.id);
        setSelectedCategory(panicData.category);
        setIsTracking(true);
        setShowSafeButton(true);
        setShowCategoryModal(false);
        
        // Resume location tracking
        const token = await getAuthToken();
        if (token) {
          startLocationTracking(token);
        }
      }
    } catch (error) {
      console.error('[PanicActive] Error checking active panic:', error);
    }
  };

  const handleAppStateChange = (nextAppState: string) => {
    if (nextAppState === 'active' && isTracking) {
      setShowSafeButton(true);
    }
  };

  const startLocationTracking = async (token: string) => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(async () => {
      try {
        const location = await Location.getCurrentPositionAsync({ 
          accuracy: Location.Accuracy.High,
          timeout: 10000,
          maximumAge: 0
        }).catch(err => {
          console.warn('[Panic] Location fetch failed:', err);
          return null;
        });

        if (!location) return;

        await axios.post(`${BACKEND_URL}/api/panic/location`, {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
          timestamp: new Date().toISOString()
        }, { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 8000 
        });
      } catch (error) {
        console.error('[Panic] Tracking cycle error:', error);
      }
    }, 30000);
  };

  const handleCategorySelect = async (category: string) => {
    setSelectedCategory(category);
    setShowCategoryModal(false);

    try {
      let panicLocation = { latitude: 9.0820, longitude: 8.6753 }; // fallback
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            timeout: 8000,
          });
          panicLocation = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
        }
      } catch (err) {
        console.warn('[Panic] Initial location fetch failed:', err);
      }

      const token = await getAuthToken();
      if (!token) {
        Alert.alert('Error', 'Authentication required');
        router.replace('/auth/login');
        return;
      }

      const response = await axios.post(
        `${BACKEND_URL}/api/panic/create`,
        {
          category,
          latitude: panicLocation.latitude,
          longitude: panicLocation.longitude,
          timestamp: new Date().toISOString(),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000,
        }
      );

      const panicId = response.data?.id || response.data?.panic_id;
      if (!panicId) throw new Error('No panic ID returned');

      const panicData = {
        id: panicId,
        category,
        started_at: new Date().toISOString(),
      };
      await AsyncStorage.setItem('active_panic', JSON.stringify(panicData));

      setPanicId(panicId);
      setIsTracking(true);
      setShowSafeButton(true);

      startLocationTracking(token);

      if (category === 'medical') {
        setShowEmergencyContacts('ambulance');
      } else if (category === 'fire') {
        setShowEmergencyContacts('fire');
      } else if (SECURITY_EMERGENCIES.includes(category)) {
        Alert.alert('Security Notified', 'Nearby security personnel have been alerted.');
      }

    } catch (error: any) {
      console.error('[Panic] Activation failed:', error);
      Alert.alert('Panic Activation Failed', error?.response?.data?.detail || error.message);
      setShowCategoryModal(true); // reopen modal on failure
    }
  };

  const handleCategoryCancel = () => {
    setShowCategoryModal(false);
    router.back();
  };

  const markSafe = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      await axios.post(`${BACKEND_URL}/api/panic/deactivate`, {
        panic_id: panicId
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });

      await AsyncStorage.removeItem('active_panic');
      if (intervalRef.current) clearInterval(intervalRef.current);

      setIsTracking(false);
      setPanicId(null);
      setSelectedCategory(null);
      setShowSafeButton(false);

      Alert.alert('Deactivated', 'Panic mode deactivated successfully');
      router.back();
    } catch (error: any) {
      console.error('[Panic] Deactivation failed:', error);
      Alert.alert('Error', 'Failed to deactivate panic');
    }
  };

  const callContact = (number: string) => {
    Linking.openURL(`tel:${number}`);
  };

  const handleBackPress = () => {
    Alert.alert(
      'Exit App',
      'Are you sure you want to exit while panic is active?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => BackHandler.exitApp() },
      ]
    );
    return true;
  };

  useEffect(() => {
    if (isTracking) {
      BackHandler.addEventListener('hardwareBackPress', handleBackPress);
      return () => BackHandler.removeEventListener('hardwareBackPress', handleBackPress);
    }
  }, [isTracking]);

  if (showEmergencyContacts) {
    const contacts = EMERGENCY_SERVICES[showEmergencyContacts];
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emergencyContent}>
          <View style={[styles.emergencyIcon, { backgroundColor: showEmergencyContacts === 'ambulance' ? '#10B98120' : '#F59E0B20' }]}>
            <Ionicons 
              name={showEmergencyContacts === 'ambulance' ? 'medkit' : 'flame'} 
              size={64} 
              color={showEmergencyContacts === 'ambulance' ? '#10B981' : '#F59E0B'} 
            />
          </View>
          <Text style={styles.emergencyTitle}>
            {showEmergencyContacts === 'ambulance' ? 'Medical' : 'Fire'} Emergency Contacts
          </Text>
          <Text style={styles.emergencyDescription}>
            Call immediately for help. Your location is being tracked.
          </Text>

          {contacts.map((contact, index) => (
            <TouchableOpacity 
              key={index}
              style={styles.callButton}
              onPress={() => callContact(contact.number)}
            >
              <Ionicons name="call" size={28} color="#10B981" />
              <View style={styles.callInfo}>
                <Text style={styles.callName}>{contact.name}</Text>
                <Text style={styles.callNumber}>{contact.number}</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#64748B" />
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.backHomeButton} onPress={() => setShowEmergencyContacts(null)}>
            <Text style={styles.backHomeText}>Back to Panic Screen</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (isTracking) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.trackingContent}>
          <View style={styles.trackingIcon}>
            <Ionicons name="radio" size={80} color="#EF4444" />
          </View>
          <Text style={styles.trackingTitle}>🚨 Panic Mode Active</Text>
          <Text style={styles.trackingSubtitle}>
            Your location is being tracked and shared with nearby security.
          </Text>
          <Text style={styles.trackingCategory}>
            Emergency: {selectedCategory?.toUpperCase()}
          </Text>

          <TouchableOpacity style={styles.safeButton} onPress={markSafe}>
            <Ionicons name="shield-checkmark" size={28} color="#fff" />
            <Text style={styles.safeButtonText}>I'm Safe Now</Text>
          </TouchableOpacity>

          <Text style={styles.safeNote}>
            Tap above when you are safe to stop tracking
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show category selection modal
  return (
    <SafeAreaView style={styles.container}>
      <EmergencyCategoryModal
        visible={showCategoryModal}
        onSelect={handleCategorySelect}
        onCancel={handleCategoryCancel}
      />
      
      {/* Show loading/activating state */}
      {!showCategoryModal && (
        <View style={styles.activatingContent}>
          <View style={styles.loadingIcon}>
            <Ionicons name="sync" size={60} color="#EF4444" />
          </View>
          <Text style={styles.activatingText}>Activating Panic Mode...</Text>
          <Text style={styles.activatingSubtext}>Notifying nearby security agencies</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  trackingContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  trackingIcon: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#EF444420', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  trackingTitle: { fontSize: 28, fontWeight: 'bold', color: '#EF4444', marginBottom: 12 },
  trackingSubtitle: { fontSize: 16, color: '#94A3B8', textAlign: 'center', marginBottom: 8, lineHeight: 24 },
  trackingCategory: { fontSize: 14, color: '#F59E0B', fontWeight: '600', marginBottom: 40 },
  safeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#10B981', paddingVertical: 18, paddingHorizontal: 40, borderRadius: 16, marginTop: 20 },
  safeButtonText: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  safeNote: { fontSize: 14, color: '#64748B', marginTop: 16, textAlign: 'center' },
  emergencyContent: { flex: 1, alignItems: 'center', padding: 20, paddingTop: 40 },
  emergencyIcon: { width: 120, height: 120, borderRadius: 60, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  emergencyTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  emergencyDescription: { fontSize: 16, color: '#94A3B8', textAlign: 'center', marginBottom: 32 },
  callButton: { flexDirection: 'row', alignItems: 'center', width: '100%', padding: 20, borderRadius: 16, marginBottom: 16 },
  callInfo: { marginLeft: 16 },
  callName: { fontSize: 18, fontWeight: '600', color: '#fff' },
  callNumber: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  backHomeButton: { marginTop: 32, paddingVertical: 16, paddingHorizontal: 32 },
  backHomeText: { fontSize: 16, color: '#64748B' },
  activatingContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingIcon: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#EF444420', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  activatingText: { fontSize: 24, fontWeight: 'bold', color: '#EF4444', marginBottom: 8 },
  activatingSubtext: { fontSize: 16, color: '#94A3B8' },
});
