import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, 
  ActivityIndicator, Switch, Animated, ScrollView, Dimensions,
  Modal, KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Camera, CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import { File } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import Slider from '@react-native-community/slider';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import { addToQueue } from '../../utils/offlineQueue';
import NetInfo from '@react-native-community/netinfo';

import { BACKEND_URL } from '../../utils/api';
const MIN_RECORDING_DURATION = 2;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function VideoReport() {
  const router = useRouter();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [caption, setCaption] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cameraRef, setCameraRef] = useState<any>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [location, setLocation] = useState<any>(null);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [savedDuration, setSavedDuration] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [showCaptionModal, setShowCaptionModal] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  
  const recordingPromiseRef = useRef<Promise<any> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const durationRef = useRef(0);

  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isRecording]);

  useEffect(() => {
    let interval: any;
    if (isRecording && recordingStartTime) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        setRecordingDuration(elapsed);
        durationRef.current = elapsed;
      }, 100);
    } else if (!isRecording && recordingStartTime === null && durationRef.current > 0) {
      setSavedDuration(durationRef.current);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isRecording, recordingStartTime]);

  useEffect(() => {
    requestPermissions();
  }, []);

  const requestPermissions = async () => {
    try {
      const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
      const { status: micStatus } = await Camera.requestMicrophonePermissionsAsync();
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      
      setHasPermission(cameraStatus === 'granted' && micStatus === 'granted');
      
      if (locationStatus === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setLocation(loc);
      } else {
        setLocation({ coords: { latitude: 9.0820, longitude: 8.6753 } });
      }
    } catch (error) {
      console.error('[VideoReport] Permission error:', error);
      setHasPermission(false);
    }
  };

  const startRecording = async () => {
    if (!cameraRef || !cameraReady) {
      Alert.alert('Please Wait', 'Camera is still initializing...');
      return;
    }

    durationRef.current = 0;
    setRecordingDuration(0);
    setSavedDuration(0);
    setRecordingUri(null);
    
    setIsRecording(true);
    setRecordingStartTime(Date.now());
    
    try {
      console.log('[VideoReport] Starting recording...');
      recordingPromiseRef.current = cameraRef.recordAsync({ 
        maxDuration: 300, 
        quality: '720p',
        mute: false
      });
      
      const video = await recordingPromiseRef.current;
      
      console.log('[VideoReport] Recording finished:', video);
      
      if (video && video.uri) {
        const file = new File(video.uri);
        const fileInfo = await file.info();
        console.log('[VideoReport] File info:', fileInfo);
        
        if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
          setRecordingUri(video.uri);
          const finalDuration = durationRef.current > 0 ? durationRef.current : 2;
          setSavedDuration(finalDuration);
          setShowCaptionModal(true);
        } else {
          throw new Error('Video file is empty or invalid');
        }
      } else {
        throw new Error('No video URI returned');
      }
    } catch (error: any) {
      console.error('[VideoReport] Recording error:', error);
      if (!error?.message?.toLowerCase().includes('stopped')) {
        Alert.alert('Recording Error', error?.message || 'Failed to record video.');
      }
    } finally {
      setIsRecording(false);
      setRecordingStartTime(null);
      recordingPromiseRef.current = null;
    }
  };

  const stopRecording = async () => {
    if (recordingPromiseRef.current && isRecording) {
      try {
        await cameraRef.stopRecording();
      } catch (err) {
        console.warn('Stop recording failed:', err);
      }
    }
  };

  const submitReport = async () => {
    if (!recordingUri) {
      Alert.alert('Error', 'Please record video first');
      return;
    }

    setLoading(true);
    setUploadProgress(0);
    try {
      let currentLocation = location;
      try {
        currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      } catch {}

      const netInfo = await NetInfo.fetch();
      const isConnected = netInfo.isConnected && netInfo.isInternetReachable !== false;

      const reportData = {
        type: 'video',
        localUri: recordingUri,
        fileName: `video_report_${Date.now()}.mp4`,
        mimeType: 'video/mp4',
        caption,
        isAnonymous,
        latitude: currentLocation?.coords?.latitude || 9.0820,
        longitude: currentLocation?.coords?.longitude || 8.6753,
        durationSeconds: savedDuration,
        timestamp: new Date().toISOString(),
      };

      if (!isConnected) {
        await addToQueue(reportData);
        Alert.alert('Offline', 'Video saved locally. Will upload when online.');
        router.back();
        return;
      }

      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }

      const formData = new FormData();
      formData.append('file', {
        uri: recordingUri,
        name: `video_report_${Date.now()}.mp4`,
        type: 'video/mp4',
      } as any);

      formData.append('type', 'video');
      formData.append('caption', caption || 'Video security report');
      formData.append('is_anonymous', isAnonymous.toString());
      formData.append('latitude', currentLocation.coords.latitude.toString());
      formData.append('longitude', currentLocation.coords.longitude.toString());
      formData.append('duration_seconds', savedDuration.toString());

      const response = await axios.post(
        `${BACKEND_URL}/api/report/create`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
          timeout: 120000,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setUploadProgress(percent);
            }
          },
        }
      );

      Alert.alert('Success!', 'Your video report has been submitted.');
      setRecordingUri(null);
      setCaption('');
      setShowCaptionModal(false);
      router.back();
    } catch (error: any) {
      console.error('Submit error:', error);
      Alert.alert('Error', error?.response?.data?.detail || 'Failed to submit report');
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const onCameraReady = () => {
    setCameraReady(true);
  };

  const flipCamera = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  if (hasPermission === null) {
    return <View />;
  }
  if (hasPermission === false) {
    return (
      <View style={styles.centerContent}>
        <Text style={styles.permissionText}>
          We need camera and microphone permissions to record video reports.
        </Text>
        <TouchableOpacity style={styles.button} onPress={requestPermissions}>
          <Text style={styles.buttonText}>Grant Permissions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButtonAlt} onPress={() => router.back()}>
          <Text style={styles.backButtonTextAlt}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading || uploadProgress > 0) {
    return (
      <View style={styles.loadingOverlay}>
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingTitle}>Uploading Video</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
          </View>
          <Text style={styles.progressText}>{uploadProgress}%</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Video Report</Text>
        <TouchableOpacity onPress={flipCamera}>
          <Ionicons name="camera-reverse" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      <CameraView
        style={styles.camera}
        ref={ref => setCameraRef(ref)}
        facing={facing}
        mode="video"
        zoom={zoom}
        onCameraReady={onCameraReady}
      >
        <View style={styles.zoomContainer}>
          <Text style={styles.zoomLabel}>Zoom: {Math.round(zoom * 100)}%</Text>
          <Slider
            style={styles.zoomSlider}
            minimumValue={0}
            maximumValue={1}
            minimumTrackTintColor="#fff"
            maximumTrackTintColor="#000"
            onValueChange={setZoom}
            value={zoom}
          />
        </View>

        {savedDuration > 0 && (
          <View style={styles.recordedBadge}>
            <Ionicons name="checkmark-circle" size={24} color="#fff" />
            <Text style={styles.recordedText}>
              Recorded {savedDuration}s
            </Text>
          </View>
        )}

        <View style={styles.bottomOverlay}>
          <Text style={styles.instructionText}>
            Hold the record button to capture video
          </Text>
          <View style={styles.controlsRow}>
            <TouchableOpacity style={styles.sideButton}>
              {/* Left side placeholder */}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.recordButton, isRecording && styles.recordButtonActive]}
              onPressIn={startRecording}
              onPressOut={stopRecording}
            >
              <Animated.View 
                style={[
                  styles.recordButtonInner,
                  isRecording && styles.recordButtonInnerActive,
                  { transform: [{ scale: pulseAnim }] }
                ]}
              >
                {isRecording ? (
                  <View style={styles.recordingDot} />
                ) : (
                  <View style={styles.recordButtonCircle} />
                )}
              </Animated.View>
            </TouchableOpacity>

            {savedDuration > 0 && (
              <TouchableOpacity 
                style={styles.uploadButton}
                onPress={() => setShowCaptionModal(true)}
              >
                <Ionicons name="cloud-upload" size={24} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </CameraView>

      {/* Caption Modal */}
      <Modal
        visible={showCaptionModal}
        animationType="slide"
        transparent
      >
        <KeyboardAvoidingView 
          style={styles.modalOverlay} 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Details</Text>
              <TouchableOpacity onPress={() => setShowCaptionModal(false)}>
                <Ionicons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Caption (optional)</Text>
            <TextInput
              style={styles.captionInput}
              placeholder="Describe the incident..."
              placeholderTextColor="#64748B"
              multiline
              value={caption}
              onChangeText={setCaption}
            />

            <View style={styles.toggleRow}>
              <View>
                <Text style={styles.toggleLabel}>Anonymous</Text>
                <Text style={styles.toggleDescription}>Hide your identity</Text>
              </View>
              <Switch
                value={isAnonymous}
                onValueChange={setIsAnonymous}
                trackColor={{ false: '#334155', true: '#10B981' }}
                thumbColor={isAnonymous ? '#fff' : '#f4f3f4'}
              />
            </View>

            <TouchableOpacity 
              style={styles.submitButton}
              onPress={submitReport}
            >
              <Ionicons name="cloud-upload" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Submit Report</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 20, 
    backgroundColor: '#000' 
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  camera: { flex: 1, justifyContent: 'space-between' },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  permissionText: { fontSize: 16, color: '#94A3B8', marginTop: 16, marginBottom: 24, textAlign: 'center' },
  button: { backgroundColor: '#8B5CF6', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 12, marginBottom: 12 },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  backButtonAlt: { padding: 12 },
  backButtonTextAlt: { fontSize: 16, fontWeight: '600', color: '#64748B' },
  recordingSection: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  microphoneContainer: { marginBottom: 32 },
  microphoneCircle: { width: 180, height: 180, borderRadius: 90, backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#8B5CF6' },
  recordingPulse: { borderColor: '#EF4444', backgroundColor: '#EF444420' },
  timerContainer: { alignItems: 'center', marginBottom: 24 },
  timerBox: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#1E293B', 
    paddingHorizontal: 24, 
    paddingVertical: 16, 
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#EF4444',
    marginBottom: 8
  },
  timerText: { 
    fontSize: 48, 
    fontWeight: 'bold', 
    color: '#EF4444',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2
  },
  recordingDot: { 
    width: 16, 
    height: 16, 
    borderRadius: 8, 
    backgroundColor: '#EF4444', 
    marginRight: 16 
  },
  recordingLabel: { fontSize: 14, color: '#94A3B8' },
  instruction: { fontSize: 16, color: '#94A3B8', textAlign: 'center', marginBottom: 32 },
  recordButton: { flexDirection: 'row', backgroundColor: '#8B5CF6', paddingHorizontal: 32, paddingVertical: 18, borderRadius: 12, alignItems: 'center', gap: 12 },
  stopButton: { backgroundColor: '#EF4444' },
  recordButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  formContainer: { flex: 1 },
  successBox: { alignItems: 'center', marginTop: 20, marginBottom: 32 },
  successText: { fontSize: 18, fontWeight: '600', color: '#8B5CF6', marginTop: 16 },
  durationText: { fontSize: 14, color: '#94A3B8', marginTop: 8 },
  inputContainer: { marginBottom: 24 },
  label: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 8 },
  textArea: { backgroundColor: '#1E293B', borderRadius: 12, padding: 16, color: '#fff', fontSize: 16, minHeight: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: '#334155' },
  switchContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1E293B', padding: 16, borderRadius: 12, marginBottom: 24 },
  switchLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },
  switchDescription: { fontSize: 14, color: '#94A3B8', marginTop: 4 },
  submitButton: { backgroundColor: '#8B5CF6', borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginBottom: 16 },
  submitButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  retakeButton: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#64748B' },
  retakeButtonText: { fontSize: 16, fontWeight: '600', color: '#64748B' },
  zoomContainer: { 
    position: 'absolute', top: 120, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 12
  },
  zoomLabel: { color: '#fff', fontSize: 14, marginBottom: 8, textAlign: 'center' },
  zoomSlider: { width: '100%', height: 40 },
  recordedBadge: { 
    position: 'absolute', top: 180, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.9)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, gap: 8
  },
  recordedText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  bottomOverlay: { 
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20, paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)'
  },
  controlsRow: { 
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    paddingHorizontal: 40
  },
  sideButton: { width: 60 },
  recordButton: { 
    width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent'
  },
  recordButtonActive: { borderColor: '#EF4444' },
  recordButtonInner: { 
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#EF4444',
    justifyContent: 'center', alignItems: 'center'
  },
  recordButtonInnerActive: { backgroundColor: '#EF4444', borderRadius: 8 },
  recordButtonCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  uploadButton: { 
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#10B981',
    justifyContent: 'center', alignItems: 'center'
  },
  instructionText: { color: '#fff', textAlign: 'center', marginTop: 16, fontSize: 14, opacity: 0.8 },
  loadingOverlay: { 
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center', alignItems: 'center'
  },
  loadingCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 32, alignItems: 'center', width: 280 },
  loadingTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 20 },
  progressBar: { width: '100%', height: 8, backgroundColor: '#334155', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#10B981' },
  progressText: { color: '#94A3B8', marginTop: 8 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  inputLabel: { color: '#94A3B8', marginBottom: 8, fontSize: 14 },
  captionInput: { 
    backgroundColor: '#0F172A', borderRadius: 12, padding: 16, color: '#fff', 
    minHeight: 100, textAlignVertical: 'top', marginBottom: 20
  },
  toggleRow: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#0F172A', padding: 16, borderRadius: 12, marginBottom: 20
  },
  toggleLabel: { color: '#fff', fontWeight: '500' },
  toggleDescription: { color: '#64748B', fontSize: 12, marginTop: 2 },
  submitButton: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12
  },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
