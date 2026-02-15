import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, TextInput, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

import { getAuthToken, clearAuthData } from '../../utils/auth';
import { LocationMapModal } from '../../components/LocationMapModal';

import { BACKEND_URL } from '../../utils/api';

export default function AdminTrackUser() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'civil' | 'security'>('all');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [trackingData, setTrackingData] = useState<any>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [locationModal, setLocationModal] = useState<{ visible: boolean; lat: number; lng: number; title: string; subtitle?: string } | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    filterUsers();
  }, [searchQuery, roleFilter, users]);

  const loadUsers = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }

      const response = await axios.get(`${BACKEND_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      
      setUsers(response.data || []);
    } catch (error: any) {
      console.error('[AdminTrackUser] Error:', error);
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        await clearAuthData();
        router.replace('/admin/login');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filterUsers = () => {
    let filtered = users;
    
    if (roleFilter !== 'all') {
      filtered = filtered.filter(u => u.role === roleFilter);
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(u => 
        u.full_name?.toLowerCase().includes(query) ||
        u.email?.toLowerCase().includes(query) ||
        u.phone?.includes(query)
      );
    }
    
    setFilteredUsers(filtered);
  };

  const trackUser = async (user: any) => {
    setSelectedUser(user);
    setTrackingLoading(true);
    
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await axios.get(`${BACKEND_URL}/api/admin/track-user/${user._id || user.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      
      setTrackingData(response.data);
    } catch (error: any) {
      console.error('[AdminTrackUser] Track error:', error);
      Alert.alert('Error', 'Failed to get user tracking data');
      setTrackingData(null);
    } finally {
      setTrackingLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadUsers();
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  const renderUser = ({ item }: any) => {
    const isSelected = selectedUser?._id === item._id || selectedUser?.id === item.id;
    
    return (
      <TouchableOpacity 
        style={[styles.userCard, isSelected && styles.userCardSelected]}
        onPress={() => trackUser(item)}
      >
        <View style={[styles.avatar, { backgroundColor: item.role === 'security' ? '#F59E0B20' : '#10B98120' }]}>
          <Ionicons 
            name={item.role === 'security' ? 'shield' : 'person'} 
            size={24} 
            color={item.role === 'security' ? '#F59E0B' : '#10B981'} 
          />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{item.full_name || 'Unknown'}</Text>
          <Text style={styles.userEmail}>{item.email}</Text>
          <View style={styles.userMeta}>
            <View style={[styles.roleBadge, { backgroundColor: item.role === 'security' ? '#F59E0B20' : '#10B98120' }]}>
              <Text style={[styles.roleText, { color: item.role === 'security' ? '#F59E0B' : '#10B981' }]}>
                {item.role?.toUpperCase()}
              </Text>
            </View>
            {item.phone && (
              <Text style={styles.userPhone}>{item.phone}</Text>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#64748B" />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Track Users</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Search & Filter */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color="#64748B" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users..."
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        
        <View style={styles.filterRow}>
          {(['all', 'civil', 'security'] as const).map((role) => (
            <TouchableOpacity
              key={role}
              style={[styles.filterChip, roleFilter === role && styles.filterChipActive]}
              onPress={() => setRoleFilter(role)}
            >
              <Text style={[styles.filterText, roleFilter === role && styles.filterTextActive]}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.content}>
        {/* User List */}
        <View style={styles.userListContainer}>
          {loading ? (
            <ActivityIndicator size="large" color="#8B5CF6" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={filteredUsers}
              renderItem={renderUser}
              keyExtractor={(item) => item._id || item.id}
              contentContainerStyle={styles.userList}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={48} color="#64748B" />
                  <Text style={styles.emptyText}>No users found</Text>
                </View>
              }
            />
          )}
        </View>

        {/* Tracking Panel */}
        {selectedUser && (
          <View style={styles.trackingPanel}>
            <View style={styles.trackingHeader}>
              <Text style={styles.trackingTitle}>Tracking: {selectedUser.full_name}</Text>
              <TouchableOpacity onPress={() => setSelectedUser(null)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {trackingLoading ? (
              <ActivityIndicator size="large" color="#8B5CF6" style={{ marginTop: 20 }} />
            ) : trackingData ? (
              <View style={styles.trackingContent}>
                {/* Last Known Location */}
                {trackingData.last_location && (
                  <TouchableOpacity 
                    style={styles.locationCard}
                    onPress={() => setLocationModal({
                      visible: true,
                      lat: trackingData.last_location.latitude,
                      lng: trackingData.last_location.longitude,
                      title: `${selectedUser.full_name}'s Location`,
                      subtitle: `Last updated: ${formatDate(trackingData.last_location.timestamp)}`
                    })}
                  >
                    <View style={styles.locationIcon}>
                      <Ionicons name="location" size={24} color="#3B82F6" />
                    </View>
                    <View style={styles.locationInfo}>
                      <Text style={styles.locationLabel}>Last Known Location</Text>
                      <Text style={styles.locationCoords}>
                        {trackingData.last_location.latitude.toFixed(4)}, {trackingData.last_location.longitude.toFixed(4)}
                      </Text>
                      <Text style={styles.locationTime}>
                        {formatDate(trackingData.last_location.timestamp)}
                      </Text>
                    </View>
                    <Ionicons name="map" size={20} color="#3B82F6" />
                  </TouchableOpacity>
                )}

                {/* Activity Summary */}
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{trackingData.total_reports || 0}</Text>
                    <Text style={styles.statLabel}>Reports</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{trackingData.total_panics || 0}</Text>
                    <Text style={styles.statLabel}>Panics</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{trackingData.active_days || 0}</Text>
                    <Text style={styles.statLabel}>Active Days</Text>
                  </View>
                </View>

                {/* Recent Activity */}
                <Text style={styles.sectionLabel}>Recent Activity</Text>
                {trackingData.recent_activity?.length > 0 ? (
                  trackingData.recent_activity.map((activity: any, index: number) => (
                    <View key={index} style={styles.activityItem}>
                      <Ionicons 
                        name={activity.type === 'panic' ? 'alert-circle' : 'document-text'} 
                        size={16} 
                        color={activity.type === 'panic' ? '#EF4444' : '#3B82F6'} 
                      />
                      <Text style={styles.activityText}>{activity.description}</Text>
                      <Text style={styles.activityTime}>{formatDate(activity.timestamp)}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noActivityText}>No recent activity</Text>
                )}
              </View>
            ) : (
              <Text style={styles.noTrackingText}>No tracking data available</Text>
            )}
          </View>
        )}
      </View>

      {/* Location Map Modal */}
      {locationModal && (
        <LocationMapModal
          visible={locationModal.visible}
          onClose={() => setLocationModal(null)}
          latitude={locationModal.lat}
          longitude={locationModal.lng}
          title={locationModal.title}
          subtitle={locationModal.subtitle}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: '600', color: '#fff' },
  searchContainer: { paddingHorizontal: 20 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, marginLeft: 12 },
  filterRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#1E293B', borderRadius: 20 },
  filterChipActive: { backgroundColor: '#8B5CF6' },
  filterText: { color: '#94A3B8', fontSize: 14 },
  filterTextActive: { color: '#fff' },
  content: { flex: 1, marginTop: 16 },
  userListContainer: { flex: 1 },
  userList: { paddingHorizontal: 20 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, padding: 16, marginBottom: 12 },
  userCardSelected: { borderWidth: 2, borderColor: '#8B5CF6' },
  avatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  userInfo: { flex: 1, marginLeft: 12 },
  userName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  userEmail: { fontSize: 14, color: '#94A3B8', marginTop: 2 },
  userMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 },
  roleBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 4 },
  roleText: { fontSize: 11, fontWeight: '600' },
  userPhone: { fontSize: 12, color: '#64748B' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: '#64748B', marginTop: 12 },
  trackingPanel: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '50%' },
  trackingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  trackingTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  trackingContent: {},
  locationCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 12, padding: 16, marginBottom: 16 },
  locationIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B82F620', justifyContent: 'center', alignItems: 'center' },
  locationInfo: { flex: 1, marginLeft: 12 },
  locationLabel: { color: '#94A3B8', fontSize: 12 },
  locationCoords: { color: '#fff', fontSize: 14, fontWeight: '500', marginTop: 2 },
  locationTime: { color: '#64748B', fontSize: 12, marginTop: 2 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  statItem: { alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 24, fontWeight: '700' },
  statLabel: { color: '#64748B', fontSize: 12, marginTop: 4 },
  sectionLabel: { color: '#94A3B8', fontSize: 14, fontWeight: '500', marginBottom: 12 },
  activityItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  activityText: { flex: 1, color: '#94A3B8', fontSize: 14 },
  activityTime: { color: '#64748B', fontSize: 12 },
  noActivityText: { color: '#64748B', fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  noTrackingText: { color: '#64748B', fontSize: 14, textAlign: 'center', paddingVertical: 40 },
});
