import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, Switch, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import axios from 'axios';
import Constants from 'expo-constants';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import { addToQueue } from '../../utils/offlineQueue';
import NetInfo from '@react-native-community/netinfo';

const BACKEND_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || 'https://ongoing-dev-22.preview.emergentagent.com';

export default function AudioReport() {
  const router = useRouter();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<any>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    requestPermissions();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Pulse animation for recording indicator
  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const requestPermissions = async () => {
    try {
      const { status: audioStatus } = await Audio.requestPermissionsAsync();
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      
      setHasPermission(audioStatus === 'granted');
      
      if (locationStatus === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ 
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 0
          });
          setLocation(loc);
          console.log('Location obtained:', loc.coords.latitude, loc.coords.longitude);
        } catch (locError: any) {
          console.error('Location error:', locError);
          Alert.alert(
            'Location Service Required',
            'Please enable Location Services in your device settings to get accurate location for reports.',
            [{ text: 'OK' }]
          );
          setLocation({ coords: { latitude: 9.0820, longitude: 8.6753 } } as any);
        }
      } else {
        setLocation({ coords: { latitude: 9.0820, longitude: 8.6753 } } as any);
      }
    } catch (error) {
      console.error('Permission error:', error);
    }
  };

  const startRecording = async () => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      console.log('Starting recording...');
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(recording);
      setIsRecording(true);
      setRecordingDuration(0);
      
      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      
      console.log('Recording started');
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) {
        setAudioUri(uri);
      }
      console.log('Recording stopped:', uri);
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setIsRecording(false);
      setRecording(null);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const submitReport = async () => {
    if (!audioUri) {
      Alert.alert('Error', 'Please record audio first');
      return;
    }

    setLoading(true);
    try {
      let currentLocation = location;
      try {
        currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      } catch {}

      const netInfo = await NetInfo.fetch();
      const isConnected = netInfo.isConnected && netInfo.isInternetReachable !== false;

      const reportData = {
        type: 'audio',
        localUri: audioUri,
        fileName: `audio_report_${Date.now()}.m4a`,
        mimeType: 'audio/m4a',
        caption,
        isAnonymous,
        latitude: currentLocation?.coords?.latitude || 9.0820,
        longitude: currentLocation?.coords?.longitude || 8.6753,
        durationSeconds: recordingDuration,
        timestamp: new Date().toISOString(),
      };

      if (!isConnected) {
        await addToQueue(reportData);
        Alert.alert('Offline', 'Audio saved locally. Will upload when online.');
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
        uri: audioUri,
        name: `audio_report_${Date.now()}.m4a`,
        type: 'audio/m4a',
      } as any);

      formData.append('type', 'audio');
      formData.append('caption', caption || 'Audio security report');
      formData.append('is_anonymous', isAnonymous.toString());
      formData.append('latitude', currentLocation.coords.latitude.toString());
      formData.append('longitude', currentLocation.coords.longitude.toString());
      formData.append('duration_seconds', recordingDuration.toString());

      const response = await axios.post(
        `${BACKEND_URL}/api/report/create`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
          timeout: 60000,
        }
      );

      Alert.alert('Success!', 'Your audio report has been submitted.');
      router.back();
    } catch (error: any) {
      console.error('Submit error:', error);
      Alert.alert('Error', error?.response?.data?.detail || 'Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  const retakeRecording = () => {
    setAudioUri(null);
    setRecordingDuration(0);
    setCaption('');
    setIsAnonymous(false);
  };

  if (hasPermission === null) {
    return <View />;
  }

  if (hasPermission === false) {
    return (
      <View style={styles.centerContent}>
        <Text style={styles.permissionText}>
          We need microphone permission to record audio reports.
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Audio Report</Text>
        <View style={styles.placeholder} />
      </View>
      
      <View style={styles.content}>
        {!audioUri ? (
          <View style={styles.recordingSection}>
            <View style={styles.microphoneContainer}>
              <Animated.View 
                style={[
                  styles.microphoneCircle,
                  isRecording && styles.recordingPulse,
                  { transform: [{ scale: pulseAnim }] }
                ]}
              >
                <Ionicons name="mic" size={80} color={isRecording ? '#EF4444' : '#8B5CF6'} />
              </Animated.View>
            </View>

            {isRecording ? (
              <View style={styles.timerContainer}>
                <View style={styles.timerBox}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.timerText}>{formatTime(recordingDuration)}</Text>
                </View>
                <Text style={styles.recordingLabel}>Recording in progress...</Text>
              </View>
            ) : (
              <Text style={styles.instruction}>
                Press and hold to record your audio report
              </Text>
            )}

            <TouchableOpacity 
              style={[styles.recordButton, isRecording && styles.stopButton]}
              onPressIn={startRecording}
              onPressOut={stopRecording}
            >
              <Ionicons name={isRecording ? 'stop' : 'mic'} size={24} color="#fff" />
              <Text style={styles.recordButtonText}>
                {isRecording ? 'Stop Recording' : 'Hold to Record'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.formContainer}>
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={80} color="#8B5CF6" />
              <Text style={styles.successText}>Audio Recorded</Text>
              <Text style={styles.durationText}>{formatTime(recordingDuration)} seconds</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Caption (optional)</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Describe the incident..."
                placeholderTextColor="#64748B"
                multiline
                value={caption}
                onChangeText={setCaption}
              />
            </View>

            <View style={styles.switchContainer}>
              <View>
                <Text style={styles.switchLabel}>Anonymous Report</Text>
                <Text style={styles.switchDescription}>Hide your identity from responders</Text>
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
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Report</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.retakeButton}
              onPress={retakeRecording}
              disabled={loading}
            >
              <Text style={styles.retakeButtonText}>Record Again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  placeholder: { width: 32 },
  content: { flex: 1, padding: 24 },
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
});
