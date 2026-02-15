import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import Constants from 'expo-constants';
import { getAuthToken, clearAuthData } from '../../utils/auth';

const BACKEND_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || 'https://ongoing-dev-22.preview.emergentagent.com';

export default function AdminPanics() {
  const router = useRouter();
  const [panics, setPanics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  useEffect(() => {
    loadPanics();
  }, [showActiveOnly]);

  const loadPanics = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }
      
      const response = await axios.get(
        `${BACKEND_URL}/api/admin/all-panics?active_only=${showActiveOnly}&limit=100`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      setPanics(response.data.panics || []);
    } catch (error: any) {
      console.error('[AdminPanics] Failed to load panics:', error?.response?.status);
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
    await loadPanics();
    setRefreshing(false);
  };

  const getCategoryColor = (category: string) => {
    const colors: any = {
      violence: '#EF4444',
      robbery: '#F59E0B',
      kidnapping: '#DC2626',
      medical: '#3B82F6',
      fire: '#F97316',
      harassment: '#8B5CF6',
      other: '#64748B'
    };
    return colors[category] || '#64748B';
  };

  const renderPanic = ({ item }: any) => (
    <View style={[styles.panicCard, item.is_active && styles.activeCard]}>
      <View style={styles.panicHeader}>
        <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(item.emergency_category) + '20' }]}>
          <Ionicons 
            name={item.is_active ? 'alert-circle' : 'checkmark-circle'} 
            size={16} 
            color={getCategoryColor(item.emergency_category)} 
          />
          <Text style={[styles.categoryText, { color: getCategoryColor(item.emergency_category) }]}>
            {(item.emergency_category || 'other').toUpperCase()}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: item.is_active ? '#EF444420' : '#10B98120' }]}>
          <Text style={[styles.statusText, { color: item.is_active ? '#EF4444' : '#10B981' }]}>
            {item.is_active ? 'ACTIVE' : 'RESOLVED'}
          </Text>
        </View>
      </View>
      
      <Text style={styles.userId}>User: {item.user_id?.substring(0, 12)}...</Text>
      <Text style={styles.timestamp}>
        Started: {new Date(item.activated_at).toLocaleString()}
      </Text>
      {item.deactivated_at && (
        <Text style={styles.timestamp}>
          Ended: {new Date(item.deactivated_at).toLocaleString()}
        </Text>
      )}
      
      {item.location?.coordinates && (
        <Text style={styles.location}>
          📍 {item.location.coordinates[1]?.toFixed(4)}, {item.location.coordinates[0]?.toFixed(4)}
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/admin/dashboard")}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>All Panics</Text>
        <TouchableOpacity onPress={() => setShowActiveOnly(!showActiveOnly)}>
          <Ionicons 
            name={showActiveOnly ? 'filter' : 'filter-outline'} 
            size={24} 
            color={showActiveOnly ? '#EF4444' : '#fff'} 
          />
        </TouchableOpacity>
      </View>

      {showActiveOnly && (
        <View style={styles.filterBanner}>
          <Text style={styles.filterText}>Showing active panics only</Text>
        </View>
      )}

      <FlatList
        data={panics}
        renderItem={renderPanic}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle" size={48} color="#10B981" />
            <Text style={styles.emptyText}>
              {showActiveOnly ? 'No active panics' : 'No panic events recorded'}
            </Text>
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
  filterBanner: { backgroundColor: '#EF444420', paddingVertical: 8, paddingHorizontal: 20 },
  filterText: { color: '#EF4444', fontSize: 14 },
  list: { padding: 20, gap: 12 },
  panicCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16 },
  activeCard: { borderWidth: 2, borderColor: '#EF4444' },
  panicHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  categoryBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  categoryText: { fontSize: 12, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '600' },
  userId: { fontSize: 14, color: '#94A3B8', marginBottom: 4 },
  timestamp: { fontSize: 12, color: '#64748B', marginBottom: 2 },
  location: { fontSize: 12, color: '#3B82F6', marginTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 8 },
});
