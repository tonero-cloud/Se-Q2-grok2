import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, RefreshControl, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

import { Audio } from 'expo-av';
import { Video, ResizeMode } from 'expo-av';
import { getAuthToken, clearAuthData, getUserMetadata } from '../../utils/auth';
import { LocationMapModal } from '../../components/LocationMapModal';

import { BACKEND_URL } from '../../utils/api';

export default function SecurityReports() {
  const router = useRouter();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [userRole, setUserRole] = useState<string>('security');
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [locationModal, setLocationModal] = useState<{ visible: boolean; lat: number; lng: number; title: string } | null>(null);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      loadReports();
      return () => {
        if (currentSound) {
          currentSound.unloadAsync();
        }
      };
    }, [])
  );

  useEffect(() => {
    checkUserRole();
    const interval = setInterval(loadReports, 30000);
    return () => {
      clearInterval(interval);
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, []);

  const checkUserRole = async () => {
    const metadata = await getUserMetadata();
    setUserRole(metadata.role || 'security');
  };

  const loadReports = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      
      const response = await axios.get(`${BACKEND_URL}/api/security/nearby-reports?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
        timeout: 15000
      });
      console.log('[SecurityReports] Loaded', response.data?.length, 'reports');
      setReports(response.data || []);
    } catch (error: any) {
      console.error('[SecurityReports] Failed to load reports:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/auth/login');
      } else {
        Alert.alert('Error', 'Failed to load reports. Please try again.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadReports();
  };

  const playAudio = async (audioUrl: string | undefined, reportId: string) => {
    if (!audioUrl) {
      Alert.alert('Error', 'Audio URL not available');
      return;
    }
    try {
      if (playingId === reportId && currentSound) {
        if (isPaused) {
          await currentSound.playFromPositionAsync(playbackPosition);
          setIsPaused(false);
        } else {
          const status = await currentSound.getStatusAsync();
          if (status.isLoaded) {
            setPlaybackPosition(status.positionMillis);
          }
          await currentSound.pauseAsync();
          setIsPaused(true);
        }
        return;
      }

      if (currentSound) {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
        setCurrentSound(null);
        setPlayingId(null);
        setIsPaused(false);
        setPlaybackPosition(0);
      }

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      console.log('[SecurityReports] Loading audio from:', audioUrl);

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true }
      );

      setCurrentSound(newSound);
      setPlayingId(reportId);
      setIsPaused(false);
      setPlaybackPosition(0);

      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
          setIsPaused(false);
          setPlaybackPosition(0);
          newSound.unloadAsync();
          setCurrentSound(null);
        } else if (status.error) {
          console.error('[SecurityReports] Playback error:', status.error);
          Alert.alert('Playback Error', 'Unable to play audio: ' + status.error);
          stopAudio();
        }
      });
    } catch (error: any) {
      console.error('[SecurityReports] Audio playback error:', error);
      Alert.alert('Playback Error', 'Unable to play audio file. ' + error.message);
    }
  };

  const stopAudio = async () => {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      setCurrentSound(null);
      setPlayingId(null);
      setIsPaused(false);
      setPlaybackPosition(0);
    }
  };

  const playVideo = (videoUrl: string | undefined) => {
    if (!videoUrl) {
      Alert.alert('Error', 'Video URL not available');
      return;
    }
    setSelectedVideoUrl(videoUrl);
  };

  const openInMaps = (latitude: number | undefined, longitude: number | undefined) => {
    if (latitude == null || longitude == null) {
      Alert.alert('Error', 'Location not available');
      return;
    }
    const scheme = Platform.select({ ios: 'maps:', android: 'geo:' });
    const url = Platform.select({
      ios: `maps:?q=Report&ll=${latitude},${longitude}`,
      android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(Report)`
    });
    if (url) {
      Linking.openURL(url);
    }
  };

  const getSenderDisplay = (item: any) => {
    if (item.is_anonymous) {
      if (userRole === 'admin') {
        return {
          name: item.sender_email || item.user_email || 'Unknown',
          label: '(Anonymous - for discreet attendance)'
        };
      } else {
        return {
          name: 'Anonymous Reporter',
          label: '(Discreet attendance required)'
        };
      }
    }
    return {
      name: item.sender_email || item.user_email || 'Unknown',
      label: ''
    };
  };

  const formatDateTime = (dateString: string | undefined) => {
    if (!dateString) return 'Unknown date';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const renderReport = ({ item }: any) => {
    const sender = getSenderDisplay(item);
    const dateTime = formatDateTime(item.created_at);

    return (
      <View style={styles.reportCard}>
        <View style={styles.reportHeader}>
          <View style={[styles.reportIcon, { backgroundColor: item.type === 'video' ? '#10B98120' : '#8B5CF620' }]}>
            <Ionicons 
              name={item.type === 'video' ? 'videocam' : 'mic'} 
              size={24} 
              color={item.type === 'video' ? '#10B981' : '#8B5CF6'} 
            />
          </View>
          <View style={styles.reportInfo}>
            <Text style={styles.reportType}>{item.type.toUpperCase()} Report</Text>
            <Text style={styles.reportSender}>{sender.name}</Text>
            <Text style={styles.anonymousLabel}>{sender.label}</Text>
            <Text style={styles.reportDate}>{dateTime}</Text>
          </View>
          <View style={[styles.statusBadge, styles.uploadedBadge]}>
            <Text style={[styles.statusText, styles.uploadedText]}>Uploaded</Text>
          </View>
        </View>

        {item.caption && (
          <Text style={styles.caption}>"{item.caption}"</Text>
        )}

        <View style={styles.reportActions}>
          {item.type === 'audio' && (
            <TouchableOpacity
              style={[styles.actionButton, playingId === item._id && !isPaused ? styles.actionButtonActive : null]}
              onPress={() => playAudio(item.file_url, item._id)}
            >
              <Ionicons name={playingId === item._id && !isPaused ? 'pause' : 'play'} size={20} color={playingId === item._id && !isPaused ? '#fff' : '#94A3B8'} />
              <Text style={[styles.actionText, playingId === item._id && !isPaused ? styles.actionTextActive : null]}>
                {playingId === item._id && !isPaused ? 'Pause' : 'Play'}
              </Text>
            </TouchableOpacity>
          )}

          {playingId === item._id && (
            <TouchableOpacity
              style={[styles.actionButton, styles.stopButton]}
              onPress={stopAudio}
            >
              <Ionicons name="stop" size={20} color="#EF4444" />
              <Text style={[styles.actionText, { color: '#EF4444' }]}>Stop</Text>
            </TouchableOpacity>
          )}

  {item.type === 'video' && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => playVideo(item.file_url)}
            >
              <Ionicons name="play-circle" size={20} color="#10B981" />
              <Text style={[styles.actionText, { color: '#10B981' }]}>Watch</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              if (item.latitude && item.longitude) {
                setLocationModal({
                  visible: true,
                  lat: item.latitude,
                  lng: item.longitude,
                  title: `${item.type?.toUpperCase()} Report Location`
                });
              } else {
                Alert.alert('Location', 'Location not available for this report');
              }
            }}
          >
            <Ionicons name="location" size={20} color="#F59E0B" />
            <Text style={styles.actionText}>Location</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.respondButton]}
            onPress={() => Alert.alert('Respond', 'Response feature coming soon. You will be able to initiate contact with the reporter.')}
          >
            <Ionicons name="checkmark-circle" size={20} color="#10B981" />
            <Text style={[styles.actionText, { color: '#10B981' }]}>Respond</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Video player modal
  if (selectedVideoUrl) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.videoHeader}>
          <TouchableOpacity onPress={() => setSelectedVideoUrl(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.videoTitle}>Video Report</Text>
          <View style={{ width: 28 } } />
        </View>
        <View style={styles.videoContainer}>
          <Video
            source={{ uri: selectedVideoUrl }}
            style={styles.video}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
            isLooping={false}
            onError={(error) => {
              console.error('[Video Error]', error);
              Alert.alert('Video Error', 'Unable to load video.');
              setSelectedVideoUrl(null);
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/security/home')}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Nearby Reports ({reports.length})</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      ) : (
        <FlatList
          data={reports}
          renderItem={renderReport}
          keyExtractor={(item) => item._id || item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={80} color="#64748B" />
              <Text style={styles.emptyText}>No reports nearby</Text>
              <Text style={styles.emptySubtext}>Pull to refresh</Text>
            </View>
          }
        />
      )}
      
      {/* Location Map Modal */}
      {locationModal && (
        <LocationMapModal
          visible={locationModal.visible}
          onClose={() => setLocationModal(null)}
          latitude={locationModal.lat}
          longitude={locationModal.lng}
          title={locationModal.title}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  reportCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12 },
  reportHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  reportIcon: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  reportInfo: { flex: 1 },
  reportType: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 4 },
  reportSender: { fontSize: 14, color: '#94A3B8', marginBottom: 2 },
  anonymousLabel: { fontSize: 12, color: '#F59E0B', fontStyle: 'italic', marginBottom: 2 },
  reportDate: { fontSize: 12, color: '#64748B' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  uploadedBadge: { backgroundColor: '#10B98120' },
  pendingBadge: { backgroundColor: '#F59E0B20' },
  statusText: { fontSize: 12, fontWeight: '600' },
  uploadedText: { color: '#10B981' },
  pendingText: { color: '#F59E0B' },
  caption: { fontSize: 14, color: '#94A3B8', marginTop: 12, fontStyle: 'italic' },
  reportActions: { flexDirection: 'row', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#334155', gap: 8 },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: '#0F172A' },
  actionButtonActive: { backgroundColor: '#8B5CF6' },
  actionText: { fontSize: 13, color: '#94A3B8' },
  actionTextActive: { color: '#fff' },
  respondButton: { borderWidth: 1, borderColor: '#10B98140', backgroundColor: '#10B98110' },
  emptyContainer: { alignItems: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 18, color: '#64748B', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#475569', marginTop: 4 },
  videoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#000' },
  videoTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  videoContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  video: { width: '100%', height: 300 },
});
