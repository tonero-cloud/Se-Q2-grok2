import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  AppState,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Constants from 'expo-constants';
import { getAuthToken, clearAuthData } from '../../utils/auth';

const BACKEND_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || 'https://ongoing-dev-22.preview.emergentagent.com';
const LOCATION_TASK_NAME = 'background-location-task';

// Define the background location task - Uses AsyncStorage directly (can't use SecureStore in background)
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[PanicActive] Background location error:', error);
    return;
  }
  if (data) {
    const { locations } = data as any;
    const location = locations[0];
    
    // Send location to backend
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (token) {
        await axios.post(
          `${BACKEND_URL}/api/panic/location`,
          {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
            timestamp: new Date().toISOString(),
          },
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15000
          }
        );
      }
    } catch (err) {
      console.error('[PanicActive] Failed to send location:', err);
    }
  }
});

export default function PanicActive() {
  const router = useRouter();
  const [isTracking, setIsTracking] = useState(false);
  const [panicId, setPanicId] = useState<string | null>(null);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    activatePanicMode();
    
    // Monitor app state to hide app when it comes back from background
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleAppStateChange = (nextAppState: string) => {
    if (nextAppState === 'active' && isTracking) {
      // When app becomes active again during panic mode, go back to sleep screen
      // This simulates hiding the app
      Alert.alert(
        'Panic Mode Active',
        'Your location is being tracked. The app will remain hidden.',
        [
          {
            text: 'Continue Tracking',
            onPress: () => {}
          },
          {
            text: 'Stop Panic Mode',
            style: 'destructive',
            onPress: deactivatePanicMode
          }
        ]
      );
    }
  };

  const activatePanicMode = async () => {
    try {
      // Request location permissions
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for panic mode');
        router.back();
        return;
      }

      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        Alert.alert('Permission Denied', 'Background location permission is required');
      }

      // Activate panic in backend
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.post(
        `${BACKEND_URL}/api/panic/activate`,
        { activated: true },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );

      setPanicId(response.data.panic_id);
      setIsTracking(true);

      // Start location tracking (every 30 seconds)
      startLocationTracking(token!);

      Alert.alert(
        'Panic Mode Activated',
        'Your location is being tracked and sent to authorities. Phone will now go to sleep.',
        [
          {
            text: 'OK',
            onPress: () => {
              // In a real app, you would trigger phone sleep here
              // For now, we'll just minimize the importance of this screen
            }
          }
        ]
      );
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
        return;
      }
      Alert.alert('Error', 'Failed to activate panic mode');
      console.error('[PanicActive] Error:', error);
      router.back();
    }
  };

  const startLocationTracking = async (token: string) => {
    // Send location every 30 seconds
    intervalRef.current = setInterval(async () => {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        await axios.post(
          `${BACKEND_URL}/api/panic/location`,
          {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
            timestamp: new Date().toISOString(),
          },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
        );
      } catch (error) {
        console.error('[PanicActive] Location tracking error:', error);
      }
    }, 30000); // 30 seconds

    // Also start background location tracking
    try {
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.High,
        timeInterval: 30000,
        distanceInterval: 0,
        foregroundService: {
          notificationTitle: 'SafeGuard Active',
          notificationBody: 'Location tracking in progress',
        },
      });
    } catch (bgError) {
      console.log('[PanicActive] Background tracking not available:', bgError);
    }
  };

  const deactivatePanicMode = async () => {
    try {
      const token = await getAuthToken();
      
      // Stop location tracking
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      try {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      } catch (stopError) {
        console.log('[PanicActive] Background tracking stop error:', stopError);
      }

      // Deactivate in backend
      if (token) {
        await axios.post(
          `${BACKEND_URL}/api/panic/deactivate`,
          {},
          { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
        );
      }

      setIsTracking(false);
      Alert.alert('Success', 'Panic mode deactivated', [
        { text: 'OK', onPress: () => router.replace('/civil/home') }
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to deactivate panic mode');
      console.error('[PanicActive] Deactivate error:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Ionicons name="alert-circle" size={100} color="#EF4444" />
          <Text style={styles.title}>PANIC MODE ACTIVE</Text>
          <Text style={styles.subtitle}>Your location is being tracked</Text>
        </View>

        <View style={styles.infoBox}>
          <View style={styles.infoItem}>
            <Ionicons name="location" size={24} color="#10B981" />
            <Text style={styles.infoText}>GPS Tracking: Active</Text>
          </View>
          <View style={styles.infoItem}>
            <Ionicons name="time" size={24} color="#10B981" />
            <Text style={styles.infoText}>Update: Every 30 seconds</Text>
          </View>
          <View style={styles.infoItem}>
            <Ionicons name="shield-checkmark" size={24} color="#10B981" />
            <Text style={styles.infoText}>Data: Being sent to authorities</Text>
          </View>
        </View>

        <View style={styles.warningBox}>
          <Ionicons name="warning" size={24} color="#F59E0B" />
          <Text style={styles.warningText}>
            Keep your phone with you. Location tracking will continue even if the app is minimized.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.deactivateButton}
          onPress={() => {
            Alert.alert(
              'Deactivate Panic Mode?',
              'Are you safe now?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Yes, I\'m Safe', onPress: deactivatePanicMode }
              ]
            );
          }}
        >
          <Text style={styles.deactivateText}>I'm Safe - Stop Tracking</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#EF4444',
    marginTop: 24,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
    marginTop: 8,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    gap: 20,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  infoText: {
    fontSize: 16,
    color: '#fff',
    flex: 1,
  },
  warningBox: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: '#F59E0B',
    lineHeight: 20,
  },
  deactivateButton: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 20,
  },
  deactivateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
});
