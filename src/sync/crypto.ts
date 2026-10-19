// 瀏覽器端加密：密語 → PBKDF2-SHA256（60 萬次）→ AES-GCM 256。
// 存到 GitHub 的只有這個信封；沒有密語就讀不出內容，被竄改也會解密失敗。

export interface Envelope {
  app: 'wealth-ledger';
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: 'AES-GCM';
  iv: string;
  zip: 'gzip' | 'none';
  data: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('密語不正確，或資料已損毀');
  }
}

const ITERATIONS = 600_000;
type Bytes = Uint8Array<ArrayBuffer>;

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Bytes {
  const s = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Bytes, stream: CompressionStream | DecompressionStream): Promise<Bytes> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

// 同一個密語＋鹽只推導一次（60 萬次 PBKDF2 在手機上約 0.5 秒）
const keyCache = new Map<string, Promise<CryptoKey>>();
function deriveKey(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const id = `${iterations}|${toB64(salt)}|${passphrase}`;
  let k = keyCache.get(id);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keyCache.set(id, k);
  }
  return k;
}

// salt 沿用遠端檔案既有的，讓同一份資料的密語推導結果穩定；第一次存檔才產生新的
export async function seal(plain: string, passphrase: string, saltB64?: string): Promise<Envelope> {
  const salt: Bytes = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv: Bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  let bytes: Bytes = new Uint8Array(new TextEncoder().encode(plain));
  const zip = canZip() ? 'gzip' : 'none';
  if (zip === 'gzip') bytes = await pipe(bytes, new CompressionStream('gzip'));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return {
    app: 'wealth-ledger',
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toB64(salt) },
    cipher: 'AES-GCM',
    iv: toB64(iv),
    zip,
    data: toB64(ct),
  };
}

export async function unseal(env: Envelope, passphrase: string): Promise<string> {
  if (env?.app !== 'wealth-ledger' || env.v !== 1) throw new Error('遠端檔案不是這個 App 的加密資料');
  const key = await deriveKey(passphrase, fromB64(env.kdf.salt), env.kdf.iterations);
  let bytes: Bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.data)));
  } catch {
    throw new WrongPassphraseError();
  }
  if (env.zip === 'gzip') bytes = await pipe(bytes, new DecompressionStream('gzip'));
  return new TextDecoder().decode(bytes);
}
