import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

import { getAuthToken, clearAuthData } from '../../utils/auth';

import { BACKEND_URL } from '../../utils/api';

export default function AdminMessaging() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'civil' | 'security'>('all');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [messageContent, setMessageContent] = useState('');
  const [sending, setSending] = useState(false);

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
      
      // Filter out admin users
      const nonAdminUsers = (response.data || []).filter((u: any) => u.role !== 'admin');
      setUsers(nonAdminUsers);
    } catch (error: any) {
      console.error('[AdminMessaging] Error:', error);
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        await clearAuthData();
        router.replace('/admin/login');
      }
    } finally {
      setLoading(false);
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

  const sendMessage = async () => {
    if (!selectedUser || !messageContent.trim()) {
      Alert.alert('Error', 'Please select a user and enter a message');
      return;
    }

    setSending(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      await axios.post(
        `${BACKEND_URL}/api/admin/message`,
        {
          to_user_id: selectedUser._id || selectedUser.id,
          content: messageContent.trim()
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000
        }
      );

      Alert.alert('Success', `Message sent to ${selectedUser.full_name}`);
      setMessageContent('');
      setSelectedUser(null);
    } catch (error: any) {
      console.error('[AdminMessaging] Send error:', error);
      Alert.alert('Error', error?.response?.data?.detail || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const renderUser = ({ item }: any) => (
    <TouchableOpacity 
      style={styles.userCard}
      onPress={() => setSelectedUser(item)}
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
        <View style={[styles.roleBadge, { backgroundColor: item.role === 'security' ? '#F59E0B20' : '#10B98120' }]}>
          <Text style={[styles.roleText, { color: item.role === 'security' ? '#F59E0B' : '#10B981' }]}>
            {item.role?.toUpperCase()}
          </Text>
        </View>
      </View>
      <Ionicons name="chatbubble-ellipses" size={24} color="#3B82F6" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Admin Messaging</Text>
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

      {/* User List */}
      {loading ? (
        <ActivityIndicator size="large" color="#8B5CF6" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderUser}
          keyExtractor={(item) => item._id || item.id}
          contentContainerStyle={styles.userList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color="#64748B" />
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          }
        />
      )}

      {/* Message Modal */}
      <Modal visible={!!selectedUser} animationType="slide" transparent>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Send Message</Text>
              <TouchableOpacity onPress={() => setSelectedUser(null)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <View style={styles.recipientCard}>
                <View style={[styles.avatar, { backgroundColor: selectedUser.role === 'security' ? '#F59E0B20' : '#10B98120' }]}>
                  <Ionicons 
                    name={selectedUser.role === 'security' ? 'shield' : 'person'} 
                    size={24} 
                    color={selectedUser.role === 'security' ? '#F59E0B' : '#10B981'} 
                  />
                </View>
                <View>
                  <Text style={styles.recipientName}>{selectedUser.full_name}</Text>
                  <Text style={styles.recipientEmail}>{selectedUser.email}</Text>
                </View>
              </View>
            )}

            <Text style={styles.inputLabel}>Message</Text>
            <TextInput
              style={styles.messageInput}
              placeholder="Type your message..."
              placeholderTextColor="#64748B"
              value={messageContent}
              onChangeText={setMessageContent}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity 
              style={[styles.sendButton, (!messageContent.trim() || sending) && styles.sendButtonDisabled]}
              onPress={sendMessage}
              disabled={!messageContent.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={20} color="#fff" />
                  <Text style={styles.sendButtonText}>Send Message</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  userList: { paddingHorizontal: 20, paddingTop: 16 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, padding: 16, marginBottom: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  userInfo: { flex: 1, marginLeft: 12 },
  userName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  userEmail: { fontSize: 14, color: '#94A3B8', marginTop: 2 },
  roleBadge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 4, marginTop: 6 },
  roleText: { fontSize: 11, fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: '#64748B', marginTop: 12 },
  
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  recipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 12, padding: 16, marginBottom: 20, gap: 12 },
  recipientName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  recipientEmail: { fontSize: 14, color: '#94A3B8', marginTop: 2 },
  inputLabel: { color: '#94A3B8', fontSize: 14, marginBottom: 8 },
  messageInput: { backgroundColor: '#0F172A', borderRadius: 12, padding: 16, color: '#fff', fontSize: 16, minHeight: 120, textAlignVertical: 'top' },
  sendButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#8B5CF6', paddingVertical: 16, borderRadius: 12, marginTop: 20 },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
