/** Non-production generation is off until a controlled provider canary opts in. */
export function generationAllowed(environment: string, testEnabled: string | undefined): boolean {
  return environment === 'production' || testEnabled === 'true';
}
