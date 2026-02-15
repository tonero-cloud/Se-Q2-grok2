import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import Constants from 'expo-constants';
import { getAuthToken, clearAuthData } from '../../utils/auth';

const BACKEND_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || 'https://ongoing-dev-22.preview.emergentagent.com';

export default function AdminUsers() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [roleFilter, setRoleFilter] = useState(params.role as string || '');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadUsers();
  }, [roleFilter]);

  const loadUsers = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }
      
      let url = `${BACKEND_URL}/api/admin/users?limit=100`;
      if (roleFilter) url += `&role=${roleFilter}`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      setUsers(response.data.users);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      } else {
        Alert.alert('Error', 'Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUsers();
    setRefreshing(false);
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/admin/login');
        return;
      }
      
      await axios.put(`${BACKEND_URL}/api/admin/users/${userId}/toggle`, {}, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      
      setUsers(users.map(u => 
        u.id === userId ? { ...u, is_active: !currentStatus } : u
      ));
      Alert.alert('Success', `User ${currentStatus ? 'deactivated' : 'activated'}`);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await clearAuthData();
        router.replace('/admin/login');
      } else {
        Alert.alert('Error', 'Failed to update user status');
      }
    }
  };

  const getRoleBadge = (role: string, subRole?: string) => {
    const colors: any = {
      admin: '#8B5CF6',
      security: '#F59E0B',
      civil: '#10B981'
    };
    return (
      <View style={[styles.badge, { backgroundColor: `${colors[role] || '#64748B'}20` }]}>
        <Text style={[styles.badgeText, { color: colors[role] || '#64748B' }]}>
          {role.toUpperCase()}{subRole ? ` - ${subRole}` : ''}
        </Text>
      </View>
    );
  };

  const filteredUsers = users.filter(u => 
    u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderUser = ({ item }: any) => (
    <View style={[styles.userCard, !item.is_active && styles.inactiveCard]}>
      <View style={styles.userInfo}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={24} color="#64748B" />
        </View>
        <View style={styles.userDetails}>
          <Text style={styles.userName}>{item.full_name || item.email}</Text>
          <Text style={styles.userEmail}>{item.email}</Text>
          <View style={styles.badgeRow}>
            {getRoleBadge(item.role, item.security_sub_role)}
            {item.team_name && (
              <Text style={styles.teamName}>Team: {item.team_name}</Text>
            )}
          </View>
        </View>
      </View>
      <View style={styles.userActions}>
        <View style={[styles.statusDot, { backgroundColor: item.is_active ? '#10B981' : '#EF4444' }]} />
        <TouchableOpacity 
          style={styles.toggleButton}
          onPress={() => toggleUserStatus(item.id, item.is_active)}
        >
          <Ionicons 
            name={item.is_active ? 'close-circle' : 'checkmark-circle'} 
            size={24} 
            color={item.is_active ? '#EF4444' : '#10B981'} 
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/admin/dashboard")}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>User Management</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.filters}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#64748B" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users..."
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <View style={styles.filterButtons}>
          {['', 'civil', 'security', 'admin'].map((role) => (
            <TouchableOpacity
              key={role}
              style={[styles.filterButton, roleFilter === role && styles.filterButtonActive]}
              onPress={() => setRoleFilter(role)}
            >
              <Text style={[styles.filterButtonText, roleFilter === role && styles.filterButtonTextActive]}>
                {role || 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={filteredUsers}
        renderItem={renderUser}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color="#64748B" />
            <Text style={styles.emptyText}>No users found</Text>
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
  filters: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 16, gap: 8 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 16, color: '#fff' },
  filterButtons: { flexDirection: 'row', gap: 8 },
  filterButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1E293B' },
  filterButtonActive: { backgroundColor: '#8B5CF6' },
  filterButtonText: { fontSize: 14, color: '#64748B', textTransform: 'capitalize' },
  filterButtonTextActive: { color: '#fff' },
  list: { padding: 20, gap: 12 },
  userCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inactiveCard: { opacity: 0.6 },
  userInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userDetails: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  userEmail: { fontSize: 14, color: '#64748B', marginBottom: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: '600' },
  teamName: { fontSize: 12, color: '#64748B' },
  userActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  toggleButton: { padding: 4 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 8 },
});
