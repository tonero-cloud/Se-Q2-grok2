import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Constants from 'expo-constants';
import { getPendingCount, processQueue } from '../../utils/offlineQueue';
import { getAuthToken, clearAuthData, getUserMetadata } from '../../utils/auth';

const BACKEND_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL;

export default function CivilHome() {
  const router = useRouter();
  const [isPremium, setIsPremium] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [userName, setUserName] = useState('');
  const [myReports, setMyReports] = useState<any[]>([]);
  const [totalReportCount, setTotalReportCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasActivePanic, setHasActivePanic] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Refresh on every screen focus using expo-router's useFocusEffect
  useFocusEffect(
    useCallback(() => {
      initializeScreen();
    }, [])
  );

  const initializeScreen = async () => {
    setLoading(true);
    console.log('[CivilHome] Initializing screen...');
    
    // Check authentication first
    const token = await getAuthToken();
    console.log('[CivilHome] Token exists:', !!token);
    
    if (!token) {
      console.log('[CivilHome] No token found, redirecting to login');
      router.replace('/auth/login');
      return;
    }

    // Check for active panic
    const activePanic = await AsyncStorage.getItem('active_panic');
    setHasActivePanic(!!activePanic);
    
    await Promise.all([
      checkUserStatus(),
      checkPendingUploads(),
      loadMyReports()
    ]);
    setLoading(false);
  };

  const checkUserStatus = async () => {
    try {
      const metadata = await getUserMetadata();
      setIsPremium(metadata.isPremium);
      console.log('[CivilHome] Local metadata premium:', metadata.isPremium);
      
      const token = await getAuthToken();
      if (token) {
        try {
          const response = await axios.get(`${BACKEND_URL}/api/user/profile?t=${Date.now()}`, {
            headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
            timeout: 10000
          });
          
          console.log('[CivilHome] Backend profile response:', response.data?.is_premium);
          const backendPremium = response.data?.is_premium === true;
          setIsPremium(backendPremium);
          
          if (response.data?.full_name) {
            setUserName(response.data.full_name);
          }
        } catch (apiError: any) {
          console.log('[CivilHome] Could not verify with backend:', apiError?.response?.status);
          if (apiError?.response?.status === 401) {
            console.log('[CivilHome] Token invalid, clearing and redirecting');
            await clearAuthData();
            router.replace('/auth/login');
          }
        }
      }
    } catch (error) {
      console.error('[CivilHome] Error checking user status:', error);
    }
  };

  const loadMyReports = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      
      const response = await axios.get(`${BACKEND_URL}/api/report/my-reports?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
        timeout: 10000
      });
      
      const reports = response.data || [];
      setTotalReportCount(reports.length);
      setMyReports(reports.slice(0, 3)); // Show first 3 reports in preview
    } catch (error) {
      console.log('[CivilHome] Could not load reports:', error);
    }
  };

  const checkPendingUploads = async () => {
    const count = await getPendingCount();
    setPendingUploads(count);
  };

  const handleProcessQueue = async () => {
    const results = await processQueue();
    checkPendingUploads();
    Alert.alert('Upload Complete', `Processed ${results.length} items`);
  };

  const handlePanicPress = () => {
    if (hasActivePanic) {
      // Go to panic active screen to show "I'm Safe" button
      router.push('/civil/panic-active');
    } else {
      // Start new panic
      Alert.alert(
        '🚨 Activate Panic Mode?',
        'This will alert nearby security agencies and start tracking your location.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Yes, Activate', 
            style: 'destructive',
            onPress: () => router.push('/civil/panic-active')
          }
        ]
      );
    }
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Logout', 
        style: 'destructive',
        onPress: async () => {
          console.log('[CivilHome] Logout initiated');
          await clearAuthData();
          router.replace('/auth/login');
        }
      }
    ]);
  };

  if (loading) {
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
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hello! {userName ? userName.split(' ')[0] : 'User'}</Text>
            <Text style={styles.subGreeting}>Stay safe with SafeGuard</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Panic Button */}
        <TouchableOpacity 
          style={[styles.panicButton, hasActivePanic && styles.panicButtonActive]} 
          onPress={handlePanicPress}
        >
          <Ionicons name={hasActivePanic ? "shield-checkmark" : "alert-circle"} size={48} color="#fff" />
          <Text style={styles.panicText}>
            {hasActivePanic ? "I'm Safe Now" : 'PANIC BUTTON'}
          </Text>
          <Text style={styles.panicSubtext}>
            {hasActivePanic ? 'Tap to stop tracking' : 'Tap in emergency'}
          </Text>
        </TouchableOpacity>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/report')}>
              <View style={[styles.actionIcon, { backgroundColor: '#10B98120' }]}>
                <Ionicons name="videocam" size={28} color="#10B981" />
              </View>
              <Text style={styles.actionText}>Video Report</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/report/audio')}>
              <View style={[styles.actionIcon, { backgroundColor: '#8B5CF620' }]}>
                <Ionicons name="mic" size={28} color="#8B5CF6" />
              </View>
              <Text style={styles.actionText}>Audio Report</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.actionCard} 
              onPress={() => {
                if (isPremium) {
                  router.push('/civil/escort');
                } else {
                  Alert.alert(
                    'Premium Feature',
                    'Security Escort requires premium. Upgrade now?',
                    [
                      { text: 'Later', style: 'cancel' },
                      { text: 'Upgrade', onPress: () => router.push('/premium') }
                    ]
                  );
                }
              }}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#3B82F620' }]}>
                <Ionicons name="walk" size={28} color="#3B82F6" />
              </View>
              <Text style={styles.actionText}>Security Escort</Text>
              {!isPremium && <Text style={styles.premiumBadge}>⭐ Premium</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/report/list')}>
              <View style={[styles.actionIcon, { backgroundColor: '#F59E0B20' }]}>
                <Ionicons name="folder" size={28} color="#F59E0B" />
              </View>
              <Text style={styles.actionText}>My Reports</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* My Reports Preview */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Reports ({totalReportCount})</Text>
            <TouchableOpacity onPress={() => router.push('/report/list')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          {myReports.length === 0 ? (
            <Text style={styles.placeholderText}>Your submitted reports will appear here</Text>
          ) : (
            myReports.map((report: any) => (
              <View key={report.id || report._id} style={styles.reportItem}>
                <Ionicons
                  name={report.type === 'video' ? 'videocam' : 'mic'}
                  size={20}
                  color={report.type === 'video' ? '#10B981' : '#8B5CF6'}
                />
                <View style={styles.reportInfo}>
                  <Text style={styles.reportType}>{report.type?.toUpperCase()} Report</Text>
                  <Text style={styles.reportDate}>
                    {new Date(report.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <View style={[styles.statusBadge, report.uploaded ? styles.uploadedBadge : styles.pendingBadge]}>
                  <Text style={styles.statusBadgeText}>
                    {report.uploaded ? 'Uploaded' : 'Pending'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Pending Uploads */}
        {pendingUploads > 0 && (
          <View style={styles.section}>
            <View style={styles.pendingCard}>
              <Ionicons name="cloud-upload" size={24} color="#F59E0B" />
              <Text style={styles.pendingText}>{pendingUploads} pending upload(s)</Text>
              <TouchableOpacity style={styles.uploadButton} onPress={handleProcessQueue}>
                <Text style={styles.uploadButtonText}>Upload Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={24} color="#EF4444" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94A3B8', marginTop: 12 },
  scrollView: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  greeting: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  subGreeting: { fontSize: 16, color: '#94A3B8', marginTop: 4 },
  panicButton: { margin: 20, backgroundColor: '#EF4444', borderRadius: 24, padding: 32, alignItems: 'center' },
  panicButtonActive: { backgroundColor: '#10B981' },
  panicText: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginTop: 12 },
  panicSubtext: { fontSize: 14, color: '#ffffff90', marginTop: 4 },
  section: { padding: 20, paddingTop: 0 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 20, fontWeight: '600', color: '#fff', marginBottom: 12 },
  viewAll: { fontSize: 14, color: '#3B82F6', fontWeight: '600' },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: { width: '47%', backgroundColor: '#1E293B', borderRadius: 16, padding: 16, alignItems: 'center' },
  actionIcon: { width: 56, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  actionText: { fontSize: 14, color: '#fff', fontWeight: '500', textAlign: 'center' },
  premiumBadge: { fontSize: 11, color: '#F59E0B', marginTop: 4 },
  placeholderText: { fontSize: 14, color: '#64748B', textAlign: 'center', paddingVertical: 20 },
  reportItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', padding: 12, borderRadius: 12, marginBottom: 8, gap: 12 },
  reportInfo: { flex: 1 },
  reportType: { fontSize: 14, fontWeight: '500', color: '#fff' },
  reportDate: { fontSize: 12, color: '#64748B' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  uploadedBadge: { backgroundColor: '#10B98120' },
  pendingBadge: { backgroundColor: '#F59E0B20' },
  statusBadgeText: { fontSize: 12, fontWeight: '600', color: '#10B981' },
  pendingCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F59E0B20', borderRadius: 12, padding: 16, gap: 12 },
  pendingText: { flex: 1, fontSize: 14, color: '#F59E0B', fontWeight: '500' },
  uploadButton: { backgroundColor: '#F59E0B', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  uploadButtonText: { color: '#fff', fontWeight: '600' },
  logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, marginHorizontal: 20, backgroundColor: '#1E293B', borderRadius: 12, gap: 8 },
  logoutText: { fontSize: 16, color: '#EF4444', fontWeight: '600' },
});

const pickAndUploadProfilePhoto = async () => {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setUploadingPhoto(true);
      const uri = result.assets[0].uri;

      const token = await getAuthToken();
      if (!token) return;

      const formData = new FormData();
      formData.append('photo', {
        uri,
        name: `profile_${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as any);

      const response = await axios.post(
        `${BACKEND_URL}/api/user/update-profile-photo`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
          timeout: 30000,
        }
      );

      if (response.data?.photo_url) {
        setProfilePhoto(response.data.photo_url);
        Alert.alert('Success', 'Profile photo updated');
      }
    }
  } catch (error: any) {
    console.error('[ProfilePhoto] Upload error:', error);
    Alert.alert('Upload Failed', 'Could not update profile photo');
  } finally {
    setUploadingPhoto(false);
  }
};
