import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importText } from '../src/import';
import { mergeBatch } from '../src/store/merge';
import { emptyStore, type Store } from '../src/domain/types';

// 真實資料只存在本機（已列入 .gitignore）；CI 或別台電腦上沒有這個資料夾時，相關測試自動略過。
export const REAL_DIR = join(__dirname, '..', '20261015 Schwab 資料');
export const hasRealData = existsSync(REAL_DIR);

export function realFiles(): string[] {
  return readdirSync(REAL_DIR).filter((f) => /\.csv$/i.test(f));
}

export function loadRealStore(): Store {
  let s = emptyStore();
  for (const f of realFiles()) {
    s = mergeBatch(s, importText(readFileSync(join(REAL_DIR, f), 'utf8'), f)).store;
  }
  return s;
}
