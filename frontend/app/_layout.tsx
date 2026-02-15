import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Alert, View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { startQueueProcessor } from '../utils/offlineQueue';

// Keep the splash screen visible while loading fonts
SplashScreen.preventAutoHideAsync().catch(() => {});

// Configure notification handler ONCE at module level
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type NotificationData = {
  type?: 'panic' | 'report' | 'general' | 'chat';
  event_id?: string;
  report_id?: string;
  conversation_id?: string;
};

// Separate inner component that safely uses router hooks
function AppContent() {
  const router = useRouter();
  const segments = useSegments();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const queueCleanup = useRef<(() => void) | null>(null);
  const isInitialized = useRef(false);

  // Initialize offline queue processor once
  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true;
      queueCleanup.current = startQueueProcessor();
    }
    
    return () => {
      if (queueCleanup.current) {
        queueCleanup.current();
        queueCleanup.current = null;
      }
    };
  }, []);

  // Set up notification listeners
  useEffect(() => {
    // Listen for notifications received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as NotificationData;
      console.log('Notification received in foreground:', data);
      
      // Show an in-app alert for important notifications
      if (data?.type === 'panic') {
        Alert.alert(
          '🚨 EMERGENCY ALERT',
          notification.request.content.body || 'Panic alert nearby!',
          [
            { 
              text: 'View', 
              onPress: () => {
                try {
                  router.push('/security/panics');
                } catch (e) {
                  console.log('Navigation error:', e);
                }
              } 
            },
            { text: 'Dismiss', style: 'cancel' }
          ]
        );
      }
    });

    // Listen for notification taps (user interacts with notification)
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as NotificationData;
      console.log('Notification tapped:', data);
      
      try {
        // Navigate based on notification type
        if (data?.type === 'panic') {
          router.push('/security/panics');
        } else if (data?.type === 'report') {
          router.push('/security/reports');
        } else if (data?.type === 'chat' && data?.conversation_id) {
          router.push(`/security/chat/${data.conversation_id}` as any);
        }
      } catch (e) {
        console.log('Navigation error:', e);
      }
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  return <Slot />;
}

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // Pre-load fonts for icons - this ensures Ionicons work on web
        await Font.loadAsync({
          ...Ionicons.font,
        });
      } catch (e) {
        console.warn('Font loading error:', e);
      } finally {
        // Tell the application to render
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      // Hide splash screen once fonts are loaded
      await SplashScreen.hideAsync();
    }
  }, [appIsReady]);

  if (!appIsReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#EF4444" />
        <Text style={styles.loadingText}>Loading SafeGuard...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: '#0F172A' }} onLayout={onLayoutRootView}>
        <AppContent />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 16,
    marginTop: 16,
  },
});
