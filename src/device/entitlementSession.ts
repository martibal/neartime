import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'neartime.entitlement-session.v1';
let cachedSessionToken: string | null | undefined;

export async function getEntitlementSessionToken(): Promise<string | null> {
  if (cachedSessionToken !== undefined) return cachedSessionToken;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  cachedSessionToken = stored || null;
  return cachedSessionToken;
}

export async function setEntitlementSessionToken(token: string): Promise<void> {
  const value = token.trim();
  if (!value) throw new Error('Entitlement session token cannot be empty.');
  await AsyncStorage.setItem(STORAGE_KEY, value);
  cachedSessionToken = value;
}

export async function clearEntitlementSessionToken(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  cachedSessionToken = null;
}
