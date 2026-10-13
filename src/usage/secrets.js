// 鍵（API キー）を読む。macOS のキーチェーンに入れておく（設定ファイルや GitHub には書かない）。
//   入れ方: bash scripts/set-secret.sh anthropic-admin
// テストや他の OS では、環境変数 AIB_SECRET_<名前>（- は _、大文字）でも渡せる。
import { execFileSync } from 'node:child_process';

export const KEYCHAIN_SERVICE = 'ai-browser';

export function getSecret(name) {
  const env = process.env[`AIB_SECRET_${name.replace(/-/g, '_').toUpperCase()}`];
  if (env) return env;
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}
