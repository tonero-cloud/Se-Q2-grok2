import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const QUEUE_KEY = 'safeguard_offline_queue';
const MAX_RETRY_ATTEMPTS = 3;

export interface QueuedReport {
  id: string;
  type: 'video' | 'audio';
  localUri: string;
  caption: string;
  isAnonymous: boolean;
  latitude: number;
  longitude: number;
  timestamp: string;
  retryCount: number;
  status: 'pending' | 'uploading' | 'failed';
  errorMessage?: string;
}

/**
 * Get all queued reports
 */
export async function getQueuedReports(): Promise<QueuedReport[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    if (data) {
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error getting queued reports:', error);
    return [];
  }
}

/**
 * Add a report to the offline queue
 */
export async function addToQueue(report: Omit<QueuedReport, 'id' | 'retryCount' | 'status'>): Promise<string> {
  try {
    const queue = await getQueuedReports();
    const newReport: QueuedReport = {
      ...report,
      id: `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      retryCount: 0,
      status: 'pending'
    };
    queue.push(newReport);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    console.log('Report added to offline queue:', newReport.id);
    return newReport.id;
  } catch (error) {
    console.error('Error adding to queue:', error);
    throw error;
  }
}

/**
 * Update a queued report
 */
export async function updateQueuedReport(id: string, updates: Partial<QueuedReport>): Promise<void> {
  try {
    const queue = await getQueuedReports();
    const index = queue.findIndex(r => r.id === id);
    if (index !== -1) {
      queue[index] = { ...queue[index], ...updates };
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    }
  } catch (error) {
    console.error('Error updating queued report:', error);
  }
}

/**
 * Remove a report from the queue
 */
export async function removeFromQueue(id: string): Promise<void> {
  try {
    const queue = await getQueuedReports();
    const filtered = queue.filter(r => r.id !== id);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
    console.log('Report removed from queue:', id);
  } catch (error) {
    console.error('Error removing from queue:', error);
  }
}

/**
 * Clear all queued reports
 */
export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
    console.log('Offline queue cleared');
  } catch (error) {
    console.error('Error clearing queue:', error);
  }
}

/**
 * Get pending reports count
 */
export async function getPendingCount(): Promise<number> {
  const queue = await getQueuedReports();
  return queue.filter(r => r.status === 'pending' || r.status === 'failed').length;
}

/**
 * Check if online
 */
export async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch (error) {
    console.error('Error checking network:', error);
    return false;
  }
}

/**
 * Upload a single queued report
 */
export async function uploadQueuedReport(report: QueuedReport, authToken: string): Promise<boolean> {
  try {
    await updateQueuedReport(report.id, { status: 'uploading' });

    const response = await axios.post(
      `${BACKEND_URL}/api/report/create`,
      {
        type: report.type,
        caption: report.caption || `${report.type} report`,
        is_anonymous: report.isAnonymous,
        file_url: report.localUri, // In production, you'd upload to Firebase first
        thumbnail: null,
        uploaded: true,
        latitude: report.latitude,
        longitude: report.longitude,
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
        timeout: 30000
      }
    );

    if (response.status === 200) {
      await removeFromQueue(report.id);
      console.log('Queued report uploaded successfully:', report.id);
      return true;
    }
    throw new Error('Upload failed with status ' + response.status);
  } catch (error: any) {
    const errorMessage = error.response?.data?.detail || error.message || 'Upload failed';
    console.error('Failed to upload queued report:', errorMessage);
    
    const newRetryCount = report.retryCount + 1;
    if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
      await updateQueuedReport(report.id, { 
        status: 'failed', 
        retryCount: newRetryCount,
        errorMessage: errorMessage
      });
    } else {
      await updateQueuedReport(report.id, { 
        status: 'pending', 
        retryCount: newRetryCount,
        errorMessage: errorMessage
      });
    }
    return false;
  }
}

/**
 * Process all pending uploads in the queue
 */
export async function processQueue(): Promise<{ success: number; failed: number }> {
  const online = await isOnline();
  if (!online) {
    console.log('Offline - skipping queue processing');
    return { success: 0, failed: 0 };
  }

  const authToken = await AsyncStorage.getItem('auth_token');
  if (!authToken) {
    console.log('No auth token - skipping queue processing');
    return { success: 0, failed: 0 };
  }

  const queue = await getQueuedReports();
  const pendingReports = queue.filter(r => r.status === 'pending');
  
  if (pendingReports.length === 0) {
    return { success: 0, failed: 0 };
  }

  console.log(`Processing ${pendingReports.length} queued reports...`);
  
  let success = 0;
  let failed = 0;

  for (const report of pendingReports) {
    const uploaded = await uploadQueuedReport(report, authToken);
    if (uploaded) {
      success++;
    } else {
      failed++;
    }
    // Small delay between uploads
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`Queue processing complete: ${success} success, ${failed} failed`);
  return { success, failed };
}

/**
 * Subscribe to network changes and auto-process queue
 */
export function startQueueProcessor(): () => void {
  let processingTimeout: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable) {
      // Delay processing slightly to ensure stable connection
      if (processingTimeout) clearTimeout(processingTimeout);
      processingTimeout = setTimeout(() => {
        processQueue().then(result => {
          if (result.success > 0) {
            console.log(`Auto-uploaded ${result.success} queued reports`);
          }
        });
      }, 2000);
    }
  });

  // Also process queue immediately on start
  processQueue();

  return () => {
    unsubscribe();
    if (processingTimeout) clearTimeout(processingTimeout);
  };
}
