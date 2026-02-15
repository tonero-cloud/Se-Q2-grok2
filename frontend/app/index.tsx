import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { getAuthToken, getUserMetadata } from '../utils/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuthAndNavigate();
  }, []);

  const checkAuthAndNavigate = async () => {
    try {
      const token = await getAuthToken();
      
      if (!token) {
        // No token - redirect to login
        router.replace('/auth/login');
        return;
      }

      // Get user role from metadata
      const metadata = await getUserMetadata();
      const role = metadata.role || await AsyncStorage.getItem('user_role');

      // Navigate based on role
      if (role === 'admin') {
        router.replace('/admin/dashboard');
      } else if (role === 'security') {
        router.replace('/security/home');
      } else {
        router.replace('/civil/home');
      }
    } catch (error) {
      console.log('[Index] Auth check error:', error);
      router.replace('/auth/login');
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#EF4444" />
      <Text style={styles.text}>Loading SafeGuard...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#94A3B8',
    fontSize: 16,
    marginTop: 16,
  },
});
