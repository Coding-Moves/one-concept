/** Keep temporary provider canaries separate from project-wide API settings. */
export function workerSetting(
  environment: string, name: string,
  get: (key: string) => string | undefined,
): string | undefined {
  if (environment === 'staging') {
    const canary = get(`WORKER_CANARY_${name}`);
    if (canary !== undefined) return canary;
  }
  return get(name);
}
