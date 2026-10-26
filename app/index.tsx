import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Speech from 'expo-speech';
import { setAudioModeAsync } from 'expo-audio';

// Key is loaded from .env (EXPO_PUBLIC_GEMINI_API_KEY), not stored here.
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY as string;

const PROMPT = `Read aloud the text in this image in natural reading order.
If it is a book page, read only the body text - skip headers, footers, and page numbers.
Rejoin words that are hyphenated across line breaks.
If there is no text, briefly describe what you see instead.
Output only the text to be spoken, nothing else.`;

export default function Index() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Point at a page and tap');
  const [photo, setPhoto] = useState<string | null>(null);

  const readPage = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setStatus('Camera permission needed'); return; }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.5,
        base64: true,
      });
      if (result.canceled) return;

      setPhoto(result.assets[0].uri);
      setBusy(true);
      setStatus('Reading...');
      Speech.stop();
      await setAudioModeAsync({ playsInSilentMode: true });

      const resp = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: 'image/jpeg', data: result.assets[0].base64 } },
              ],
            }],
          }),
        }
      );
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text)
        .filter(Boolean)
        .join(' ');

      if (!text) {
        const errMsg = data?.error?.message || JSON.stringify(data).slice(0, 200);
        setStatus('API said: ' + errMsg);
        setBusy(false);
        return;
      }

      setStatus('Speaking - tap again for next page');
      Speech.speak(text, { rate: 1.0 });
      setBusy(false);
    } catch (e: any) {
      setStatus('Error: ' + e.message);
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reading Glasses</Text>
      {photo && <Image source={{ uri: photo }} style={styles.preview} />}
      <Text style={styles.status}>{status}</Text>
      <TouchableOpacity style={styles.button} onPress={readPage} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" size="large" />
              : <Text style={styles.buttonText}>📖 READ</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.stopButton} onPress={() => Speech.stop()}>
        <Text style={styles.buttonText}>⏹ STOP</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { color: '#fff', fontSize: 28, fontWeight: 'bold', marginBottom: 10 },
  preview: { width: 180, height: 240, borderRadius: 8, marginBottom: 10 },
  status: { color: '#aaa', fontSize: 16, textAlign: 'center', marginBottom: 30 },
  button: { backgroundColor: '#2266ee', paddingVertical: 24, paddingHorizontal: 60, borderRadius: 16, marginBottom: 16 },
  stopButton: { backgroundColor: '#663333', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12 },
  buttonText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
});
