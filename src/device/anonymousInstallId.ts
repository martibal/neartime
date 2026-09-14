import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'neartime.anonymous-install-id.v1';
let cachedInstallId: string | null = null;

function randomHex(bytes: number): string {
  let value = '';
  for (let index = 0; index < bytes; index += 1) {
    value += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return value;
}

function createAnonymousInstallId(): string {
  return `nti_${Date.now().toString(36)}_${randomHex(16)}`;
}

/**
 * Returns a locally generated opaque installation identifier.
 *
 * It contains no account, hardware, advertising or location information.
 * The value is stored only on the device and is sent to the NearTime backend
 * solely for quota/rate-limit accounting. Clearing app storage or reinstalling
 * the app can create a new identifier.
 */
export async function getAnonymousInstallId(): Promise<string> {
  if (cachedInstallId) return cachedInstallId;

  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    cachedInstallId = stored;
    return stored;
  }

  const created = createAnonymousInstallId();
  await AsyncStorage.setItem(STORAGE_KEY, created);
  cachedInstallId = created;
  return created;
}
