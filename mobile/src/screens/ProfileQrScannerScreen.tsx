import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { openPublicProfile } from '../services/publicProfileNavigation';

/** Camera is mounted only while this focused screen is visible. */
export function ProfileQrScannerScreen() {
  const { colors } = useTheme(); const navigation = useNavigation(); const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions(); const [scanned, setScanned] = useState(false);
  useEffect(() => { if (!focused) setScanned(false); }, [focused]);
  const handleScan = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    if (openPublicProfile(data)) navigation.goBack();
    else setScanned(false);
  };
  if (!permission) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} />;
  if (!permission.granted) return <SafeAreaView style={{ flex: 1, padding: 24, gap: 16, backgroundColor: colors.background }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 26, fontWeight: '700' }}>Scan a profile QR</Text><Text style={{ color: colors.textSecondary }}>Camera access is used only while this screen is open to scan a One Concept profile QR code.</Text><Pressable accessibilityRole="button" onPress={() => void requestPermission()} style={{ minHeight: 48, justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary }}><Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>Allow camera</Text></Pressable>{permission.canAskAgain === false && <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.primary, textAlign: 'center', fontWeight: '700' }}>Open device settings</Text></Pressable>}<Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.primary, textAlign: 'center', fontWeight: '700' }}>Use a link instead</Text></Pressable></SafeAreaView>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}><CameraView active={focused && !scanned} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : handleScan} style={{ flex: 1 }} /><View style={{ position: 'absolute', left: 24, right: 24, bottom: 36, gap: 12 }}><Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>Point your camera at a One Concept profile QR</Text><Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={{ minHeight: 48, borderRadius: 14, justifyContent: 'center', backgroundColor: '#fff' }}><Text style={{ color: '#111', textAlign: 'center', fontWeight: '700' }}>Cancel</Text></Pressable></View></SafeAreaView>;
}
