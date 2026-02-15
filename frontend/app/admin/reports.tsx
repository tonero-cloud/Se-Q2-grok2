import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import Constants from 'expo-constants';
import { getAuthToken, clearAuthData } from '../../utils/auth';

const BACKEND_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || 'https://ongoing-dev-22.preview.emergentagent.com';

export default function AdminReports() {
  const router = useRouter();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    loadReports();
  }, [typeFilter]);

  const loadReports = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }
      
      let url = `${BACKEND_URL}/api/admin/all-reports?limit=100`;
      if (typeFilter) url += `&report_type=${typeFilter}`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      setReports(response.data.reports || []);
    } catch (error: any) {
      console.error('[AdminReports] Failed to load reports:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  };

  const openMedia = (url: string) => {
    if (url) {
      Linking.openURL(url);
    }
  };

  const renderReport = ({ item }: any) => (
    <TouchableOpacity 
      style={styles.reportCard}
      onPress={() => item.file_url && openMedia(item.file_url)}
    >
      <View style={styles.reportHeader}>
        <View style={[styles.typeBadge, { backgroundColor: item.type === 'video' ? '#3B82F620' : '#10B98120' }]}>
          <Ionicons 
            name={item.type === 'video' ? 'videocam' : 'mic'} 
            size={16} 
            color={item.type === 'video' ? '#3B82F6' : '#10B981'} 
          />
          <Text style={[styles.typeText, { color: item.type === 'video' ? '#3B82F6' : '#10B981' }]}>
            {item.type.toUpperCase()}
          </Text>
        </View>
        {item.is_anonymous && (
          <View style={styles.anonymousBadge}>
            <Ionicons name="eye-off" size={14} color="#64748B" />
            <Text style={styles.anonymousText}>Anonymous</Text>
          </View>
        )}
      </View>
      
      {item.caption && (
        <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>
      )}
      
      <Text style={styles.userId}>User: {item.is_anonymous ? 'Hidden' : item.user_id?.substring(0, 12) + '...'}</Text>
      <Text style={styles.timestamp}>
        {new Date(item.created_at).toLocaleString()}
      </Text>
      
      {item.location?.coordinates && (
        <Text style={styles.location}>
          📍 {item.location.coordinates[1]?.toFixed(4)}, {item.location.coordinates[0]?.toFixed(4)}
        </Text>
      )}

      {item.file_url && (
        <View style={styles.mediaIndicator}>
          <Ionicons name="play-circle" size={20} color="#3B82F6" />
          <Text style={styles.mediaText}>Tap to view media</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/admin/dashboard")}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>All Reports</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.filters}>
        {['', 'video', 'audio'].map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.filterButton, typeFilter === type && styles.filterButtonActive]}
            onPress={() => setTypeFilter(type)}
          >
            <Ionicons 
              name={type === 'video' ? 'videocam' : type === 'audio' ? 'mic' : 'apps'} 
              size={16} 
              color={typeFilter === type ? '#fff' : '#64748B'} 
            />
            <Text style={[styles.filterButtonText, typeFilter === type && styles.filterButtonTextActive]}>
              {type || 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={reports}
        renderItem={renderReport}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-outline" size={48} color="#64748B" />
            <Text style={styles.emptyText}>No reports found</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  filters: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 8 },
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#1E293B' },
  filterButtonActive: { backgroundColor: '#8B5CF6' },
  filterButtonText: { fontSize: 14, color: '#64748B', textTransform: 'capitalize' },
  filterButtonTextActive: { color: '#fff' },
  list: { padding: 20, gap: 12 },
  reportCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  typeText: { fontSize: 12, fontWeight: '600' },
  anonymousBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  anonymousText: { fontSize: 12, color: '#64748B' },
  caption: { fontSize: 14, color: '#fff', marginBottom: 8 },
  userId: { fontSize: 12, color: '#94A3B8', marginBottom: 2 },
  timestamp: { fontSize: 12, color: '#64748B', marginBottom: 4 },
  location: { fontSize: 12, color: '#3B82F6' },
  mediaIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#334155' },
  mediaText: { fontSize: 14, color: '#3B82F6' },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 8 },
});
