import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

import { getAuthToken, clearAuthData } from '../../utils/auth';

import { BACKEND_URL } from '../../utils/api';
const { width } = Dimensions.get('window');

export default function AdminSecurityMap() {
  const router = useRouter();
  const [securityUsers, setSecurityUsers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  useEffect(() => {
    loadSecurityUsers();
  }, []);

  const loadSecurityUsers = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }
      
      const response = await axios.get(`${BACKEND_URL}/api/admin/security-map`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      setSecurityUsers(response.data.security_users || []);
    } catch (error: any) {
      console.error('[AdminSecurityMap] Failed to load security users:', error?.response?.status);
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      }
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSecurityUsers();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    const colors: any = {
      available: '#10B981',
      busy: '#F59E0B',
      responding: '#EF4444',
      offline: '#64748B'
    };
    return colors[status] || '#64748B';
  };

  const renderUserCard = (user: any) => (
    <TouchableOpacity
      key={user.id}
      style={[styles.userCard, selectedUser?.id === user.id && styles.selectedCard]}
      onPress={() => setSelectedUser(user)}
    >
      <View style={styles.userHeader}>
        <View style={styles.userAvatar}>
          <Ionicons name="shield" size={24} color="#F59E0B" />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user.full_name}</Text>
          <Text style={styles.userRole}>
            {user.security_sub_role === 'supervisor' ? '⭐ Supervisor' : 'Team Member'}
          </Text>
          {user.team_name && (
            <Text style={styles.userTeam}>Team: {user.team_name}</Text>
          )}
        </View>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor(user.status) }]} />
      </View>
      
      {user.location?.coordinates && (
        <View style={styles.locationRow}>
          <Ionicons name="location" size={14} color="#3B82F6" />
          <Text style={styles.locationText}>
            {user.location.coordinates[1]?.toFixed(4)}, {user.location.coordinates[0]?.toFixed(4)}
          </Text>
        </View>
      )}
      
      <Text style={styles.lastUpdate}>
        Updated: {new Date(user.last_location_update).toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  // Group users by status
  const groupedUsers = {
    responding: securityUsers.filter(u => u.status === 'responding'),
    available: securityUsers.filter(u => u.status === 'available'),
    busy: securityUsers.filter(u => u.status === 'busy'),
    offline: securityUsers.filter(u => u.status === 'offline' || !u.status)
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/admin/dashboard")}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Security Map</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Map Placeholder - In production, use react-native-maps */}
      <View style={styles.mapPlaceholder}>
        <Ionicons name="map" size={64} color="#334155" />
        <Text style={styles.mapPlaceholderText}>Map View</Text>
        <Text style={styles.mapPlaceholderSubtext}>
          {securityUsers.length} security users tracked
        </Text>
        <Text style={styles.mapNote}>
          (Requires Google Maps API key for full functionality)
        </Text>
      </View>

      <ScrollView 
        style={styles.usersList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
      >
        {/* Status Summary */}
        <View style={styles.statusSummary}>
          <View style={styles.statusItem}>
            <View style={[styles.statusIndicator, { backgroundColor: '#EF4444' }]} />
            <Text style={styles.statusCount}>{groupedUsers.responding.length}</Text>
            <Text style={styles.statusLabel}>Responding</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={[styles.statusIndicator, { backgroundColor: '#10B981' }]} />
            <Text style={styles.statusCount}>{groupedUsers.available.length}</Text>
            <Text style={styles.statusLabel}>Available</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={[styles.statusIndicator, { backgroundColor: '#F59E0B' }]} />
            <Text style={styles.statusCount}>{groupedUsers.busy.length}</Text>
            <Text style={styles.statusLabel}>Busy</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={[styles.statusIndicator, { backgroundColor: '#64748B' }]} />
            <Text style={styles.statusCount}>{groupedUsers.offline.length}</Text>
            <Text style={styles.statusLabel}>Offline</Text>
          </View>
        </View>

        {/* User Cards */}
        {groupedUsers.responding.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: '#EF4444' }]}>🚨 Responding</Text>
            {groupedUsers.responding.map(renderUserCard)}
          </View>
        )}

        {groupedUsers.available.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: '#10B981' }]}>✅ Available</Text>
            {groupedUsers.available.map(renderUserCard)}
          </View>
        )}

        {groupedUsers.busy.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: '#F59E0B' }]}>⏳ Busy</Text>
            {groupedUsers.busy.map(renderUserCard)}
          </View>
        )}

        {groupedUsers.offline.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: '#64748B' }]}>⚫ Offline</Text>
            {groupedUsers.offline.map(renderUserCard)}
          </View>
        )}

        {securityUsers.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color="#64748B" />
            <Text style={styles.emptyText}>No security users with location data</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  mapPlaceholder: { height: 200, backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center', margin: 20, borderRadius: 16 },
  mapPlaceholderText: { fontSize: 18, color: '#64748B', marginTop: 8 },
  mapPlaceholderSubtext: { fontSize: 14, color: '#94A3B8', marginTop: 4 },
  mapNote: { fontSize: 12, color: '#475569', marginTop: 8 },
  usersList: { flex: 1 },
  statusSummary: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 16, marginHorizontal: 20, backgroundColor: '#1E293B', borderRadius: 16, marginBottom: 16 },
  statusItem: { alignItems: 'center' },
  statusIndicator: { width: 12, height: 12, borderRadius: 6, marginBottom: 4 },
  statusCount: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  statusLabel: { fontSize: 12, color: '#64748B' },
  section: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  userCard: { backgroundColor: '#1E293B', borderRadius: 12, padding: 16, marginBottom: 8 },
  selectedCard: { borderWidth: 2, borderColor: '#8B5CF6' },
  userHeader: { flexDirection: 'row', alignItems: 'center' },
  userAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F59E0B20', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  userRole: { fontSize: 12, color: '#94A3B8' },
  userTeam: { fontSize: 12, color: '#64748B' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4 },
  locationText: { fontSize: 12, color: '#3B82F6' },
  lastUpdate: { fontSize: 10, color: '#475569', marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 8 },
});
