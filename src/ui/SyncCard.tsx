import { useState } from 'react';
import { defaultDeviceName, syncBlocked, type SyncApi } from '../sync/useSync';
import { Card, Notice } from './components';

const STATE_LABEL = {
  off: '未啟用',
  blocked: '此網址不支援',
  locked: '需要密語',
  syncing: '同步中…',
  ok: '已同步',
  error: '同步失敗',
} as const;

// 頁首的小狀態燈
export function SyncBadge({ sync, onClick }: { sync: SyncApi; onClick: () => void }) {
  const s = sync.status;
  if (s.state === 'off' || s.state === 'blocked') return null;
  const tone = s.state === 'error' || s.state === 'locked' ? 'var(--ochre)' : s.state === 'syncing' ? 'var(--muted)' : 'var(--series-1)';
  return (
    <button className="sync-badge" onClick={onClick} title={s.message ?? ''}>
      <i style={{ background: tone }} />
      {STATE_LABEL[s.state]}
      {s.state === 'ok' && s.at && ` ${s.at}`}
    </button>
  );
}

export function SyncCard({ sync }: { sync: SyncApi }) {
  const cfg = sync.config;
  const [form, setForm] = useState({
    owner: cfg?.owner ?? '',
    repo: cfg?.repo ?? 'wealth-ledger-data',
    path: cfg?.path ?? 'ledger.enc.json',
    token: '',
    passphrase: '',
    confirm: '',
    device: cfg?.device ?? defaultDeviceName(),
    apiBase: cfg?.apiBase ?? '',
    remember: true,
  });
  const [msg, setMsg] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const s = sync.status;

  if (syncBlocked()) {
    return (
      <Card title="裝置同步" desc="手機、電腦自動同步，資料加密後存在你的私人 GitHub repo。">
        <Notice items={['這個網址在 github.io 底下，和你其他 GitHub Pages 網站共用同一個網域，瀏覽器裡的資料彼此讀得到，所以這裡不啟用同步。請改用獨立網域的網址。']} />
      </Card>
    );
  }

  async function enable() {
    if (!form.owner || !form.repo || !form.token || !form.passphrase) return setMsg(['帳號、repo、token、密語都要填']);
    if (form.passphrase.length < 10) return setMsg(['密語至少 10 個字元；建議用一句只有你知道的話']);
    if (form.passphrase !== form.confirm) return setMsg(['兩次輸入的密語不同']);
    setBusy(true);
    setMsg([]);
    const err = await sync.enable(
      {
        owner: form.owner.trim(),
        repo: form.repo.trim(),
        path: form.path.trim() || 'ledger.enc.json',
        token: form.token.trim(),
        passphrase: form.passphrase,
        device: form.device.trim() || defaultDeviceName(),
        apiBase: form.apiBase.trim() || undefined,
      },
      form.remember,
    );
    setBusy(false);
    setMsg(err ? [err] : ['已啟用同步']);
    if (!err) setForm((f) => ({ ...f, token: '', passphrase: '', confirm: '' }));
  }

  if (!cfg) {
    return (
      <Card title="裝置同步" desc="手機、電腦自動同步。資料在瀏覽器裡用你的密語加密後，存到你的私人 GitHub repo；GitHub 上只看得到亂碼。">
        <div className="row">
          <label className="field">
            GitHub 帳號
            <input value={form.owner} onChange={set('owner')} placeholder="你的帳號" autoComplete="off" />
          </label>
          <label className="field">
            私人 repo
            <input value={form.repo} onChange={set('repo')} autoComplete="off" />
          </label>
          <label className="field">
            Token
            <input type="password" value={form.token} onChange={set('token')} placeholder="github_pat_…" autoComplete="off" />
          </label>
          <label className="field">
            裝置名稱
            <input value={form.device} onChange={set('device')} style={{ width: 110 }} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field">
            密語
            <input type="password" value={form.passphrase} onChange={set('passphrase')} autoComplete="new-password" />
          </label>
          <label className="field">
            再輸入一次
            <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={form.remember} onChange={(e) => setForm((f) => ({ ...f, remember: e.target.checked }))} />
            在這台裝置記住密語
          </label>
          {import.meta.env.DEV && (
            <label className="field">
              API 位址（開發測試用）
              <input value={form.apiBase} onChange={set('apiBase')} placeholder="https://api.github.com" />
            </label>
          )}
          <button className="primary" onClick={enable} disabled={busy}>
            {busy ? '連線中…' : '啟用同步'}
          </button>
        </div>
        <Notice items={msg} />
        <details style={{ marginTop: 10 }}>
          <summary>Token 怎麼建立？密語要注意什麼？</summary>
          <ol>
            <li>GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。</li>
            <li>Repository access 選「Only select repositories」，只勾資料 repo。</li>
            <li>Permissions → Repository permissions → Contents 設為「Read and write」，其他不用開。到期日選一年。</li>
            <li>每台裝置用同一個 token 或各自建一個都可以。</li>
            <li>
              <strong>所有裝置必須用同一個密語。</strong>密語不會上傳；忘記就解不開雲端資料（只能用 Schwab 匯出檔重新匯入、手動紀錄要重打）。
            </li>
          </ol>
        </details>
      </Card>
    );
  }

  return (
    <Card title="裝置同步" desc="資料在瀏覽器裡加密後才上傳；每次同步都會在私人 repo 留下一筆版本紀錄，改錯可以回復。">
      <div className="kv" style={{ maxWidth: 520 }}>
        <span>狀態</span>
        <span>
          {STATE_LABEL[s.state]}
          {s.at && `（${s.at}）`}
        </span>
        <span>私人 repo</span>
        <span>
          <a href={`https://github.com/${cfg.owner}/${cfg.repo}/commits`} target="_blank" rel="noreferrer">
            {cfg.owner}/{cfg.repo}
          </a>
        </span>
        <span>這台裝置</span>
        <span>{cfg.device}</span>
        <span>密語</span>
        <span>{cfg.passphrase ? '已記住在這台裝置' : '每次開啟時輸入'}</span>
      </div>
      {s.message && <Notice items={[s.message]} />}
      {s.state === 'locked' && (
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field">
            密語
            <input type="password" value={form.passphrase} onChange={set('passphrase')} autoComplete="current-password" />
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={form.remember} onChange={(e) => setForm((f) => ({ ...f, remember: e.target.checked }))} />
            記住
          </label>
          <button className="primary" onClick={() => sync.unlock(form.passphrase, form.remember).then(() => setForm((f) => ({ ...f, passphrase: '' })))}>
            解鎖
          </button>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => void sync.syncNow()} disabled={s.state === 'syncing' || s.state === 'locked'}>
          立即同步
        </button>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm('停用這台裝置的同步？只會清除這台裝置上的 token 與密語，雲端資料和這台的本機資料都會保留。')) sync.disable();
          }}
        >
          停用這台裝置的同步
        </button>
      </div>
    </Card>
  );
}
